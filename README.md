# 🎓 QuizMaster Pro - Hệ Thống Trắc Nghiệm Trực Tuyến

Ứng dụng web thi trắc nghiệm trực tuyến hiện đại, thiết kế theo phong cách Glassmorphism, tự động đếm ngược thời gian, chấm điểm, giải thích chi tiết và vinh danh trên Bảng xếp hạng trực tiếp với cơ sở dữ liệu Supabase.

---

## 🚀 Các Tính Năng Nổi Bật

1. **Giao diện Modern UI/UX:**
   - Xây dựng với Tailwind CSS, màu sắc neon glow cao cấp, hỗ trợ hoàn hảo trên mọi thiết bị (máy tính, tablet, điện thoại di động).
   - Hiệu ứng pháo hoa ăn mừng (Canvas Confetti) khi đạt kết quả cao.
2. **Hệ thống làm bài thông minh:**
   - Đồng hồ đếm ngược trực quan với cảnh báo đỏ khi sắp hết giờ.
   - Tự động thu và nộp bài khi hết thời gian thi.
   - Bảng ma trận câu hỏi (Question Palette) cho phép nhảy nhanh đến câu bất kỳ.
   - Tính năng cắm cờ (Bookmark/Flag) để ghi chú các câu phân vân cần kiểm tra lại trước khi nộp.
   - Xáo trộn ngẫu nhiên thứ tự câu hỏi và thứ tự các phương án lựa chọn A, B, C, D để tránh học vẹt.
3. **Màn hình kết quả & Review đáp án:**
   - Thống kê chi tiết: Điểm số thang 100, số câu đúng/tổng số câu, thời gian làm bài.
   - Lời giải chi tiết: Hiển thị lại từng câu hỏi, đáp án bạn chọn, đáp án chính xác và phần giải thích cặn kẽ.
4. **Bảng xếp hạng (Leaderboard) thời gian thực:**
   - Vinh danh bục Top 1, Top 2, Top 3 (Vàng, Bạc, Đồng).
   - Tự động ưu tiên người có điểm cao hơn; nếu bằng điểm thì ưu tiên người có thời gian hoàn thành nhanh hơn.
   - **Chế độ kép:** Hỗ trợ kết nối Supabase Cloud Database để đồng bộ cho toàn bộ bạn bè; hoặc tự động dùng LocalStorage nếu chưa cấu hình database.

---

## 🛠️ Hướng Dẫn Cấu Hình Supabase (3 Bước Nhanh)

1. **Tạo bảng trên Supabase:**
   - Mở dự án Supabase của bạn tại tab trình duyệt.
   - Vào menu bên trái chọn **SQL Editor** -> Click **New Query**.
   - Mở file `supabase_setup.sql` trong thư mục này, sao chép toàn bộ nội dung và dán vào, sau đó nhấn nút **Run** (màu xanh lá).
2. **Lấy API Keys:**
   - Vào mục **Project Settings** (biểu tượng bánh răng) -> Chọn **API**.
   - Sao chép 2 thông số:
     - `Project URL` (dạng: `https://xxxx.supabase.co`)
     - `anon public key` / `Publishable key` (chuỗi JWT `ey...` hoặc `sb_publishable_...`)
3. **Gắn vào Web:**
   - Cách 1: Mở web trên trình duyệt, bấm nút **Bánh răng cài đặt (⚙️)** góc trên bên phải, dán URL và Key vào rồi bấm **Lưu Kết Nối**.
   - Cách 2: Hoặc dán trực tiếp vào file `supabase.js` ở mục `DEFAULT_SUPABASE_CONFIG`.
4. **Lưu ý bảo mật Production:**
   - File `supabase_setup.sql` và `supabase_arena_setup.sql` hiện mở RLS cho role `anon` để tương thích với kiến trúc SPA tĩnh không cần đăng nhập Supabase Auth.
   - Trước khi triển khai môi trường thi chính thức / production, cần chuyển các thao tác quản trị (`quiz_questions` ghi/xóa, `quiz_logins` cấu hình hệ thống, `arena_create_room` / `arena_end_room`, và khóa Gemini API) sang Supabase Auth + RLS theo role hoặc Edge Functions / RPC kiểm tra quyền server-side.
   - Chế độ Đấu trường (Arena) sử dụng thêm script `supabase_arena_setup.sql` và trang quản trị nằm tại `admin.html`.

---

## 📦 Hướng Dẫn Đẩy Code Lên GitHub

Mở cửa sổ dòng lệnh (Terminal / PowerShell / Git Bash) tại thư mục `quiz-web-app`:

```bash
# 1. Khởi tạo kho lưu trữ Git
git init

# 2. Thêm toàn bộ file vào staging
git add .

# 3. Tạo commit đầu tiên
git commit -m "feat: Khoi tao du an web trac nghiem QuizMaster Pro"

# 4. Đổi tên nhánh chính thành main
git branch -M main

# 5. Tạo một repository mới trên GitHub (ví dụ tên: quizmaster-web), sau đó gắn remote
git remote add origin https://github.com/<tai-khoan-cua-ban>/quizmaster-web.git

# 6. Đẩy mã nguồn lên GitHub
git push -u origin main
```

---

## ☁️ Hướng Dẫn Triển Khai (Deploy) Lên Vercel

1. Truy cập tab **Vercel** (`New Project`) bạn đang mở trên trình duyệt: [vercel.com/new](https://vercel.com/new)
2. Chọn **Continue with GitHub** (hoặc đăng nhập bằng tài khoản GitHub).
3. Tại danh sách repositories, bấm nút **Import** bên cạnh repository `quizmaster-web` bạn vừa tạo.
4. Ở mục **Configure Project**:
   - *Framework Preset*: Để nguyên là **Other** (vì đây là Static HTML/JS thuần).
   - *Root Directory*: `./`
5. Nhấn nút **Deploy**.
6. Chỉ sau khoảng **10 đến 20 giây**, Vercel sẽ cấp cho bạn một đường link công khai (ví dụ: `https://quizmaster-web.vercel.app`) để gửi ngay cho bạn bè truy cập và thi đấu trắc nghiệm!
