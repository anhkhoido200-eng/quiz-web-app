-- ==============================================================================
-- SUPABASE SQL SETUP SCRIPT: QUIZ_RESULTS & LEADERBOARD
-- Hướng dẫn: Dán toàn bộ nội dung script này vào "SQL Editor" trên trang quản trị
-- của dự án Supabase (https://supabase.com/dashboard/project/<your-project-id>/sql)
-- và nhấn "RUN".
-- ==============================================================================

-- 1. Tạo bảng lưu kết quả làm bài trắc nghiệm
CREATE TABLE IF NOT EXISTS public.quiz_results (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    player_name TEXT NOT NULL,
    score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
    correct_count INTEGER NOT NULL DEFAULT 0,
    total_questions INTEGER NOT NULL DEFAULT 10,
    time_spent_seconds INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Đặt chỉ mục (Indexes) để tăng tốc độ truy vấn sắp xếp Bảng xếp hạng
CREATE INDEX IF NOT EXISTS idx_quiz_results_score_time 
ON public.quiz_results (score DESC, time_spent_seconds ASC);

-- 3. Bật bảo mật Row Level Security (RLS)
ALTER TABLE public.quiz_results ENABLE ROW LEVEL SECURITY;

-- 4. Tạo Policy cho phép mọi người (Anonymous/Public) xem Bảng xếp hạng
DROP POLICY IF EXISTS "Cho phép xem bảng xếp hạng công khai" ON public.quiz_results;
CREATE POLICY "Cho phép xem bảng xếp hạng công khai"
ON public.quiz_results
FOR SELECT
TO public
USING (true);

-- 5. Tạo Policy cho phép mọi người (Anonymous/Public) thêm kết quả làm bài
DROP POLICY IF EXISTS "Cho phép người chơi nộp điểm công khai" ON public.quiz_results;
CREATE POLICY "Cho phép người chơi nộp điểm công khai"
ON public.quiz_results
FOR INSERT
TO public
WITH CHECK (
    char_length(player_name) > 0 AND
    char_length(player_name) <= 50 AND
    score >= 0 AND 
    score <= 100
);

-- 6. (Tùy chọn) Thêm dữ liệu mẫu ban đầu để bảng xếp hạng trông sinh động
INSERT INTO public.quiz_results (player_name, score, correct_count, total_questions, time_spent_seconds)
VALUES 
    ('Minh Tuấn (Top 1)', 100, 10, 10, 85),
    ('Lan Anh (Á Khoa)', 90, 9, 10, 104),
    ('Hải Đăng', 80, 8, 10, 120),
    ('Thanh Trúc', 70, 7, 10, 145)
ON CONFLICT DO NOTHING;
