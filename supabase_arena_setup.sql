-- =========================================================================
-- QUIZMASTER PRO - COMPETITIVE ARENA SETUP (SUPABASE / POSTGRESQL)
-- =========================================================================
-- Chạy script này trong Supabase SQL Editor để kích hoạt chế độ Thi đấu trực tuyến:
-- 1. Bảng: match_rooms, match_attempts, match_answers, match_audit_logs
-- 2. RPC Server-Authoritative: đồng hồ máy chủ, xáo trộn đề/đáp án, chống gian lận,
--    một phiên hợp lệ, tính điểm + tốc độ và bảng xếp hạng công bằng.
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. PHÒNG KIỂM TRA (Mở ngay cho học sinh vào làm bài, không cần phòng chờ/ghép cặp)
CREATE TABLE IF NOT EXISTS public.match_rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_code TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL DEFAULT 'Bài kiểm tra',
    subject_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS', 'FINISHED', 'CANCELLED')),
    match_duration_sec INTEGER NOT NULL DEFAULT 600 CHECK (match_duration_sec >= 30),
    per_question_sec INTEGER DEFAULT NULL CHECK (per_question_sec IS NULL OR per_question_sec >= 5),
    max_violations INTEGER NOT NULL DEFAULT 3 CHECK (max_violations >= 0),
    concurrent_policy TEXT NOT NULL DEFAULT 'KICK_OLD' CHECK (concurrent_policy IN ('KICK_OLD', 'BLOCK_NEW')),
    require_fullscreen BOOLEAN NOT NULL DEFAULT false,
    is_locked BOOLEAN NOT NULL DEFAULT false,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_match_rooms_code ON public.match_rooms(room_code);
CREATE INDEX IF NOT EXISTS idx_match_rooms_status ON public.match_rooms(status, created_at DESC);

-- 2. PHIÊN THI CỦA THÍ SINH
CREATE TABLE IF NOT EXISTS public.match_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES public.match_rooms(id) ON DELETE CASCADE,
    player_key TEXT NOT NULL,
    player_name TEXT NOT NULL,
    active_session_token TEXT NOT NULL,
    question_order JSONB NOT NULL DEFAULT '[]'::jsonb,
    option_map JSONB NOT NULL DEFAULT '{}'::jsonb,
    current_index INTEGER NOT NULL DEFAULT 0,
    question_started_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'JOINED' CHECK (status IN ('JOINED', 'IN_PROGRESS', 'SUBMITTED', 'FORCED')),
    correct_count INTEGER NOT NULL DEFAULT 0,
    wrong_count INTEGER NOT NULL DEFAULT 0,
    score INTEGER NOT NULL DEFAULT 0,
    total_time_ms BIGINT NOT NULL DEFAULT 0,
    violation_count INTEGER NOT NULL DEFAULT 0,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ,
    finish_reason TEXT,
    UNIQUE (room_id, player_key)
);

CREATE INDEX IF NOT EXISTS idx_match_attempts_room ON public.match_attempts(room_id, correct_count DESC, score DESC, total_time_ms ASC);

-- 3. LỊCH SỬ TRẢ LỜI TỪNG CÂU
CREATE TABLE IF NOT EXISTS public.match_answers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID NOT NULL REFERENCES public.match_attempts(id) ON DELETE CASCADE,
    question_id INTEGER NOT NULL,
    question_shown_at TIMESTAMPTZ,
    answered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    response_time_ms INTEGER NOT NULL DEFAULT 0,
    selected_display INTEGER,
    selected_original INTEGER,
    text_answer TEXT,
    is_correct BOOLEAN NOT NULL DEFAULT false,
    points_awarded INTEGER NOT NULL DEFAULT 0,
    submission_seq INTEGER NOT NULL DEFAULT 1,
    UNIQUE (attempt_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_match_answers_attempt ON public.match_answers(attempt_id, answered_at ASC);

-- 4. NHẬT KÝ KIỂM TOÁN & CHỐNG GIAN LẬN
CREATE TABLE IF NOT EXISTS public.match_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES public.match_rooms(id) ON DELETE CASCADE,
    attempt_id UUID REFERENCES public.match_attempts(id) ON DELETE CASCADE,
    player_name TEXT NOT NULL DEFAULT '',
    event_type TEXT NOT NULL,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_match_audit_logs_room ON public.match_audit_logs(room_id, created_at DESC);

-- RLS CƠ BẢN (Truy cập ghi/chấm qua RPC SECURITY DEFINER; không cho anon đọc trực tiếp token/option_map)
ALTER TABLE public.match_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read rooms" ON public.match_rooms;
CREATE POLICY "Public read rooms" ON public.match_rooms FOR SELECT TO anon, authenticated USING (true);

-- Thu hồi quyền đọc trực tiếp match_attempts & match_audit_logs của anon để tránh lộ active_session_token, question_order, option_map
DROP POLICY IF EXISTS "Public read leaderboard attempts" ON public.match_attempts;
DROP POLICY IF EXISTS "Public read audit logs" ON public.match_audit_logs;

-- Bật Realtime cho phòng (match_attempts không broadcast công khai để bảo vệ active_session_token)
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.match_rooms;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =========================================================================
-- RPC 1: ĐỒNG BỘ ĐỒNG HỒ MÁY CHỦ
-- =========================================================================
CREATE OR REPLACE FUNCTION public.arena_get_server_time()
RETURNS TIMESTAMPTZ
LANGUAGE SQL
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT NOW();
$$;

-- =========================================================================
-- RPC 2: TẠO BÀI KIỂM TRA (Mở ngay để học sinh vào làm tự do theo khung giờ)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.arena_create_room(
    p_title TEXT,
    p_subject_key TEXT,
    p_match_duration_sec INTEGER DEFAULT 600,
    p_per_question_sec INTEGER DEFAULT NULL,
    p_max_violations INTEGER DEFAULT 3,
    p_concurrent_policy TEXT DEFAULT 'KICK_OLD',
    p_require_fullscreen BOOLEAN DEFAULT false
)
RETURNS public.match_rooms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_code TEXT;
    v_room public.match_rooms;
BEGIN
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
        COALESCE(NULLIF(TRIM(p_title), ''), 'Bài kiểm tra'),
        COALESCE(NULLIF(TRIM(p_subject_key), ''), 'history'),
        GREATEST(30, COALESCE(p_match_duration_sec, 600)),
        CASE WHEN p_per_question_sec IS NOT NULL AND p_per_question_sec >= 5 THEN p_per_question_sec ELSE NULL END,
        GREATEST(0, COALESCE(p_max_violations, 3)),
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

-- =========================================================================
-- RPC 3: TRA CỨU BẢNG XẾP HẠNG, TRẠNG THÁI PHIÊN & NHẬT KÝ AN TOÀN
-- =========================================================================
CREATE OR REPLACE FUNCTION public.arena_get_leaderboard(p_room_id UUID)
RETURNS TABLE (
    id UUID,
    player_name TEXT,
    status TEXT,
    correct_count INTEGER,
    wrong_count INTEGER,
    score INTEGER,
    total_time_ms BIGINT,
    violation_count INTEGER,
    finish_reason TEXT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT
        a.id,
        a.player_name,
        a.status,
        a.correct_count,
        a.wrong_count,
        a.score,
        a.total_time_ms,
        a.violation_count,
        a.finish_reason
    FROM public.match_attempts a
    WHERE a.room_id = p_room_id
    ORDER BY a.correct_count DESC, a.score DESC, a.total_time_ms ASC, a.violation_count ASC;
$$;

CREATE OR REPLACE FUNCTION public.arena_get_room_state(
    p_room_id UUID,
    p_attempt_id UUID DEFAULT NULL,
    p_session_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_room public.match_rooms;
    v_attempt public.match_attempts;
    v_session_replaced BOOLEAN := false;
    v_safe_attempt JSONB := NULL;
BEGIN
    SELECT * INTO v_room FROM public.match_rooms WHERE id = p_room_id;
    IF v_room.id IS NULL THEN
        RETURN jsonb_build_object('room', NULL, 'attempt', NULL, 'session_replaced', false);
    END IF;

    IF p_attempt_id IS NOT NULL THEN
        SELECT * INTO v_attempt FROM public.match_attempts WHERE id = p_attempt_id AND room_id = p_room_id;
        IF v_attempt.id IS NOT NULL THEN
            IF p_session_token IS NOT NULL AND v_attempt.active_session_token <> p_session_token THEN
                v_session_replaced := true;
            ELSE
                v_safe_attempt := jsonb_build_object(
                    'id', v_attempt.id,
                    'room_id', v_attempt.room_id,
                    'player_name', v_attempt.player_name,
                    'current_index', v_attempt.current_index,
                    'question_started_at', v_attempt.question_started_at,
                    'status', v_attempt.status,
                    'correct_count', v_attempt.correct_count,
                    'wrong_count', v_attempt.wrong_count,
                    'score', v_attempt.score,
                    'total_time_ms', v_attempt.total_time_ms,
                    'violation_count', v_attempt.violation_count,
                    'started_at', v_attempt.started_at,
                    'submitted_at', v_attempt.submitted_at,
                    'finish_reason', v_attempt.finish_reason
                );
            END IF;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'room', to_jsonb(v_room),
        'attempt', v_safe_attempt,
        'session_replaced', v_session_replaced
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.arena_get_audit_logs(p_room_id UUID)
RETURNS TABLE (
    player_name TEXT,
    event_type TEXT,
    meta JSONB,
    created_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT
        l.player_name,
        l.event_type,
        l.meta - 'attempted_token' - 'new_token',
        l.created_at
    FROM public.match_audit_logs l
    WHERE l.room_id = p_room_id
    ORDER BY l.created_at DESC
    LIMIT 40;
$$;

-- =========================================================================
-- RPC 4: THAM GIA PHÒNG THI + XÁO TRỘN ĐỀ & ĐÁP ÁN KHÔNG LỘ ĐÁP ÁN ĐÚNG
-- =========================================================================
CREATE OR REPLACE FUNCTION public.arena_join_room(
    p_room_code TEXT,
    p_player_name TEXT,
    p_player_key TEXT,
    p_session_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_room public.match_rooms;
    v_attempt public.match_attempts;
    v_now TIMESTAMPTZ := NOW();
    v_q_ids INTEGER[];
    v_option_map JSONB := '{}'::jsonb;
    v_q RECORD;
    v_perm JSONB;
    v_questions JSONB;
BEGIN
    SELECT * INTO v_room
    FROM public.match_rooms
    WHERE room_code = UPPER(TRIM(p_room_code))
    FOR UPDATE;

    IF v_room.id IS NULL THEN
        RAISE EXCEPTION 'Không tìm thấy mã phòng %', p_room_code;
    END IF;

    IF v_room.status IN ('FINISHED', 'CANCELLED') OR v_room.is_locked THEN
        RAISE EXCEPTION 'Bài kiểm tra đã đóng';
    END IF;

    SELECT * INTO v_attempt
    FROM public.match_attempts
    WHERE room_id = v_room.id AND player_key = LOWER(TRIM(p_player_key))
    FOR UPDATE;

    IF v_attempt.id IS NOT NULL THEN
        IF v_attempt.status IN ('SUBMITTED', 'FORCED') THEN
            RAISE EXCEPTION 'Bạn đã hoàn thành bài kiểm tra này';
        END IF;

        IF v_attempt.started_at IS NOT NULL
           AND v_now > (v_attempt.started_at + (v_room.match_duration_sec * INTERVAL '1 second') + INTERVAL '3 seconds') THEN
            UPDATE public.match_attempts
            SET status = 'SUBMITTED',
                submitted_at = v_now,
                finish_reason = 'TIME_UP'
            WHERE id = v_attempt.id;
            RAISE EXCEPTION 'Hết thời gian làm bài';
        END IF;

        IF v_attempt.active_session_token <> p_session_token THEN
            IF v_room.concurrent_policy = 'BLOCK_NEW' THEN
                INSERT INTO public.match_audit_logs (room_id, attempt_id, player_name, event_type, meta)
                VALUES (v_room.id, v_attempt.id, p_player_name, 'CONCURRENT_LOGIN_BLOCKED', '{}'::jsonb);
                RAISE EXCEPTION 'Tài khoản đang làm bài ở một thiết bị khác';
            ELSE
                UPDATE public.match_attempts
                SET active_session_token = p_session_token
                WHERE id = v_attempt.id
                RETURNING * INTO v_attempt;

                INSERT INTO public.match_audit_logs (room_id, attempt_id, player_name, event_type, meta)
                VALUES (v_room.id, v_attempt.id, p_player_name, 'CONCURRENT_LOGIN_REPLACED', '{}'::jsonb);
            END IF;
        END IF;
    ELSE
        SELECT ARRAY_AGG(id ORDER BY RANDOM()) INTO v_q_ids
        FROM public.quiz_questions
        WHERE subject_key = v_room.subject_key AND COALESCE(is_deleted, false) = false;

        IF v_q_ids IS NULL OR ARRAY_LENGTH(v_q_ids, 1) = 0 THEN
            RAISE EXCEPTION 'Môn học này chưa có câu hỏi nào trên hệ thống';
        END IF;

        FOR v_q IN
            SELECT id, q_type, options
            FROM public.quiz_questions
            WHERE id = ANY(v_q_ids)
        LOOP
            IF COALESCE(v_q.q_type, 'mcq') = 'mcq' AND jsonb_array_length(COALESCE(v_q.options, '[]'::jsonb)) > 1 THEN
                SELECT jsonb_agg(idx ORDER BY RANDOM()) INTO v_perm
                FROM generate_series(0, jsonb_array_length(v_q.options) - 1) AS idx;
                v_option_map := jsonb_set(v_option_map, ARRAY[v_q.id::TEXT], v_perm);
            END IF;
        END LOOP;

        INSERT INTO public.match_attempts (
            room_id, player_key, player_name, active_session_token,
            question_order, option_map, status,
            started_at, question_started_at
        )
        VALUES (
            v_room.id,
            LOWER(TRIM(p_player_key)),
            TRIM(p_player_name),
            p_session_token,
            to_jsonb(v_q_ids),
            v_option_map,
            'IN_PROGRESS',
            v_now,
            v_now
        )
        RETURNING * INTO v_attempt;

        INSERT INTO public.match_audit_logs (room_id, attempt_id, player_name, event_type, meta)
        VALUES (v_room.id, v_attempt.id, v_attempt.player_name, 'PLAYER_JOINED', '{}'::jsonb);
    END IF;

    -- Build sanitized question payload (KHÔNG trả correct/correct_value/explanation/statements.answer)
    SELECT jsonb_agg(
        jsonb_build_object(
            'id', q.id,
            'qType', COALESCE(q.q_type, 'mcq'),
            'category', q.category,
            'question', q.question,
            'image_url', q.image_url,
            'statements', CASE
                WHEN q.q_type = 'tf_group' THEN (
                    SELECT COALESCE(jsonb_agg(jsonb_build_object('text', s->>'text')), '[]'::jsonb)
                    FROM jsonb_array_elements(COALESCE(q.statements, '[]'::jsonb)) AS s
                )
                ELSE '[]'::jsonb
            END,
            'options', CASE
                WHEN COALESCE(q.q_type, 'mcq') = 'mcq' AND (v_attempt.option_map ? q.id::TEXT) THEN (
                    SELECT jsonb_agg(q.options->(perm_idx::INT) ORDER BY ord)
                    FROM jsonb_array_elements_text(v_attempt.option_map->(q.id::TEXT)) WITH ORDINALITY AS t(perm_idx, ord)
                )
                ELSE COALESCE(q.options, '[]'::jsonb)
            END
        )
        ORDER BY ord_q.ord
    ) INTO v_questions
    FROM jsonb_array_elements_text(v_attempt.question_order) WITH ORDINALITY AS ord_q(qid, ord)
    JOIN public.quiz_questions q ON q.id = ord_q.qid::INTEGER;

    RETURN jsonb_build_object(
        'server_now', v_now,
        'room', to_jsonb(v_room),
        'attempt', jsonb_build_object(
            'id', v_attempt.id,
            'room_id', v_attempt.room_id,
            'player_name', v_attempt.player_name,
            'current_index', v_attempt.current_index,
            'question_started_at', v_attempt.question_started_at,
            'status', v_attempt.status,
            'correct_count', v_attempt.correct_count,
            'wrong_count', v_attempt.wrong_count,
            'score', v_attempt.score,
            'total_time_ms', v_attempt.total_time_ms,
            'violation_count', v_attempt.violation_count,
            'started_at', v_attempt.started_at,
            'submitted_at', v_attempt.submitted_at,
            'finish_reason', v_attempt.finish_reason
        ),
        'questions', COALESCE(v_questions, '[]'::jsonb)
    );
END;
$$;

-- =========================================================================
-- RPC 5: GỬI ĐÁP ÁN + CHẤM ĐIỂM TRÊN MÁY CHỦ (Idempotent & Grace Window)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.arena_submit_answer(
    p_attempt_id UUID,
    p_session_token TEXT,
    p_question_id INTEGER,
    p_selected_display INTEGER DEFAULT NULL,
    p_text_answer TEXT DEFAULT NULL,
    p_submission_seq INTEGER DEFAULT 1,
    p_tf_answers JSONB DEFAULT NULL,
    p_is_offline_sync BOOLEAN DEFAULT false,
    p_client_elapsed_ms INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_attempt public.match_attempts;
    v_room public.match_rooms;
    v_q public.quiz_questions;
    v_existing public.match_answers;
    v_now TIMESTAMPTZ := NOW();
    v_orig_idx INTEGER := NULL;
    v_is_correct BOOLEAN := false;
    v_points INTEGER := 0;
    v_resp_ms INTEGER := 0;
    v_speed_bonus INTEGER := 0;
    v_ref_start TIMESTAMPTZ;
    v_tf_arr JSONB;
    v_total_stmts INTEGER := 0;
    v_matched_stmts INTEGER := 0;
    v_idx INTEGER;
    v_user_val TEXT;
    v_expected_val BOOLEAN;
    v_timed_out BOOLEAN := false;
BEGIN
    SELECT * INTO v_attempt FROM public.match_attempts WHERE id = p_attempt_id FOR UPDATE;
    IF v_attempt.id IS NULL THEN
        RAISE EXCEPTION 'Không tìm thấy phiên thi';
    END IF;
    IF v_attempt.active_session_token <> p_session_token THEN
        RAISE EXCEPTION 'SESSION_REPLACED';
    END IF;
    IF v_attempt.status IN ('SUBMITTED', 'FORCED') THEN
        RETURN jsonb_build_object('already_submitted', true, 'attempt', to_jsonb(v_attempt));
    END IF;

    SELECT * INTO v_room FROM public.match_rooms WHERE id = v_attempt.room_id;
    IF v_room.status IN ('FINISHED', 'CANCELLED')
       OR (NOT COALESCE(p_is_offline_sync, false) AND v_attempt.started_at IS NOT NULL AND v_now > (v_attempt.started_at + (v_room.match_duration_sec * INTERVAL '1 second') + INTERVAL '3 seconds')) THEN
        UPDATE public.match_attempts
        SET status = 'SUBMITTED', submitted_at = v_now, finish_reason = 'TIME_UP'
        WHERE id = v_attempt.id
        RETURNING * INTO v_attempt;
        RAISE EXCEPTION 'MATCH_TIME_UP';
    END IF;

    -- Idempotency check
    SELECT * INTO v_existing FROM public.match_answers WHERE attempt_id = p_attempt_id AND question_id = p_question_id;
    IF v_existing.id IS NOT NULL THEN
        RETURN jsonb_build_object('duplicate', true, 'attempt', to_jsonb(v_attempt), 'answer', to_jsonb(v_existing));
    END IF;

    v_ref_start := COALESCE(v_attempt.question_started_at, v_attempt.started_at, v_room.started_at, v_now);
    v_resp_ms := GREATEST(0, ROUND(EXTRACT(EPOCH FROM (v_now - v_ref_start)) * 1000)::INTEGER);

    IF COALESCE(p_is_offline_sync, false) AND p_client_elapsed_ms IS NOT NULL AND p_client_elapsed_ms >= 0 THEN
        v_resp_ms := LEAST(v_resp_ms, p_client_elapsed_ms);
    END IF;

    IF v_room.per_question_sec IS NOT NULL THEN
        IF COALESCE(p_is_offline_sync, false) AND p_client_elapsed_ms IS NOT NULL THEN
            v_timed_out := (p_client_elapsed_ms > ((v_room.per_question_sec + 2) * 1000));
        ELSE
            v_timed_out := (v_now > (v_ref_start + ((v_room.per_question_sec + 2) * INTERVAL '1 second')));
        END IF;
    END IF;

    IF v_timed_out THEN
        INSERT INTO public.match_answers (attempt_id, question_id, question_shown_at, answered_at, response_time_ms, is_correct, points_awarded, submission_seq)
        VALUES (p_attempt_id, p_question_id, v_ref_start, v_now, v_resp_ms, false, 0, p_submission_seq);

        UPDATE public.match_attempts
        SET current_index = current_index + 1,
            question_started_at = v_now,
            wrong_count = wrong_count + 1
        WHERE id = p_attempt_id
        RETURNING * INTO v_attempt;

        RETURN jsonb_build_object('question_timeout', true, 'attempt', to_jsonb(v_attempt));
    END IF;

    SELECT * INTO v_q FROM public.quiz_questions WHERE id = p_question_id;
    IF COALESCE(v_q.q_type, 'mcq') = 'mcq' AND p_selected_display IS NOT NULL THEN
        IF v_attempt.option_map ? p_question_id::TEXT THEN
            v_orig_idx := (v_attempt.option_map->(p_question_id::TEXT)->>p_selected_display)::INTEGER;
        ELSE
            v_orig_idx := p_selected_display;
        END IF;
        v_is_correct := (v_orig_idx = COALESCE(v_q.correct, v_q.answer, 0));
    ELSIF v_q.q_type = 'short_answer' THEN
        v_is_correct := LOWER(TRIM(COALESCE(p_text_answer, ''))) = LOWER(TRIM(COALESCE(v_q.correct_value, '')));
    ELSIF v_q.q_type = 'tf_group' THEN
        v_total_stmts := jsonb_array_length(COALESCE(v_q.statements, '[]'::jsonb));
        v_tf_arr := COALESCE(
            p_tf_answers,
            CASE
                WHEN p_text_answer IS NOT NULL AND LEFT(TRIM(p_text_answer), 1) = '[' THEN p_text_answer::jsonb
                ELSE '[]'::jsonb
            END
        );
        IF v_total_stmts > 0 AND jsonb_typeof(v_tf_arr) = 'array' THEN
            FOR v_idx IN 0 .. (v_total_stmts - 1) LOOP
                v_user_val := LOWER(TRIM(COALESCE(v_tf_arr->>v_idx, '')));
                v_expected_val := COALESCE((v_q.statements->v_idx->>'answer')::BOOLEAN, false);
                IF (v_user_val = 'true' AND v_expected_val = true) OR (v_user_val = 'false' AND v_expected_val = false) THEN
                    v_matched_stmts := v_matched_stmts + 1;
                END IF;
            END LOOP;
            v_is_correct := (v_matched_stmts = v_total_stmts);
        END IF;
    END IF;

    IF v_is_correct THEN
        IF v_room.per_question_sec IS NOT NULL THEN
            v_speed_bonus := GREATEST(0, LEAST(20, ROUND(20.0 * (1.0 - (v_resp_ms / (v_room.per_question_sec * 1000.0))))::INTEGER));
        ELSE
            v_speed_bonus := GREATEST(0, LEAST(20, 20 - FLOOR(v_resp_ms / 3000.0)::INTEGER));
        END IF;
        v_points := 100 + v_speed_bonus;
    END IF;

    INSERT INTO public.match_answers (
        attempt_id, question_id, question_shown_at, answered_at,
        response_time_ms, selected_display, selected_original,
        text_answer, is_correct, points_awarded, submission_seq
    )
    VALUES (
        p_attempt_id, p_question_id, v_ref_start, v_now,
        v_resp_ms, p_selected_display, v_orig_idx,
        COALESCE(p_text_answer, p_tf_answers::TEXT), v_is_correct, v_points, p_submission_seq
    );

    UPDATE public.match_attempts
    SET current_index = current_index + 1,
        question_started_at = v_now,
        correct_count = correct_count + CASE WHEN v_is_correct THEN 1 ELSE 0 END,
        wrong_count = wrong_count + CASE WHEN NOT v_is_correct THEN 1 ELSE 0 END,
        score = score + v_points,
        total_time_ms = total_time_ms + v_resp_ms
    WHERE id = p_attempt_id
    RETURNING * INTO v_attempt;

    RETURN jsonb_build_object(
        'recorded', true,
        'attempt', to_jsonb(v_attempt),
        'server_now', v_now
    );
END;
$$;

-- =========================================================================
-- RPC 6: GHI NHẬN VI PHẠM & TỰ ĐỘNG NỘP BÀI KHI VƯỢT NGƯỠNG
-- =========================================================================
CREATE OR REPLACE FUNCTION public.arena_log_violation(
    p_attempt_id UUID,
    p_session_token TEXT,
    p_event_type TEXT,
    p_meta JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_attempt public.match_attempts;
    v_room public.match_rooms;
    v_forced BOOLEAN := false;
BEGIN
    SELECT * INTO v_attempt FROM public.match_attempts WHERE id = p_attempt_id FOR UPDATE;
    IF v_attempt.id IS NULL THEN RAISE EXCEPTION 'Không tìm thấy phiên thi'; END IF;
    IF v_attempt.active_session_token <> p_session_token THEN RAISE EXCEPTION 'SESSION_REPLACED'; END IF;
    IF v_attempt.status IN ('SUBMITTED', 'FORCED') THEN
        RETURN jsonb_build_object('forced', v_attempt.status = 'FORCED', 'attempt', to_jsonb(v_attempt));
    END IF;

    SELECT * INTO v_room FROM public.match_rooms WHERE id = v_attempt.room_id;

    UPDATE public.match_attempts
    SET violation_count = violation_count + 1
    WHERE id = p_attempt_id
    RETURNING * INTO v_attempt;

    INSERT INTO public.match_audit_logs (room_id, attempt_id, player_name, event_type, meta)
    VALUES (v_room.id, v_attempt.id, v_attempt.player_name, p_event_type, COALESCE(p_meta, '{}'::jsonb));

    IF v_attempt.violation_count >= GREATEST(1, v_room.max_violations) THEN
        v_forced := true;
        UPDATE public.match_attempts
        SET status = 'FORCED',
            submitted_at = NOW(),
            finish_reason = 'FORCED_VIOLATION'
        WHERE id = p_attempt_id
        RETURNING * INTO v_attempt;

        INSERT INTO public.match_audit_logs (room_id, attempt_id, player_name, event_type, meta)
        VALUES (v_room.id, v_attempt.id, v_attempt.player_name, 'FORCED_SUBMIT', jsonb_build_object('violation_count', v_attempt.violation_count));
    END IF;

    RETURN jsonb_build_object('forced', v_forced, 'attempt', to_jsonb(v_attempt));
END;
$$;

-- =========================================================================
-- RPC 7: NỘP BÀI / KẾT THÚC PHIÊN / KẾT THÚC PHÒNG
-- =========================================================================
CREATE OR REPLACE FUNCTION public.arena_finish_attempt(
    p_attempt_id UUID,
    p_session_token TEXT,
    p_reason TEXT DEFAULT 'USER_SUBMIT'
)
RETURNS public.match_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_attempt public.match_attempts;
BEGIN
    SELECT * INTO v_attempt FROM public.match_attempts WHERE id = p_attempt_id FOR UPDATE;
    IF v_attempt.id IS NULL THEN
        RAISE EXCEPTION 'Không tìm thấy phiên thi';
    END IF;
    IF v_attempt.active_session_token <> p_session_token THEN
        RAISE EXCEPTION 'SESSION_REPLACED';
    END IF;
    IF v_attempt.status IN ('SUBMITTED', 'FORCED') THEN
        RETURN v_attempt;
    END IF;

    UPDATE public.match_attempts
    SET status = 'SUBMITTED',
        submitted_at = COALESCE(submitted_at, NOW()),
        finish_reason = COALESCE(finish_reason, p_reason)
    WHERE id = p_attempt_id
    RETURNING * INTO v_attempt;

    INSERT INTO public.match_audit_logs (room_id, attempt_id, player_name, event_type, meta)
    VALUES (v_attempt.room_id, v_attempt.id, v_attempt.player_name, 'ATTEMPT_SUBMITTED', jsonb_build_object('reason', p_reason, 'score', v_attempt.score, 'correct_count', v_attempt.correct_count));

    RETURN v_attempt;
END;
$$;

CREATE OR REPLACE FUNCTION public.arena_end_room(p_room_id UUID)
RETURNS public.match_rooms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_room public.match_rooms;
BEGIN
    UPDATE public.match_rooms
    SET status = 'FINISHED',
        is_locked = true,
        ended_at = NOW()
    WHERE id = p_room_id
    RETURNING * INTO v_room;

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
