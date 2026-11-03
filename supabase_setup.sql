-- ==============================================================================
-- SUPABASE SQL SETUP SCRIPT: QUIZ_RESULTS & QUIZ_QUESTIONS
-- ==============================================================================

-- 1. Bảng lưu kết quả thi của thí sinh
CREATE TABLE IF NOT EXISTS public.quiz_results (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    player_name TEXT NOT NULL,
    score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
    correct_count INTEGER NOT NULL DEFAULT 0,
    total_questions INTEGER NOT NULL DEFAULT 65,
    time_spent_seconds INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quiz_results_score_time 
ON public.quiz_results (score DESC, time_spent_seconds ASC);

ALTER TABLE public.quiz_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Cho phép xem bảng xếp hạng công khai" ON public.quiz_results;
CREATE POLICY "Cho phép xem bảng xếp hạng công khai"
ON public.quiz_results FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "Cho phép người chơi nộp điểm công khai" ON public.quiz_results;
CREATE POLICY "Cho phép người chơi nộp điểm công khai"
ON public.quiz_results FOR INSERT TO public WITH CHECK (true);

-- 2. Bảng lưu trữ và quản lý ngân hàng câu hỏi động (Cho phép Admin chỉnh sửa trực tuyến)
CREATE TABLE IF NOT EXISTS public.quiz_questions (
    id SERIAL PRIMARY KEY,
    category TEXT NOT NULL DEFAULT 'Lịch Sử 11',
    question TEXT NOT NULL,
    options JSONB NOT NULL,
    correct INTEGER NOT NULL DEFAULT 0,
    explanation TEXT DEFAULT '',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.quiz_questions ENABLE ROW LEVEL SECURITY;

-- Cho phép mọi người đọc câu hỏi
DROP POLICY IF EXISTS "Cho phép đọc câu hỏi công khai" ON public.quiz_questions;
CREATE POLICY "Cho phép đọc câu hỏi công khai"
ON public.quiz_questions FOR SELECT TO public USING (true);

-- Cho phép Admin thêm/sửa/xóa câu hỏi
DROP POLICY IF EXISTS "Cho phép Admin chỉnh sửa câu hỏi" ON public.quiz_questions;
CREATE POLICY "Cho phép Admin chỉnh sửa câu hỏi"
ON public.quiz_questions FOR ALL TO public USING (true);
