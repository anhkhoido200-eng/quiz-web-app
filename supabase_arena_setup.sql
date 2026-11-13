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

-- RLS CƠ BẢN (Truy cập ghi/chấm qua RPC SECURITY DEFINER)
ALTER TABLE public.match_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read rooms" ON public.match_rooms;
CREATE POLICY "Public read rooms" ON public.match_rooms FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public read leaderboard attempts" ON public.match_attempts;
CREATE POLICY "Public read leaderboard attempts" ON public.match_attempts FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public read audit logs" ON public.match_audit_logs;
CREATE POLICY "Public read audit logs" ON public.match_audit_logs FOR SELECT TO anon, authenticated USING (true);

-- Bật Realtime cho phòng và lượt thi
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.match_rooms;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.match_attempts;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =========================================================================
-- RPC 1: ĐỒNG BỘ ĐỒNG HỒ MÁY CHỦ
-- =========================================================================
CREATE OR REPLACE FUNCTION public.arena_get_server_time()
RETURNS TIMESTAMPTZ
LANGUAGE SQL
STABLE
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

        IF v_attempt.active_session_token <> p_session_token THEN
            IF v_room.concurrent_policy = 'BLOCK_NEW' THEN
                INSERT INTO public.match_audit_logs (room_id, attempt_id, player_name, event_type, meta)
                VALUES (v_room.id, v_attempt.id, p_player_name, 'CONCURRENT_LOGIN_BLOCKED', jsonb_build_object('attempted_token', p_session_token));
                RAISE EXCEPTION 'Tài khoản đang làm bài ở một thiết bị khác';
            ELSE
                UPDATE public.match_attempts
                SET active_session_token = p_session_token
                WHERE id = v_attempt.id
                RETURNING * INTO v_attempt;

                INSERT INTO public.match_audit_logs (room_id, attempt_id, player_name, event_type, meta)
                VALUES (v_room.id, v_attempt.id, p_player_name, 'CONCURRENT_LOGIN_REPLACED', jsonb_build_object('new_token', p_session_token));
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

    -- Build sanitized question payload (KHÔNG trả correct/correct_value/explanation)
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
        'attempt', to_jsonb(v_attempt),
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
    p_submission_seq INTEGER DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
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
    IF v_room.status IN ('FINISHED', 'CANCELLED') OR (v_attempt.started_at IS NOT NULL AND v_now > (v_attempt.started_at + (v_room.match_duration_sec * INTERVAL '1 second') + INTERVAL '3 seconds')) THEN
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
    v_resp_ms := GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_ref_start))::INTEGER * 1000);

    IF v_room.per_question_sec IS NOT NULL AND v_now > (v_ref_start + ((v_room.per_question_sec + 2) * INTERVAL '1 second')) THEN
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
        p_text_answer, v_is_correct, v_points, p_submission_seq
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

    IF v_room.max_violations > 0 AND v_attempt.violation_count >= v_room.max_violations THEN
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
AS $$
DECLARE
    v_attempt public.match_attempts;
BEGIN
    UPDATE public.match_attempts
    SET status = 'SUBMITTED',
        submitted_at = COALESCE(submitted_at, NOW()),
        finish_reason = COALESCE(finish_reason, p_reason)
    WHERE id = p_attempt_id
      AND active_session_token = p_session_token
      AND status NOT IN ('SUBMITTED', 'FORCED')
    RETURNING * INTO v_attempt;

    IF v_attempt.id IS NULL THEN
        SELECT * INTO v_attempt FROM public.match_attempts WHERE id = p_attempt_id;
        RETURN v_attempt;
    END IF;

    INSERT INTO public.match_audit_logs (room_id, attempt_id, player_name, event_type, meta)
    VALUES (v_attempt.room_id, v_attempt.id, v_attempt.player_name, 'ATTEMPT_SUBMITTED', jsonb_build_object('reason', p_reason, 'score', v_attempt.score, 'correct_count', v_attempt.correct_count));

    RETURN v_attempt;
END;
$$;

CREATE OR REPLACE FUNCTION public.arena_end_room(p_room_id UUID)
RETURNS public.match_rooms
LANGUAGE plpgsql
SECURITY DEFINER
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
