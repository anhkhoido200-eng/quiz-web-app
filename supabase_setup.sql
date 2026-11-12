-- =========================================================================
-- QUIZMASTER PRO v4.0 - SUPABASE DATABASE INITIALIZATION SCRIPT
-- =========================================================================
-- Hướng dẫn chạy:
-- 1. Mở trang quản trị Supabase (https://supabase.com/dashboard)
-- 2. Chọn dự án của bạn -> Chọn mục "SQL Editor" ở menu bên trái.
-- 3. Nhấp "New Query", dán toàn bộ nội dung script này vào và bấm "Run".
-- =========================================================================

-- 1. BẬT TIỆN ÍCH TỰ ĐỘNG SINH UUID CHUẨN
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. BẢNG 1: QUIZ_LOGINS (Quản lý lượt đăng nhập, giám sát, phân quyền & cấu hình hệ thống)
CREATE TABLE IF NOT EXISTS public.quiz_logins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_name TEXT NOT NULL,
    ip_address TEXT DEFAULT 'Chưa xác định',
    device_info TEXT DEFAULT 'Chưa rõ',
    status TEXT DEFAULT 'Đang ôn tập',
    score_summary TEXT DEFAULT '',
    session_id TEXT,
    last_active TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chỉ mục tối ưu tốc độ tra cứu tức thì cho Heartbeat & Bảng Admin
CREATE INDEX IF NOT EXISTS idx_quiz_logins_last_active ON public.quiz_logins(last_active DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_logins_ip ON public.quiz_logins(ip_address);
CREATE INDEX IF NOT EXISTS idx_quiz_logins_player_name ON public.quiz_logins(player_name);
ALTER TABLE public.quiz_logins ADD COLUMN IF NOT EXISTS session_id TEXT;
CREATE INDEX IF NOT EXISTS idx_quiz_logins_session_id ON public.quiz_logins(session_id);

-- 3. BẢNG 2: QUIZ_QUESTIONS (Ngân hàng câu hỏi động đa môn học: Sử, Lí, Địa, Toán, Hóa...)
CREATE TABLE IF NOT EXISTS public.quiz_questions (
    id SERIAL PRIMARY KEY,
    subject_key TEXT DEFAULT 'history',           -- 'history', 'physics', 'geography', hoặc mã môn động
    category TEXT DEFAULT 'Bài học',              -- Tên bài học / Chuyên đề
    q_type TEXT DEFAULT 'mcq',                    -- 'mcq' (4 lựa chọn), 'tf_group' (Đúng/Sai), 'short_answer' (Điền số)
    question TEXT NOT NULL,                       -- Nội dung câu hỏi (hỗ trợ KaTeX & HTML)
    options JSONB DEFAULT '[]'::jsonb,            -- Danh sách lựa chọn ["A", "B", "C", "D"]
    statements JSONB DEFAULT '[]'::jsonb,         -- Danh sách ý Đúng/Sai [{"text":"...", "answer":true}]
    correct INTEGER DEFAULT 0,                    -- Index đáp án đúng (0 = A, 1 = B, 2 = C, 3 = D)
    answer INTEGER DEFAULT 0,                     -- Tương thích ngược
    correct_value TEXT DEFAULT '',                -- Giá trị điền số (dành cho câu hỏi short_answer)
    explanation TEXT DEFAULT '',                  -- Lời giải thích chi tiết
    image_url TEXT DEFAULT '',                    -- Đường dẫn ảnh minh họa (nếu có)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- TỰ ĐỘNG BỔ SUNG CỘT CHO BẢNG CŨ (SỬA TRIỆT ĐỂ LỖI THIẾU CỘT subject_key & LỖI NULL ID)
ALTER TABLE public.quiz_questions ADD COLUMN IF NOT EXISTS subject_key TEXT DEFAULT 'history';
ALTER TABLE public.quiz_questions ADD COLUMN IF NOT EXISTS answer INTEGER DEFAULT 0;
ALTER TABLE public.quiz_questions ADD COLUMN IF NOT EXISTS correct_value TEXT DEFAULT '';
ALTER TABLE public.quiz_questions ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT '';
ALTER TABLE public.quiz_questions ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;
ALTER TABLE public.quiz_questions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.quiz_questions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
UPDATE public.quiz_questions SET subject_key = 'history' WHERE subject_key IS NULL;
UPDATE public.quiz_questions SET is_deleted = false WHERE is_deleted IS NULL;

-- TẠO SEQUENCE TỰ ĐỘNG TĂNG ID NẾU BẢNG BỊ THIẾU AUTO INCREMENT
CREATE SEQUENCE IF NOT EXISTS quiz_questions_id_seq;
ALTER TABLE public.quiz_questions ALTER COLUMN id SET DEFAULT nextval('quiz_questions_id_seq');
SELECT setval('quiz_questions_id_seq', GREATEST(COALESCE((SELECT MAX(id) FROM public.quiz_questions), 0) + 1, 1), false);

CREATE INDEX IF NOT EXISTS idx_quiz_questions_subject ON public.quiz_questions(subject_key);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_category ON public.quiz_questions(category);

-- 4. BẬT BẢO MẬT HÀNG (ROW LEVEL SECURITY - RLS)
ALTER TABLE public.quiz_logins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_questions ENABLE ROW LEVEL SECURITY;

-- 5. CHÍNH SÁCH TRUY CẬP CÔNG KHAI CHO WEB THI (ANON KEY CHO CLIENT SPA)
DROP POLICY IF EXISTS "Public access to quiz_logins" ON public.quiz_logins;
DROP POLICY IF EXISTS "Public read quiz_logins" ON public.quiz_logins;
CREATE POLICY "Public read quiz_logins"
ON public.quiz_logins
FOR SELECT
TO anon, authenticated
USING (true)
;
CREATE POLICY "Public access to quiz_logins"
ON public.quiz_logins
FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- CẢNH BÁO: Policy này giữ tương thích với SPA hiện tại nhưng chưa phải là
-- ranh giới bảo mật. Trước khi dùng production, chuyển ghi/đọc quiz_logins
-- sang Auth/RPC/Edge Function và thu hẹp policy để bảo vệ PII/cấu hình.

-- TODO: Khi triển khai RPC/Edge Function cho Admin, thay policy trên bằng RLS
-- chỉ cho phép session của học sinh và tách các bản ghi cấu hình hệ thống.

DROP POLICY IF EXISTS "Public access to quiz_questions" ON public.quiz_questions;
DROP POLICY IF EXISTS "Public access active quiz_questions" ON public.quiz_questions;
-- Chỉ cho phép câu hỏi đang hoạt động xuất hiện trong ứng dụng học sinh.
CREATE POLICY "Public access active quiz_questions"
ON public.quiz_questions
FOR SELECT
TO anon, authenticated
USING (is_deleted = false);

-- Tương thích với SPA quản trị hiện tại. Trước production nên thay các policy
-- này bằng Supabase Auth/RPC/Edge Function có role admin; không dùng anon FOR ALL.
DROP POLICY IF EXISTS "Admin manage quiz_questions" ON public.quiz_questions;
CREATE POLICY "Admin manage quiz_questions"
ON public.quiz_questions
FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- Lưu ý bảo mật: thao tác quản trị (INSERT/UPDATE/DELETE trên câu hỏi,
-- cấu hình và lịch sử) cần được chuyển sang Auth/RPC/Edge Function có quyền
-- server-side trước khi gỡ các policy FOR ALL hiện hữu trên môi trường cũ.

-- 6. KHỞI TẠO CÁC BẢN GHI HỆ THỐNG CỐ ĐỊNH (SYSTEM CONFIG RECORDS)
-- Bản ghi 1: Cấu hình Whitelist IP Admin (ID: 00000000-0000-0000-0000-000000000001)
INSERT INTO public.quiz_logins (id, player_name, ip_address, device_info, status, score_summary, last_active, created_at)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    '__ADMIN_IPS_CONFIG__',
    'SYSTEM',
    'PASSWORDLESS_AUTH',
    'ACTIVE',
    '{"masterIp":"","allowedIps":[]}',
    NOW(),
    NOW()
)
ON CONFLICT (id) DO NOTHING;

-- Bản ghi 2: Phân quyền & Chế độ môn Địa Lí 11 (ID: 00000000-0000-0000-0000-000000000002)
INSERT INTO public.quiz_logins (id, player_name, ip_address, device_info, status, score_summary, last_active, created_at)
VALUES (
    '00000000-0000-0000-0000-000000000002',
    '__ALLOWED_GEO_IPS__',
    'SYSTEM',
    'PUBLIC',
    'ACTIVE',
    '{"mode":"PUBLIC","ips":[],"grade5Ips":[]}',
    NOW(),
    NOW()
)
ON CONFLICT (id) DO NOTHING;

-- Bản ghi 3: Chế độ Bảo trì Hệ thống (ID: 00000000-0000-0000-0000-000000000003)
INSERT INTO public.quiz_logins (id, player_name, ip_address, device_info, status, score_summary, last_active, created_at)
VALUES (
    '00000000-0000-0000-0000-000000000003',
    '__SYSTEM_MAINTENANCE__',
    'SYSTEM',
    'OFF',
    'INACTIVE',
    'Trang web đang tạm dừng để cập nhật đề cương và dữ liệu mới. Vui lòng quay lại sau!',
    NOW(),
    NOW()
)
ON CONFLICT (id) DO NOTHING;

-- Bản ghi 4: Danh sách Môn học Động tùy biến (ID: 00000000-0000-0000-0000-000000000004)
INSERT INTO public.quiz_logins (id, player_name, ip_address, device_info, status, score_summary, last_active, created_at)
VALUES (
    '00000000-0000-0000-0000-000000000004',
    '__DYNAMIC_SUBJECTS__',
    'SYSTEM',
    'DYNAMIC_HUB',
    'ACTIVE',
    '[]',
    NOW(),
    NOW()
)
ON CONFLICT (id) DO NOTHING;

-- Bản ghi 5: Cấu hình Khóa AI Toàn Hệ Thống (ID: 00000000-0000-0000-0000-000000000005)
INSERT INTO public.quiz_logins (id, player_name, ip_address, device_info, status, score_summary, last_active, created_at)
VALUES (
    '00000000-0000-0000-0000-000000000005',
    '__GEMINI_CONFIG__',
    'SYSTEM',
    'GEMINI_AI_1_5_FLASH',
    'ACTIVE',
    '',
    NOW(),
    NOW()
)
ON CONFLICT (id) DO NOTHING;

-- Bản ghi 6: Phân Quyền Danh Sách IP Sử Dụng AI (ID: 00000000-0000-0000-0000-000000000006)
INSERT INTO public.quiz_logins (id, player_name, ip_address, device_info, status, score_summary, last_active, created_at)
VALUES (
    '00000000-0000-0000-0000-000000000006',
    '__AI_IPS_CONFIG__',
    'SYSTEM',
    'AI_IP_WHITELIST',
    'ACTIVE',
    '[]',
    NOW(),
    NOW()
)
ON CONFLICT (id) DO NOTHING;
