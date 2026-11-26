-- =========================================================================
-- QUIZMASTER PRO - SECURITY MIGRATION (SCOPED RLS, ADMIN SESSIONS & RPCS)
-- =========================================================================
-- Chạy script này trong Supabase SQL Editor để:
-- 1. Đảm bảo cột quiz_logins.session_id và index (session_id, created_at DESC)
-- 2. Tạo bảng & RPC xác thực Admin server-side (pgcrypto + admin_sessions)
-- 3. Thay thế policy FOR ALL cho anon trên quiz_logins & quiz_questions bằng RLS thu hẹp
-- 4. Cung cấp RPC SECURITY DEFINER cho học sinh (đọc config an toàn) và Admin (quản trị)
-- 5. Siết quyền arena_create_room, arena_end_room, arena_get_audit_logs
-- 6. Reload schema cache của PostgREST (NOTIFY pgrst, 'reload schema')
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.rpc_rate_limits (
    bucket TEXT NOT NULL,
    rate_key TEXT NOT NULL,
    window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    hit_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket, rate_key)
);
ALTER TABLE public.rpc_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rpc_rate_limits FROM anon, authenticated;
CREATE OR REPLACE FUNCTION public.enforce_rate_limit(p_bucket TEXT, p_key TEXT, p_max_hits INTEGER, p_window_seconds INTEGER)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_row public.rpc_rate_limits; v_now TIMESTAMPTZ := NOW();
BEGIN
    IF p_max_hits IS NULL OR p_max_hits < 1 OR p_window_seconds IS NULL OR p_window_seconds < 1 THEN RAISE EXCEPTION 'Invalid rate limit'; END IF;
    DELETE FROM public.rpc_rate_limits WHERE window_started_at + (p_window_seconds * INTERVAL '1 second') <= v_now;
    SELECT * INTO v_row FROM public.rpc_rate_limits WHERE bucket = COALESCE(p_bucket, '') AND rate_key = COALESCE(p_key, '') FOR UPDATE;
    IF v_row.bucket IS NULL OR v_row.window_started_at + (p_window_seconds * INTERVAL '1 second') <= v_now THEN
        INSERT INTO public.rpc_rate_limits(bucket, rate_key, window_started_at, hit_count) VALUES (COALESCE(p_bucket, ''), COALESCE(p_key, ''), v_now, 1)
        ON CONFLICT (bucket, rate_key) DO UPDATE SET window_started_at = EXCLUDED.window_started_at, hit_count = 1;
    ELSIF v_row.hit_count >= p_max_hits THEN RAISE EXCEPTION 'Rate limit exceeded';
    ELSE UPDATE public.rpc_rate_limits SET hit_count = hit_count + 1 WHERE bucket = v_row.bucket AND rate_key = v_row.rate_key;
    END IF;
    RETURN true;
END; $$;

-- =========================================================================
-- 1. BỔ SUNG CỘT session_id & INDEX CHO QUIZ_LOGINS
-- =========================================================================
ALTER TABLE public.quiz_logins ADD COLUMN IF NOT EXISTS session_id TEXT;
CREATE INDEX IF NOT EXISTS idx_quiz_logins_session_id ON public.quiz_logins(session_id);
CREATE INDEX IF NOT EXISTS idx_quiz_logins_session_created ON public.quiz_logins(session_id, created_at DESC);

-- =========================================================================
-- 2. BẢNG BÍ MẬT & PHIÊN ĐĂNG NHẬP ADMIN SERVER-SIDE
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.admin_auth_secrets (
    id TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.admin_sessions (
    token TEXT PRIMARY KEY,
    admin_label TEXT NOT NULL DEFAULT 'Admin',
    ip_address TEXT NOT NULL DEFAULT '',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON public.admin_sessions(expires_at);

ALTER TABLE public.admin_auth_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_sessions ENABLE ROW LEVEL SECURITY;

-- Không seed mật khẩu. Chủ dự án bắt buộc bootstrap bằng mật khẩu riêng >= 10 ký tự.

CREATE OR REPLACE FUNCTION public.is_valid_admin_session(p_admin_token TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF auth.role() = 'service_role' OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' THEN
        RETURN true;
    END IF;
    IF p_admin_token IS NULL OR LENGTH(TRIM(p_admin_token)) < 16 THEN
        RETURN false;
    END IF;
    RETURN EXISTS (
        SELECT 1
        FROM public.admin_sessions s
        WHERE s.token = TRIM(p_admin_token)
          AND s.expires_at > NOW()
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_verify_login(
    p_password TEXT DEFAULT NULL,
    p_admin_token TEXT DEFAULT NULL,
    p_ip TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_clean_token TEXT := NULLIF(TRIM(COALESCE(p_admin_token, '')), '');
    v_clean_ip TEXT := TRIM(COALESCE(p_ip, ''));
    v_secret TEXT;
    v_new_token TEXT;
    v_expires TIMESTAMPTZ := NOW() + INTERVAL '24 hours';
    v_admin_cfg_raw TEXT;
    v_admin_cfg JSONB;
    v_existing public.admin_sessions;
BEGIN
    DELETE FROM public.admin_sessions WHERE expires_at <= NOW();
    IF p_password IS NOT NULL AND LENGTH(p_password) > 0 THEN
        PERFORM public.enforce_rate_limit('admin_verify_login', COALESCE(NULLIF(TRIM(p_ip), ''), 'unknown-ip'), 5, 300);
    END IF;

    -- 1. Kiểm tra token phiên hiện có
    IF v_clean_token IS NOT NULL THEN
        SELECT * INTO v_existing
        FROM public.admin_sessions
        WHERE token = v_clean_token AND expires_at > NOW();
        IF v_existing.token IS NOT NULL THEN
            RETURN jsonb_build_object(
                'valid', true,
                'token', v_existing.token,
                'expires_at', v_existing.expires_at,
                'label', v_existing.admin_label
            );
        END IF;
    END IF;

    -- 2. Kiểm tra mật khẩu server-side (pgcrypto bcrypt)
    IF p_password IS NOT NULL AND LENGTH(p_password) > 0 THEN
        SELECT password_hash INTO v_secret FROM public.admin_auth_secrets WHERE id = 'default';
        IF v_secret IS NOT NULL AND crypt(p_password, v_secret) = v_secret THEN
            v_new_token := encode(gen_random_bytes(32), 'hex');
            INSERT INTO public.admin_sessions (token, admin_label, ip_address, expires_at)
            VALUES (v_new_token, 'Password Admin', v_clean_ip, v_expires);
            RETURN jsonb_build_object(
                'valid', true,
                'token', v_new_token,
                'expires_at', v_expires,
                'label', 'Password Admin'
            );
        END IF;
    END IF;

    -- 3. Kiểm tra Access Token có role = 'admin' trong __ACCESS_TOKENS_CONFIG__
    IF v_clean_token IS NOT NULL THEN
        SELECT score_summary INTO v_admin_cfg_raw
        FROM public.quiz_logins
        WHERE id = '00000000-0000-0000-0000-000000000008';
        IF v_admin_cfg_raw IS NOT NULL AND TRIM(v_admin_cfg_raw) <> '' THEN
            BEGIN
                v_admin_cfg := v_admin_cfg_raw::jsonb;
                IF jsonb_typeof(v_admin_cfg) = 'array' AND EXISTS (
                    SELECT 1 FROM jsonb_array_elements(v_admin_cfg) AS t
                    WHERE COALESCE(t->>'role', '') = 'admin'
                      AND (LOWER(COALESCE(t->>'token', '')) = LOWER(v_clean_token)
                        OR LOWER(COALESCE(t->>'rawCode', '')) = LOWER(v_clean_token))
                ) THEN
                    v_new_token := encode(gen_random_bytes(32), 'hex');
                    INSERT INTO public.admin_sessions (token, admin_label, ip_address, expires_at)
                    VALUES (v_new_token, 'Token Admin', v_clean_ip, v_expires);
                    RETURN jsonb_build_object(
                        'valid', true,
                        'token', v_new_token,
                        'expires_at', v_expires,
                        'label', 'Token Admin'
                    );
                END IF;
            EXCEPTION WHEN OTHERS THEN
                NULL;
            END;
        END IF;
    END IF;

    RETURN jsonb_build_object('valid', false, 'error', 'Xác thực quản trị không hợp lệ');
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_logout(p_admin_token TEXT)
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    DELETE FROM public.admin_sessions WHERE token = TRIM(COALESCE(p_admin_token, ''));
$$;

CREATE OR REPLACE FUNCTION public.admin_set_password(
    p_new_password TEXT,
    p_admin_token TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT public.is_valid_admin_session(p_admin_token) THEN
        RAISE EXCEPTION 'Không có quyền quản trị';
    END IF;
    IF p_new_password IS NULL OR LENGTH(TRIM(p_new_password)) < 10 OR LOWER(TRIM(p_new_password)) LIKE '%placeholder%' THEN
        RAISE EXCEPTION 'Mật khẩu mới phải có ít nhất 10 ký tự và không được là placeholder';
    END IF;
    INSERT INTO public.admin_auth_secrets (id, password_hash, updated_at)
    VALUES ('default', crypt(p_new_password, gen_salt('bf')), NOW())
    ON CONFLICT (id) DO UPDATE
    SET password_hash = EXCLUDED.password_hash, updated_at = NOW();
    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_bootstrap_password(p_new_password TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.admin_auth_secrets WHERE id = 'default') THEN
        RAISE EXCEPTION 'Mật khẩu Admin đã được thiết lập; dùng admin_set_password với phiên hợp lệ';
    END IF;
    IF p_new_password IS NULL OR LENGTH(TRIM(p_new_password)) < 10
       OR LOWER(TRIM(p_new_password)) LIKE '%placeholder%' THEN
        RAISE EXCEPTION 'Mật khẩu bootstrap phải có ít nhất 10 ký tự và không được là placeholder';
    END IF;
    INSERT INTO public.admin_auth_secrets(id, password_hash) VALUES ('default', crypt(p_new_password, gen_salt('bf')));
    RETURN true;
END;
$$;

-- Bootstrap mật khẩu chỉ dành cho chủ dự án qua SQL Editor/service role.
REVOKE EXECUTE ON FUNCTION public.admin_bootstrap_password(TEXT) FROM PUBLIC, anon, authenticated;

-- =========================================================================
-- 3. THU HẸP RLS TRÊN QUIZ_QUESTIONS & RPC QUẢN TRỊ CÂU HỎI
-- =========================================================================
DROP POLICY IF EXISTS "Public access to quiz_questions" ON public.quiz_questions;
DROP POLICY IF EXISTS "Public access active quiz_questions" ON public.quiz_questions;
DROP POLICY IF EXISTS "Public read active quiz_questions" ON public.quiz_questions;
DROP POLICY IF EXISTS "Admin manage quiz_questions" ON public.quiz_questions;
DROP POLICY IF EXISTS "Admin insert quiz_questions" ON public.quiz_questions;
DROP POLICY IF EXISTS "Admin update quiz_questions" ON public.quiz_questions;
DROP POLICY IF EXISTS "Admin delete quiz_questions" ON public.quiz_questions;
DROP POLICY IF EXISTS "Authenticated manage quiz_questions" ON public.quiz_questions;
REVOKE ALL ON TABLE public.quiz_questions FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_next_question_id()
RETURNS INTEGER
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT COALESCE(MAX(id), 0) + 1 FROM public.quiz_questions;
$$;

ALTER TABLE public.quiz_questions ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'practice';

CREATE OR REPLACE FUNCTION public.public_get_quiz_questions(p_subject_key TEXT DEFAULT NULL)
RETURNS SETOF JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT jsonb_build_object(
        'id', q.id, 'subject_key', q.subject_key, 'category', q.category, 'q_type', q.q_type,
        'question', q.question, 'options', COALESCE(q.options, '[]'::jsonb),
        'statements', CASE WHEN LOWER(COALESCE(q.mode, 'practice')) = 'exam'
            THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('text', s->>'text')) FROM jsonb_array_elements(COALESCE(q.statements, '[]'::jsonb)) s), '[]'::jsonb)
            ELSE COALESCE(q.statements, '[]'::jsonb) END,
        'image_url', q.image_url, 'grade', q.grade, 'mode', LOWER(COALESCE(q.mode, 'practice')),
        'correct', CASE WHEN LOWER(COALESCE(q.mode, 'practice')) = 'exam' THEN NULL ELSE to_jsonb(q.correct) END,
        'answer', CASE WHEN LOWER(COALESCE(q.mode, 'practice')) = 'exam' THEN NULL ELSE to_jsonb(q.answer) END,
        'correct_value', CASE WHEN LOWER(COALESCE(q.mode, 'practice')) = 'exam' THEN NULL ELSE to_jsonb(q.correct_value) END,
        'explanation', CASE WHEN LOWER(COALESCE(q.mode, 'practice')) = 'exam' THEN NULL ELSE to_jsonb(q.explanation) END
    )
    FROM public.quiz_questions q
    WHERE COALESCE(q.is_deleted, false) = false
      AND (p_subject_key IS NULL OR TRIM(p_subject_key) = '' OR LOWER(q.subject_key) = LOWER(TRIM(p_subject_key)))
    ORDER BY q.id;
$$;
GRANT EXECUTE ON FUNCTION public.public_get_quiz_questions(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_upsert_question(
    p_admin_token TEXT,
    p_record JSONB
)
RETURNS public.quiz_questions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_id INTEGER;
    v_row public.quiz_questions;
BEGIN
    IF NOT public.is_valid_admin_session(p_admin_token) THEN
        RAISE EXCEPTION 'Không có quyền quản trị';
    END IF;
    IF NULLIF(TRIM(COALESCE(p_record->>'question', '')), '') IS NULL THEN
        RAISE EXCEPTION 'Nội dung câu hỏi không được để trống';
    END IF;

    v_id := NULLIF(TRIM(COALESCE(p_record->>'id', '')), '')::INTEGER;
    IF v_id IS NULL OR v_id <= 0 THEN
        SELECT COALESCE(MAX(id), 0) + 1 INTO v_id FROM public.quiz_questions;
    END IF;

    INSERT INTO public.quiz_questions (
        id, subject_key, category, q_type, question, options, statements,
        correct, answer, correct_value, accepted_values, explanation, image_url,
        grade, mode, is_deleted, deleted_at, updated_at
    )
    VALUES (
        v_id,
        COALESCE(NULLIF(TRIM(p_record->>'subject_key'), ''), 'history'),
        COALESCE(NULLIF(TRIM(p_record->>'category'), ''), 'Bài học'),
        COALESCE(NULLIF(TRIM(p_record->>'q_type'), ''), 'mcq'),
        p_record->>'question',
        COALESCE(p_record->'options', '[]'::jsonb),
        COALESCE(p_record->'statements', '[]'::jsonb),
        COALESCE((p_record->>'correct')::INTEGER, 0),
        COALESCE((p_record->>'answer')::INTEGER, COALESCE((p_record->>'correct')::INTEGER, 0)),
        COALESCE(p_record->>'correct_value', ''),
        COALESCE(p_record->'accepted_values', '[]'::jsonb),
        COALESCE(p_record->>'explanation', ''),
        COALESCE(p_record->>'image_url', ''),
        COALESCE(NULLIF(TRIM(p_record->>'grade'), ''), '11'),
        CASE WHEN LOWER(COALESCE(p_record->>'mode', 'practice')) = 'exam' THEN 'exam' ELSE 'practice' END,
        COALESCE((p_record->>'is_deleted')::BOOLEAN, false),
        NULL,
        NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
        subject_key = EXCLUDED.subject_key,
        category = EXCLUDED.category,
        q_type = EXCLUDED.q_type,
        question = EXCLUDED.question,
        options = EXCLUDED.options,
        statements = EXCLUDED.statements,
        correct = EXCLUDED.correct,
        answer = EXCLUDED.answer,
        correct_value = EXCLUDED.correct_value,
        accepted_values = EXCLUDED.accepted_values,
        explanation = EXCLUDED.explanation,
        image_url = EXCLUDED.image_url,
        grade = EXCLUDED.grade,
        mode = EXCLUDED.mode,
        is_deleted = EXCLUDED.is_deleted,
        deleted_at = EXCLUDED.deleted_at,
        updated_at = NOW()
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_questions_bulk(
    p_admin_token TEXT,
    p_records JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_item JSONB;
    v_count INTEGER := 0;
    v_ids INTEGER[] := '{}';
    v_row public.quiz_questions;
BEGIN
    IF NOT public.is_valid_admin_session(p_admin_token) THEN
        RAISE EXCEPTION 'Không có quyền quản trị';
    END IF;
    IF p_records IS NULL OR jsonb_typeof(p_records) <> 'array' THEN
        RAISE EXCEPTION 'Danh sách câu hỏi không hợp lệ';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_records)
    LOOP
        v_row := public.admin_upsert_question(p_admin_token, v_item);
        v_ids := array_append(v_ids, v_row.id);
        v_count := v_count + 1;
    END LOOP;

    RETURN jsonb_build_object('count', v_count, 'ids', to_jsonb(v_ids));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_question(
    p_admin_token TEXT,
    p_question_id INTEGER,
    p_hard BOOLEAN DEFAULT false
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT public.is_valid_admin_session(p_admin_token) THEN
        RAISE EXCEPTION 'Không có quyền quản trị';
    END IF;
    IF p_hard THEN
        DELETE FROM public.quiz_questions WHERE id = p_question_id;
    ELSE
        UPDATE public.quiz_questions
        SET is_deleted = true, deleted_at = NOW()
        WHERE id = p_question_id;
    END IF;
    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_clear_questions_by_subject(
    p_admin_token TEXT,
    p_subject_key TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_affected INTEGER := 0;
BEGIN
    IF NOT public.is_valid_admin_session(p_admin_token) THEN
        RAISE EXCEPTION 'Không có quyền quản trị';
    END IF;
    UPDATE public.quiz_questions
    SET is_deleted = true, deleted_at = NOW()
    WHERE subject_key = TRIM(COALESCE(p_subject_key, ''))
      AND COALESCE(is_deleted, false) = false;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    RETURN v_affected;
END;
$$;

-- =========================================================================
-- 4. THU HẸP RLS TRÊN QUIZ_LOGINS + RPC CÔNG KHAI AN TOÀN & RPC QUẢN TRỊ
-- =========================================================================
DROP POLICY IF EXISTS "Public access to quiz_logins" ON public.quiz_logins;
DROP POLICY IF EXISTS "Public read quiz_logins" ON public.quiz_logins;
DROP POLICY IF EXISTS "Public read student quiz_logins" ON public.quiz_logins;
DROP POLICY IF EXISTS "Public insert student quiz_logins" ON public.quiz_logins;
DROP POLICY IF EXISTS "Public update student quiz_logins" ON public.quiz_logins;
DROP POLICY IF EXISTS "Authenticated delete quiz_logins" ON public.quiz_logins;
REVOKE ALL ON TABLE public.quiz_logins FROM anon, authenticated;

-- RPC công khai cho học sinh đọc cấu hình không nhạy cảm
CREATE OR REPLACE FUNCTION public.public_get_maintenance_status()
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT jsonb_build_object(
        'isActive', COALESCE(status = 'ACTIVE' OR device_info = 'ON', false),
        'message', COALESCE(NULLIF(score_summary, ''), 'Trang web đang tạm dừng để cập nhật đề cương và dữ liệu mới. Vui lòng quay lại sau!')
    )
    FROM public.quiz_logins
    WHERE id = '00000000-0000-0000-0000-000000000003'
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.public_get_geo_config()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_row public.quiz_logins;
    v_parsed JSONB;
BEGIN
    SELECT * INTO v_row FROM public.quiz_logins WHERE id = '00000000-0000-0000-0000-000000000002';
    IF v_row.id IS NULL THEN
        RETURN jsonb_build_object('mode', 'PUBLIC', 'ips', '[]'::jsonb, 'grade5Ips', '[]'::jsonb);
    END IF;
    BEGIN
        v_parsed := COALESCE(NULLIF(v_row.score_summary, ''), '{}')::jsonb;
    EXCEPTION WHEN OTHERS THEN
        v_parsed := '{}'::jsonb;
    END;
    IF jsonb_typeof(v_parsed) = 'array' THEN
        RETURN jsonb_build_object('mode', COALESCE(v_row.device_info, 'PUBLIC'), 'ips', v_parsed, 'grade5Ips', '[]'::jsonb);
    END IF;
    RETURN jsonb_build_object(
        'mode', COALESCE(v_parsed->>'mode', v_row.device_info, 'PUBLIC'),
        'ips', COALESCE(v_parsed->'ips', '[]'::jsonb),
        'grade5Ips', COALESCE(v_parsed->'grade5Ips', v_parsed->'grade5_ips', v_parsed->'class5Ips', '[]'::jsonb)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.public_get_dynamic_subjects()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_raw TEXT;
BEGIN
    SELECT score_summary INTO v_raw FROM public.quiz_logins WHERE id = '00000000-0000-0000-0000-000000000004';
    IF v_raw IS NULL OR TRIM(v_raw) = '' THEN
        RETURN '[]'::jsonb;
    END IF;
    RETURN v_raw::jsonb;
EXCEPTION WHEN OTHERS THEN
    RETURN '[]'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION public.public_get_roster_config()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT COALESCE(NULLIF(score_summary, ''), '{"grade5":{"enabled":false,"allowGuestsInPractice":true,"students":[]},"grade11":{"enabled":false,"allowGuestsInPractice":true,"students":[]},"devicePins":{}}')
    FROM public.quiz_logins
    WHERE id = '00000000-0000-0000-0000-000000000010'
    LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.public_get_roster_config() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.public_check_ip_banned(p_ip TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_clean_ip TEXT := TRIM(COALESCE(p_ip, ''));
    v_row RECORD;
    v_reason TEXT;
BEGIN
    IF v_clean_ip = '' OR v_clean_ip = 'Chưa xác định' OR v_clean_ip = 'IP Cục Bộ' THEN
        RETURN jsonb_build_object('isBanned', false);
    END IF;

    SELECT player_name, status, score_summary INTO v_row
    FROM public.quiz_logins
    WHERE ip_address = v_clean_ip AND status LIKE 'BANNED%'
    ORDER BY (player_name = '__BANNED_IP__') DESC, last_active DESC
    LIMIT 1;

    IF v_row.status IS NULL THEN
        RETURN jsonb_build_object('isBanned', false);
    END IF;

    v_reason := NULLIF(TRIM(REGEXP_REPLACE(v_row.status, '^BANNED:\s*', '')), '');
    IF v_row.player_name = '__BANNED_IP__' AND NULLIF(TRIM(COALESCE(v_row.score_summary, '')), '') IS NOT NULL THEN
        v_reason := TRIM(v_row.score_summary);
    END IF;
    RETURN jsonb_build_object('isBanned', true, 'reason', COALESCE(v_reason, 'Vi phạm quy chế'));
END;
$$;

CREATE OR REPLACE FUNCTION public.public_get_latest_notice(
    p_ip TEXT DEFAULT '',
    p_player_name TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_clean_ip TEXT := TRIM(COALESCE(p_ip, ''));
    v_clean_name TEXT := LOWER(TRIM(COALESCE(p_player_name, '')));
    v_row RECORD;
    v_t_ip TEXT;
    v_t_name TEXT;
    v_has_name BOOLEAN;
BEGIN
    FOR v_row IN
        SELECT id, ip_address, device_info, score_summary, last_active, created_at
        FROM public.quiz_logins
        WHERE player_name = '__SYSTEM_NOTICE__'
        ORDER BY created_at DESC
        LIMIT 25
    LOOP
        IF NULLIF(TRIM(COALESCE(v_row.score_summary, '')), '') IS NULL THEN
            CONTINUE;
        END IF;
        v_t_ip := TRIM(COALESCE(v_row.ip_address, ''));
        v_t_name := LOWER(TRIM(COALESCE(v_row.device_info, '')));
        v_has_name := (v_t_name <> '' AND v_t_name <> '5s' AND v_t_name <> 'all');
        IF (v_t_ip = 'ALL' AND NOT v_has_name)
           OR (v_clean_ip <> '' AND v_t_ip = v_clean_ip)
           OR (v_t_ip <> 'ALL' AND v_has_name AND v_clean_ip <> '' AND v_t_ip = v_clean_ip AND v_clean_name <> '' AND v_clean_name <> 'khách truy cập' AND v_t_name = v_clean_name) THEN
            RETURN jsonb_build_object(
                'id', v_row.id,
                'message', TRIM(v_row.score_summary),
                'targetIp', v_row.ip_address,
                'targetName', v_row.device_info,
                'createdAt', COALESCE(v_row.created_at, v_row.last_active)
            );
        END IF;
    END LOOP;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.public_verify_access_token(
    p_token TEXT,
    p_ip TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_raw TEXT;
    v_tokens JSONB;
    v_clean TEXT := LOWER(TRIM(COALESCE(p_token, '')));
    v_ip TEXT := LOWER(TRIM(REGEXP_REPLACE(COALESCE(p_ip, ''), '^\[|\]$', '', 'g')));
    v_elem JSONB;
    v_t_val TEXT;
    v_raw_val TEXT;
    v_ip_val TEXT;
BEGIN
    PERFORM public.enforce_rate_limit('public_verify_access_token', COALESCE(NULLIF(v_ip, ''), 'unknown-ip'), 20, 60);
    SELECT score_summary INTO v_raw FROM public.quiz_logins WHERE id = '00000000-0000-0000-0000-000000000008';
    IF v_raw IS NULL OR TRIM(v_raw) = '' THEN
        RETURN NULL;
    END IF;
    v_tokens := v_raw::jsonb;
    IF jsonb_typeof(v_tokens) <> 'array' THEN
        RETURN NULL;
    END IF;

    IF v_clean <> '' THEN
        FOR v_elem IN SELECT * FROM jsonb_array_elements(v_tokens)
        LOOP
            v_t_val := LOWER(TRIM(COALESCE(v_elem->>'token', '')));
            v_raw_val := LOWER(TRIM(COALESCE(v_elem->>'rawCode', '')));
            v_ip_val := LOWER(TRIM(REGEXP_REPLACE(COALESCE(v_elem->>'ip', ''), '^\[|\]$', '', 'g')));
            IF v_t_val = v_clean OR (v_raw_val <> '' AND v_raw_val = v_clean) OR (v_ip_val <> '' AND v_clean = v_ip_val) THEN
                RETURN v_elem;
            END IF;
        END LOOP;
    END IF;

    IF v_ip <> '' THEN
        FOR v_elem IN SELECT * FROM jsonb_array_elements(v_tokens)
        LOOP
            v_t_val := LOWER(TRIM(COALESCE(v_elem->>'token', '')));
            v_raw_val := LOWER(TRIM(COALESCE(v_elem->>'rawCode', '')));
            v_ip_val := LOWER(TRIM(REGEXP_REPLACE(COALESCE(v_elem->>'ip', ''), '^\[|\]$', '', 'g')));
            IF v_ip_val <> '' AND (v_ip = v_ip_val OR right(v_ip, length(v_ip_val)) = v_ip_val OR right(v_ip_val, length(v_ip)) = v_ip)
               AND (v_raw_val = '' OR v_raw_val = v_ip_val) AND (v_t_val = '' OR v_t_val = v_ip_val) THEN
                RETURN v_elem;
            END IF;
        END LOOP;
    END IF;

    RETURN NULL;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.student_record_login(
    p_id UUID,
    p_player_name TEXT,
    p_ip_address TEXT DEFAULT 'Chưa xác định',
    p_device_info TEXT DEFAULT 'Trình duyệt Web',
    p_status TEXT DEFAULT 'Đang làm bài',
    p_score_summary TEXT DEFAULT '',
    p_session_id TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_name TEXT := COALESCE(NULLIF(TRIM(COALESCE(p_player_name, '')), ''), 'Khách truy cập');
    v_ip TEXT := COALESCE(NULLIF(TRIM(COALESCE(p_ip_address, '')), ''), 'Chưa xác định');
    v_id UUID := COALESCE(p_id, gen_random_uuid());
BEGIN
    IF p_id IN ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000010') THEN
        RAISE EXCEPTION 'Không được ghi bản ghi hệ thống';
    END IF;
    IF v_name LIKE '\_\_%' OR UPPER(v_ip) = 'SYSTEM' OR COALESCE(p_status, '') ILIKE 'BANNED%' THEN
        RAISE EXCEPTION 'Dữ liệu phiên học sinh không hợp lệ';
    END IF;
    IF EXISTS (SELECT 1 FROM public.quiz_logins l WHERE l.id = v_id AND (l.player_name LIKE '\_\_%' OR l.ip_address = 'SYSTEM' OR l.status LIKE 'BANNED%' OR (NULLIF(TRIM(COALESCE(p_session_id, '')), '') IS NOT NULL AND NULLIF(TRIM(COALESCE(l.session_id, '')), '') IS NOT NULL AND l.session_id <> p_session_id))) THEN
        RAISE EXCEPTION 'Không được ghi đè bản ghi hệ thống hoặc phiên khác';
    END IF;

    INSERT INTO public.quiz_logins (
        id, player_name, ip_address, device_info, status, score_summary, session_id, last_active, created_at
    )
    VALUES (
        v_id, v_name, v_ip, COALESCE(NULLIF(TRIM(p_device_info), ''), 'Trình duyệt Web'),
        COALESCE(NULLIF(TRIM(p_status), ''), 'Đang làm bài'), COALESCE(p_score_summary, ''),
        p_session_id, NOW(), NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
        player_name = EXCLUDED.player_name,
        ip_address = EXCLUDED.ip_address,
        device_info = EXCLUDED.device_info,
        status = CASE WHEN public.quiz_logins.status LIKE 'BANNED%' THEN public.quiz_logins.status ELSE EXCLUDED.status END,
        score_summary = CASE WHEN EXCLUDED.score_summary <> '' THEN EXCLUDED.score_summary ELSE public.quiz_logins.score_summary END,
        session_id = COALESCE(NULLIF(EXCLUDED.session_id, ''), public.quiz_logins.session_id),
        last_active = NOW();

    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.student_heartbeat(p_login_id UUID, p_last_active TIMESTAMPTZ DEFAULT NOW())
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    UPDATE public.quiz_logins
    SET last_active = COALESCE(p_last_active, NOW())
    WHERE id = p_login_id
      AND player_name NOT LIKE '\_\_%'
      AND COALESCE(ip_address, '') <> 'SYSTEM'
      AND status NOT LIKE 'BANNED%';
    RETURN FOUND;
END; $$;

CREATE OR REPLACE FUNCTION public.student_update_progress(
    p_login_id UUID,
    p_status TEXT,
    p_score_summary TEXT DEFAULT '',
    p_last_active TIMESTAMPTZ DEFAULT NOW()
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    UPDATE public.quiz_logins
    SET status = CASE WHEN status LIKE 'BANNED%' THEN status ELSE COALESCE(NULLIF(TRIM(p_status), ''), status) END,
        score_summary = CASE WHEN COALESCE(p_score_summary, '') <> '' THEN p_score_summary ELSE score_summary END,
        last_active = COALESCE(p_last_active, NOW())
    WHERE id = p_login_id
      AND player_name NOT LIKE '\_\_%'
      AND COALESCE(ip_address, '') <> 'SYSTEM'
      AND status NOT LIKE 'BANNED%'
      AND status NOT ILIKE '%đã nộp bài%'
      AND status NOT ILIKE '%hoàn thành%';
    RETURN FOUND;
END; $$;

CREATE OR REPLACE FUNCTION public.public_get_login_by_ip(p_ip TEXT)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT jsonb_build_object('playerName', l.player_name, 'deviceInfo', l.device_info, 'lastActive', l.last_active)
    FROM public.quiz_logins l
    WHERE l.ip_address = TRIM(COALESCE(p_ip, ''))
      AND l.player_name NOT LIKE '\_\_%'
      AND LOWER(TRIM(l.player_name)) NOT IN ('khách truy cập', 'visitor')
      AND COALESCE(l.ip_address, '') <> 'SYSTEM'
    ORDER BY l.last_active DESC NULLS LAST
    LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.student_record_login(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.student_heartbeat(UUID, TIMESTAMPTZ) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.student_update_progress(UUID, TEXT, TEXT, TIMESTAMPTZ) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_get_login_by_ip(TEXT) TO anon, authenticated;

-- RPC quản trị cho quiz_logins (yêu cầu admin session)
CREATE OR REPLACE FUNCTION public.admin_get_login_history(
    p_admin_token TEXT,
    p_limit INTEGER DEFAULT 300,
    p_offset INTEGER DEFAULT 0,
    p_exclude_visitors BOOLEAN DEFAULT false
)
RETURNS TABLE (
    id UUID,
    player_name TEXT,
    ip_address TEXT,
    device_info TEXT,
    status TEXT,
    score_summary TEXT,
    session_id TEXT,
    last_active TIMESTAMPTZ,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT public.is_valid_admin_session(p_admin_token) THEN
        RAISE EXCEPTION 'Không có quyền quản trị';
    END IF;

    RETURN QUERY
    SELECT
        l.id, l.player_name, l.ip_address, l.device_info,
        l.status, l.score_summary, l.session_id, l.last_active, l.created_at
    FROM public.quiz_logins l
    WHERE l.player_name NOT LIKE '\_\_%'
      AND COALESCE(l.ip_address, '') <> 'SYSTEM'
      AND (
          NOT COALESCE(p_exclude_visitors, false)
          OR (
              TRIM(COALESCE(l.player_name, '')) <> ''
              AND LOWER(TRIM(l.player_name)) NOT IN ('khách truy cập', 'visitor')
          )
      )
    ORDER BY l.last_active DESC NULLS LAST, l.id ASC
    LIMIT GREATEST(1, LEAST(1000, COALESCE(p_limit, 300)))
    OFFSET GREATEST(0, COALESCE(p_offset, 0));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_ban_ip(
    p_admin_token TEXT,
    p_ip TEXT,
    p_reason TEXT DEFAULT 'Vi phạm quy chế ôn tập'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_clean_ip TEXT := TRIM(COALESCE(p_ip, ''));
    v_reason TEXT := COALESCE(NULLIF(TRIM(COALESCE(p_reason, '')), ''), 'Vi phạm quy chế ôn tập');
    v_status TEXT := 'BANNED: ' || v_reason;
BEGIN
    IF NOT public.is_valid_admin_session(p_admin_token) THEN
        RAISE EXCEPTION 'Không có quyền quản trị';
    END IF;
    IF v_clean_ip = '' OR v_clean_ip = 'Chưa xác định' OR v_clean_ip = 'IP Cục Bộ' THEN
        RAISE EXCEPTION 'Địa chỉ IP không hợp lệ';
    END IF;

    IF EXISTS (SELECT 1 FROM public.quiz_logins WHERE ip_address = v_clean_ip AND player_name = '__BANNED_IP__') THEN
        UPDATE public.quiz_logins
        SET status = v_status, score_summary = v_reason, last_active = NOW()
        WHERE ip_address = v_clean_ip AND player_name = '__BANNED_IP__';
    ELSE
        INSERT INTO public.quiz_logins (id, player_name, ip_address, device_info, status, score_summary, last_active, created_at)
        VALUES (gen_random_uuid(), '__BANNED_IP__', v_clean_ip, 'Manual Ban', v_status, v_reason, NOW(), NOW());
    END IF;

    RETURN jsonb_build_object('success', true, 'ip', v_clean_ip, 'reason', v_reason);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_unban_ip(
    p_admin_token TEXT,
    p_ip TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_clean_ip TEXT := TRIM(COALESCE(p_ip, ''));
BEGIN
    IF NOT public.is_valid_admin_session(p_admin_token) THEN
        RAISE EXCEPTION 'Không có quyền quản trị';
    END IF;
    DELETE FROM public.quiz_logins
    WHERE ip_address = v_clean_ip AND player_name = '__BANNED_IP__';

    RETURN jsonb_build_object('success', true, 'ip', v_clean_ip);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_login_record(
    p_admin_token TEXT,
    p_login_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT public.is_valid_admin_session(p_admin_token) THEN
        RAISE EXCEPTION 'Không có quyền quản trị';
    END IF;
    DELETE FROM public.quiz_logins
    WHERE id = p_login_id
      AND player_name NOT LIKE '\_\_%'
      AND COALESCE(ip_address, '') <> 'SYSTEM';
    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_clear_all_logins(
    p_admin_token TEXT,
    p_admin_ips TEXT[] DEFAULT '{}'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_deleted INTEGER := 0;
BEGIN
    IF NOT public.is_valid_admin_session(p_admin_token) THEN
        RAISE EXCEPTION 'Không có quyền quản trị';
    END IF;
    DELETE FROM public.quiz_logins
    WHERE player_name NOT LIKE '\_\_%'
      AND COALESCE(ip_address, '') <> 'SYSTEM'
      AND NOT (COALESCE(ip_address, '') = ANY(COALESCE(p_admin_ips, '{}')));
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_manage_config(
    p_admin_token TEXT,
    p_action TEXT,
    p_record_id UUID DEFAULT NULL,
    p_payload JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_row public.quiz_logins;
    v_target_ip TEXT;
    v_target_name TEXT;
    v_msg TEXT;
    v_notice_id UUID;
    v_banned JSONB;
BEGIN
    IF NOT public.is_valid_admin_session(p_admin_token) THEN
        RAISE EXCEPTION 'Không có quyền quản trị';
    END IF;

    IF p_action = 'get' THEN
        SELECT * INTO v_row FROM public.quiz_logins WHERE id = p_record_id;
        RETURN to_jsonb(v_row);
    ELSIF p_action = 'set' THEN
        INSERT INTO public.quiz_logins (
            id, player_name, ip_address, device_info, status, score_summary, last_active, created_at
        )
        VALUES (
            p_record_id,
            COALESCE(p_payload->>'player_name', '__SYSTEM_CONFIG__'),
            'SYSTEM',
            COALESCE(p_payload->>'device_info', 'CONFIG'),
            COALESCE(p_payload->>'status', 'ACTIVE'),
            COALESCE(p_payload->>'score_summary', ''),
            NOW(),
            NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
            player_name = EXCLUDED.player_name,
            device_info = EXCLUDED.device_info,
            status = EXCLUDED.status,
            score_summary = EXCLUDED.score_summary,
            last_active = NOW()
        RETURNING * INTO v_row;
        RETURN to_jsonb(v_row);
    ELSIF p_action = 'broadcast_notice' THEN
        v_msg := NULLIF(TRIM(COALESCE(p_payload->>'message', '')), '');
        IF v_msg IS NULL THEN
            RAISE EXCEPTION 'Nội dung thông báo không được để trống';
        END IF;
        v_target_ip := COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'targetIp', '')), ''), 'ALL');
        v_target_name := TRIM(COALESCE(p_payload->>'targetName', ''));
        v_notice_id := COALESCE(NULLIF(p_payload->>'id', '')::UUID, gen_random_uuid());

        IF v_target_name <> '' THEN
            DELETE FROM public.quiz_logins
            WHERE player_name = '__SYSTEM_NOTICE__'
              AND ip_address = v_target_ip
              AND LOWER(device_info) = LOWER(v_target_name);
        ELSE
            DELETE FROM public.quiz_logins
            WHERE player_name = '__SYSTEM_NOTICE__'
              AND ip_address = v_target_ip
              AND device_info = '5s';
        END IF;

        INSERT INTO public.quiz_logins (id, player_name, ip_address, device_info, status, score_summary, last_active)
        VALUES (v_notice_id, '__SYSTEM_NOTICE__', v_target_ip, COALESCE(NULLIF(v_target_name, ''), '5s'), 'ACTIVE', v_msg, NOW())
        RETURNING * INTO v_row;
        RETURN to_jsonb(v_row);
    ELSIF p_action = 'list_banned_ips' THEN
        SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_banned
        FROM (
            SELECT id, player_name, ip_address, device_info, status, score_summary, last_active, created_at
            FROM public.quiz_logins
            WHERE status LIKE 'BANNED%'
            ORDER BY last_active DESC
        ) t;
        RETURN v_banned;
    ELSE
        RAISE EXCEPTION 'Hành động quản trị không hợp lệ: %', p_action;
    END IF;
END;
$$;

-- =========================================================================
-- 5. SIẾT QUYỀN ARENA SECURITY DEFINER RPCS (HOST / ADMIN)
-- =========================================================================
DROP FUNCTION IF EXISTS public.arena_create_room(TEXT, TEXT, INTEGER, INTEGER, INTEGER, TEXT, BOOLEAN);
CREATE OR REPLACE FUNCTION public.arena_create_room(
    p_title TEXT,
    p_subject_key TEXT,
    p_match_duration_sec INTEGER DEFAULT 600,
    p_per_question_sec INTEGER DEFAULT NULL,
    p_max_violations INTEGER DEFAULT 3,
    p_concurrent_policy TEXT DEFAULT 'KICK_OLD',
    p_require_fullscreen BOOLEAN DEFAULT false,
    p_admin_token TEXT DEFAULT NULL
)
RETURNS public.match_rooms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_code TEXT;
    v_room public.match_rooms;
    v_title TEXT := COALESCE(NULLIF(TRIM(p_title), ''), 'Bài kiểm tra');
    v_subject_key TEXT := NULLIF(TRIM(COALESCE(p_subject_key, '')), '');
BEGIN
    IF NOT public.is_valid_admin_session(p_admin_token) THEN
        RAISE EXCEPTION 'Chỉ quản trị viên mới có quyền tạo phòng thi đấu';
    END IF;
    IF v_subject_key IS NULL OR LENGTH(v_subject_key) > 64 THEN
        RAISE EXCEPTION 'Mã môn học không hợp lệ';
    END IF;
    IF LENGTH(v_title) > 200 THEN
        RAISE EXCEPTION 'Tên bài kiểm tra quá dài (tối đa 200 ký tự)';
    END IF;
    IF p_match_duration_sec IS NOT NULL AND (p_match_duration_sec < 30 OR p_match_duration_sec > 14400) THEN
        RAISE EXCEPTION 'Thời gian làm bài phải từ 30 đến 14400 giây';
    END IF;
    IF p_per_question_sec IS NOT NULL AND (p_per_question_sec < 5 OR p_per_question_sec > 3600) THEN
        RAISE EXCEPTION 'Thời gian mỗi câu phải từ 5 đến 3600 giây';
    END IF;
    IF p_max_violations IS NOT NULL AND (p_max_violations < 0 OR p_max_violations > 100) THEN
        RAISE EXCEPTION 'Số lần vi phạm tối đa không hợp lệ';
    END IF;

    LOOP
        v_code := UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 6));
        EXIT WHEN NOT EXISTS (SELECT 1 FROM public.match_rooms WHERE room_code = v_code);
    END LOOP;

    INSERT INTO public.match_rooms (
        room_code, title, subject_key,
        match_duration_sec, per_question_sec,
        max_violations, concurrent_policy, require_fullscreen,
        status, started_at
    )
    VALUES (
        v_code,
        v_title,
        v_subject_key,
        GREATEST(30, LEAST(14400, COALESCE(p_match_duration_sec, 600))),
        CASE WHEN p_per_question_sec IS NOT NULL AND p_per_question_sec >= 5 THEN LEAST(3600, p_per_question_sec) ELSE NULL END,
        GREATEST(0, LEAST(100, COALESCE(p_max_violations, 3))),
        CASE WHEN p_concurrent_policy = 'BLOCK_NEW' THEN 'BLOCK_NEW' ELSE 'KICK_OLD' END,
        COALESCE(p_require_fullscreen, false),
        'IN_PROGRESS',
        NOW()
    )
    RETURNING * INTO v_room;

    INSERT INTO public.match_audit_logs (room_id, player_name, event_type, meta)
    VALUES (v_room.id, 'HOST', 'ROOM_CREATED', jsonb_build_object('room_code', v_room.room_code, 'subject_key', v_room.subject_key));

    RETURN v_room;
END;
$$;

DROP FUNCTION IF EXISTS public.arena_end_room(UUID);
CREATE OR REPLACE FUNCTION public.arena_end_room(
    p_room_id UUID,
    p_admin_token TEXT DEFAULT NULL
)
RETURNS public.match_rooms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_room public.match_rooms;
BEGIN
    IF NOT public.is_valid_admin_session(p_admin_token) THEN
        RAISE EXCEPTION 'Chỉ quản trị viên mới có quyền đóng phòng thi đấu';
    END IF;
    IF p_room_id IS NULL THEN
        RAISE EXCEPTION 'Thiếu mã định danh phòng thi (p_room_id)';
    END IF;

    UPDATE public.match_rooms
    SET status = 'FINISHED',
        is_locked = true,
        ended_at = COALESCE(ended_at, NOW())
    WHERE id = p_room_id
    RETURNING * INTO v_room;

    IF v_room.id IS NULL THEN
        RAISE EXCEPTION 'Không tìm thấy phòng thi cần đóng';
    END IF;

    UPDATE public.match_attempts
    SET status = 'SUBMITTED',
        submitted_at = COALESCE(submitted_at, NOW()),
        finish_reason = COALESCE(finish_reason, 'HOST_ENDED')
    WHERE room_id = p_room_id AND status IN ('JOINED', 'IN_PROGRESS');

    INSERT INTO public.match_audit_logs (room_id, player_name, event_type)
    VALUES (p_room_id, 'HOST', 'ROOM_ENDED');

    RETURN v_room;
END;
$$;

DROP FUNCTION IF EXISTS public.arena_get_audit_logs(UUID);
CREATE OR REPLACE FUNCTION public.arena_get_audit_logs(
    p_room_id UUID,
    p_admin_token TEXT DEFAULT NULL
)
RETURNS TABLE (
    player_name TEXT,
    event_type TEXT,
    meta JSONB,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT public.is_valid_admin_session(p_admin_token) THEN
        RAISE EXCEPTION 'Chỉ quản trị viên mới có quyền xem nhật ký kiểm toán';
    END IF;

    RETURN QUERY
    SELECT
        l.player_name,
        l.event_type,
        l.meta - 'attempted_token' - 'new_token',
        l.created_at
    FROM public.match_audit_logs l
    WHERE l.room_id = p_room_id
    ORDER BY l.created_at DESC
    LIMIT 40;
END;
$$;

-- =========================================================================
-- 6. RELOAD POSTGREST SCHEMA CACHE
-- =========================================================================
NOTIFY pgrst, 'reload schema';
