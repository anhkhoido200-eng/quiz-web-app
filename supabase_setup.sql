-- ==============================================================================
-- SUPABASE SQL SETUP SCRIPT: QUIZ_LOGINS & QUIZ_QUESTIONS
-- ==============================================================================

-- 1. Bảng lưu lịch sử ĐĂNG NHẬP, ĐỊA CHỈ IP & THIẾT BỊ CỦA THÍ SINH
CREATE TABLE IF NOT EXISTS public.quiz_logins (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    player_name TEXT NOT NULL,
    ip_address TEXT NOT NULL DEFAULT 'Chưa xác định',
    device_info TEXT DEFAULT '',
    status TEXT DEFAULT 'Đang ôn tập',
    score_summary TEXT DEFAULT '',
    last_active TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quiz_logins_ip ON public.quiz_logins (ip_address);
CREATE INDEX IF NOT EXISTS idx_quiz_logins_time ON public.quiz_logins (last_active DESC);

ALTER TABLE public.quiz_logins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Cho phép đọc đăng nhập công khai" ON public.quiz_logins;
CREATE POLICY "Cho phép đọc đăng nhập công khai"
ON public.quiz_logins FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "Cho phép ghi nhận lượt đăng nhập" ON public.quiz_logins;
CREATE POLICY "Cho phép ghi nhận lượt đăng nhập"
ON public.quiz_logins FOR INSERT TO public WITH CHECK (true);

DROP POLICY IF EXISTS "Cho phép cập nhật trạng thái làm bài" ON public.quiz_logins;
CREATE POLICY "Cho phép cập nhật trạng thái làm bài"
ON public.quiz_logins FOR UPDATE TO public USING (true);

DROP POLICY IF EXISTS "Cho phép Admin xóa nhật ký đăng nhập" ON public.quiz_logins;
CREATE POLICY "Cho phép Admin xóa nhật ký đăng nhập"
ON public.quiz_logins FOR DELETE TO public USING (true);


-- 2. Bảng lưu trữ và quản lý ngân hàng câu hỏi (Cho phép đồng bộ tức thì cho MỌI THIẾT BỊ)
CREATE TABLE IF NOT EXISTS public.quiz_questions (
    id INTEGER PRIMARY KEY,
    q_type TEXT DEFAULT 'mcq',
    category TEXT NOT NULL DEFAULT 'Lịch Sử 11',
    question TEXT NOT NULL,
    options JSONB DEFAULT '[]'::jsonb,
    correct INTEGER DEFAULT 0,
    statements JSONB DEFAULT '[]'::jsonb,
    explanation TEXT DEFAULT '',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.quiz_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Cho phép đọc câu hỏi công khai" ON public.quiz_questions;
CREATE POLICY "Cho phép đọc câu hỏi công khai"
ON public.quiz_questions FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "Cho phép Admin chỉnh sửa câu hỏi" ON public.quiz_questions;
CREATE POLICY "Cho phép Admin chỉnh sửa câu hỏi"
ON public.quiz_questions FOR ALL TO public USING (true);
