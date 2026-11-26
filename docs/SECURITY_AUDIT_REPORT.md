# Báo Cáo Audit Bảo Mật Quiz Web App

**Phạm vi:** `assets/js/app.js`, `assets/js/admin.js`, `assets/js/arena.js`, `assets/js/supabase.js`, các script SQL trong `supabase/sql/` và các test hiện có.

**Ngày audit:** 2026-11-26  
**Phương pháp:** đọc mã nguồn tĩnh, truy vết luồng xác thực/chấm điểm/lưu tiến độ và đối chiếu với các RPC, RLS, constraint trong PostgreSQL. Không thực hiện pentest trên môi trường production và không xác nhận cấu hình Supabase đang triển khai thực tế.

## 1. Tóm Tắt Điều Hành

Kiến trúc hiện tại đã có hướng đi đúng: các thao tác nhạy cảm của Arena được chuyển vào RPC `SECURITY DEFINER`, token phiên Admin được lưu server-side với thời hạn, bảng câu hỏi và lịch sử được thu hẹp quyền truy cập, điểm Arena được chấm trên máy chủ, có idempotency theo `(attempt_id, question_id)`, giới hạn tốc độ RPC và audit log.

Tuy nhiên, phần ứng dụng chính vẫn là client-trusted ở nhiều điểm. Điểm luyện tập/thi thử thông thường được tính trong JavaScript và ghi dưới dạng chuỗi vào `quiz_logins`; timer, `userAnswers`, autosave và cờ giao diện tồn tại trong trình duyệt. Người học có thể sửa mã JavaScript, LocalStorage, request hoặc gọi trực tiếp Supabase bằng anon key. Những cơ chế này phù hợp cho UX và giám sát, nhưng không thể được xem là bằng chứng chống gian lận.

**Đánh giá tổng thể:** rủi ro **Cao** đối với tính toàn vẹn điểm thi thường và dữ liệu giám sát nếu RLS/RPC không được triển khai đúng bản migration; rủi ro **Trung bình** đối với Arena khi toàn bộ SQL bảo mật đã được chạy và quyền EXECUTE/RLS giữ nguyên như thiết kế.

**Ba ưu tiên xử lý cao nhất:**

1. Chuyển chấm điểm, thời gian và trạng thái hoàn tất của mọi bài thi có giá trị sang RPC server-authoritative; không nhận `score`, `correct_count` hoặc `duration` do client tự khai báo.
2. Xác minh quyền EXECUTE thực tế sau migration, đặc biệt với các overload cũ của `arena_create_room`, `arena_get_audit_logs` và các RPC `SECURITY DEFINER`; thu hồi mọi quyền không cần thiết.
3. Không coi IP, mã máy, token trong LocalStorage hoặc cờ `isAdminAuthenticated` là yếu tố xác thực độc lập. Mọi thao tác Admin phải yêu cầu session token server-side hợp lệ và kiểm tra quyền trong RPC.

## 2. Kiến Trúc An Ninh

### 2.1. Client

`app.js` quản lý danh tính hiển thị, mã thiết bị `QM-*`, IP nhận diện, token truy cập, trạng thái Admin, câu trả lời, timer, autosave và đồng bộ tiến độ. `admin.js` là giao diện quản trị và gọi Supabase trực tiếp/RPC. `arena.js` hiển thị đề, theo dõi focus/fullscreen/vi phạm, giữ `attempt_id` và session token rồi gọi RPC.

Mọi giá trị trong các file này đều có thể bị thay đổi bởi người dùng cuối qua DevTools, extension, proxy trình duyệt hoặc request tự tạo. Các biện pháp như ẩn đáp án trên UI, khóa input, tự động nộp khi rời tab và xóa token khỏi URL chỉ giảm rủi ro hoặc cải thiện UX; chúng không tạo ra ranh giới tin cậy.

### 2.2. Supabase và RPC

Các SQL đã thiết kế lớp bảo vệ server-side đáng kể:

- `supabase_security_migration.sql` tạo `admin_auth_secrets`, `admin_sessions`, bcrypt/`pgcrypto`, `is_valid_admin_session`, `admin_verify_login`, `admin_logout` và giới hạn tốc độ.
- Quyền trực tiếp trên `quiz_questions` và `quiz_logins` được thu hồi cho `anon`/`authenticated`; client phải đi qua RPC công khai hoặc RPC Admin.
- `public_get_quiz_questions` loại đáp án đúng khi `mode = 'exam'`.
- RPC Admin kiểm tra session token trước khi sửa câu hỏi, cấu hình, lịch sử, IP ban hoặc phòng Arena.
- `supabase_arena_setup.sql` lưu `question_order`, `option_map`, `active_session_token`, câu trả lời và điểm trong database; client chỉ nhận payload câu hỏi đã loại đáp án đúng.
- `arena_submit_answer` lấy thời gian máy chủ, ánh xạ đáp án gốc, chấm MCQ/TF/short answer, giới hạn thời gian, chống gửi trùng và cộng điểm tại database.
- `arena_join_room`, `arena_submit_answer`, `arena_log_violation` dùng rate limit; session cũ bị thay thế hoặc bị chặn tùy `concurrent_policy`.

### 2.3. Ranh Giới Tin Cậy

| Thành phần | Có thể tin cậy | Không được tin cậy |
|---|---|---|
| Client JS/DOM | Luồng hiển thị, thao tác UX | Điểm, đáp án, timer, cờ Admin, token cache, IP/mã máy |
| LocalStorage/SessionStorage | Cache không nhạy cảm, khôi phục UX | Quyền, tiến độ, session, kết quả |
| Anon key | Định tuyến tới Supabase | Không phải bí mật và không cấp quyền Admin |
| RPC `SECURITY DEFINER` | Chấm điểm/trạng thái nếu kiểm tra đầy đủ | Payload đầu vào vẫn phải validate và rate-limit |
| PostgreSQL/RLS | Nguồn sự thật về quyền, điểm, thời gian | Cấu hình sai quyền EXECUTE hoặc migration chưa chạy |

## 3. Phân Tích Theo Cơ Chế

### 3.1. Xác thực Admin và bảo vệ Master IP

Điểm tốt:

- Mật khẩu Admin được kiểm tra server-side bằng `crypt`/bcrypt; mật khẩu bootstrap không được cấp cho `anon`/`authenticated`.
- Session token được sinh bằng `gen_random_bytes`, có `expires_at`, lưu trong `admin_sessions` và hỗ trợ logout thu hồi.
- `app.js`/`admin.js` đã ưu tiên nhận diện `masterDeviceCode`, xử lý `itemIndex`/mã thiết bị để tránh nhầm các thiết bị dùng chung IP.
- SQL chặn ghi đè bản ghi hệ thống và không cho student RPC ghi các UUID cấu hình hệ thống.


- `isAdminAuthenticated`, `quiz_is_admin`, `quiz_admin_authenticated`, `quiz_admin_token` và cấu hình cache trong trình duyệt có thể bị sửa. Chúng chỉ được dùng để hiển thị/điều hướng, không được dùng làm kiểm soát cuối cùng.
- IP whitelist không phải định danh mạnh: NAT, proxy, VPN và mạng trường học có thể dùng chung IP. Master IP chỉ nên là tín hiệu phụ, không thay cho session token.
- `supabase_setup.sql` mô tả trạng thái chuyển tiếp và cần chạy tiếp migration bảo mật. Nếu production chưa chạy migration hoặc còn policy cũ, anon client có thể có quyền rộng hơn thiết kế.
- `supabase_security_migration.sql` có các RPC overload và câu lệnh `REVOKE` cần đối chiếu chính xác signature sau khi deploy. Quyền còn sót trên overload cũ là rủi ro leo thang đặc quyền.


Điểm tốt:

- `arena_join_room` yêu cầu `player_key` và session token không rỗng, lưu `active_session_token` trong database.
- `arena_get_room_state`, `arena_submit_answer`, `arena_log_violation`, `arena_finish_attempt` kiểm tra token khớp; session bị thay thế được báo `SESSION_REPLACED`.
- `UNIQUE (room_id, player_key)` hạn chế tạo nhiều attempt cho cùng khóa người chơi; policy `BLOCK_NEW`/`KICK_OLD` xử lý đăng nhập đồng thời.
- Token/đề xáo trộn và đáp án đúng không được trả trong payload Arena.


- Token phiên được gửi từ client và có thể bị đánh cắp bởi XSS, extension độc hại hoặc máy dùng chung. Cần TTL, ràng buộc thêm với attempt/device fingerprint ở server và cơ chế thu hồi rõ ràng.
- `player_key` do client cung cấp. Nếu khóa này không gắn với danh tính đã xác thực, người dùng có thể đổi tên/khóa để tạo identity mới, subject to rate limit.
- RPC `arena_get_leaderboard` là `SECURITY DEFINER` và trả dữ liệu bảng xếp hạng; cần xác nhận quyền EXECUTE và mức độ công khai phù hợp với yêu cầu riêng tư.


Arena có mô hình tốt: thời gian phản hồi chính lấy từ `NOW()` của server; offline sync không được speed bonus; điểm MCQ/TF/short answer được tính từ đáp án trong database; timeout và replay được xử lý trong transaction/row lock.

Ngược lại, luồng bài thường trong `app.js` tính `correctCount`, `totalItems`, `finalScore` từ `userAnswers` trên client, hiển thị kết quả ngay và ghi `score_summary` dạng text. Timer `secondsElapsed`/`examSecondsRemaining` và `finishQuiz` cũng nằm trên client. Vì vậy:

- sửa `window.app.userAnswers`, gọi trực tiếp `finishQuiz`, sửa timer hoặc chặn request có thể thay đổi kết quả cục bộ;
- sửa LocalStorage có thể khôi phục đáp án, làm sai autosave hoặc lịch sử cá nhân;
- dữ liệu giám sát trong `quiz_logins` không phải bằng chứng bất biến nếu RPC/ownership không ràng buộc attempt với session.


`app.js` lưu `quiz_autosave_<subject>_<player>` vào LocalStorage, giữ snapshot chờ khi chưa có `loginRecordId`, rồi flush snapshot mới nhất qua `updateStudentProgress`. `supabase.js` có fallback LocalStorage và cache schema; Arena có retry pending answers và offline sync.

Điểm tốt là có debounce, giữ snapshot mới nhất, retry có giới hạn, idempotency ở Arena và không cộng speed bonus cho offline.

Rủi ro:

- LocalStorage không mã hóa và có thể bị sửa/xóa; dữ liệu câu trả lời có thể chứa thông tin cá nhân.
- Đồng bộ offline cần chống rollback: server nên lưu `attempt_id`, sequence đơn điệu, `answered_at` server-side và từ chối snapshot cũ.
- Cần giới hạn kích thước payload, số lần retry và dọn dữ liệu cũ để tránh DoS phía trình duyệt/RPC.


| ID | Kịch bản | Tác động | Khả năng | Mức rủi ro | Kiểm soát hiện có | Khuyến nghị |
|---|---|---|---|---|---|---|
| V-01 | Học sinh sửa `userAnswers`, `finalScore`, timer hoặc gọi `finishQuiz` từ DevTools | Gian lận điểm bài thường | Cao | Cao | Một phần logic UI; Arena server-side | Chấm mọi bài thi có giá trị tại RPC; chỉ nhận answer payload |
| V-02 | Sửa/xóa `quiz_autosave_*`, `quiz_token_info`, `quiz_is_admin` trong LocalStorage | Khôi phục đáp án, giả quyền UI, sai tiến độ | Cao | Trung bình-Cao | Xác thực lại token khi online | Không dùng storage làm authority; ký/envelope server-side hoặc chỉ dùng cache |
| V-03 | Replay `arena_submit_answer` | Cộng điểm lặp hoặc thay đổi trạng thái | Trung bình | Trung bình | Unique `(attempt_id, question_id)`, token, lock | Test integration duplicate/concurrency; enforce sequence và audit |
| V-04 | Gửi `p_client_elapsed_ms` giả khi offline | Ăn gian tốc độ/thời gian | Trung bình | Trung bình | Offline không cộng speed bonus, clamp thời gian | Chỉ nhận offline answer không bonus; xác thực monotonic event chain |
| V-05 | Đoán/đánh cắp token Admin hoặc replay session | Quản trị toàn hệ thống | Thấp-Trung bình | Cao | Token random, expiry, logout, rate limit | Hash token khi lưu, rotate, revoke-all, bind session/context, giám sát bất thường |
| V-06 | Giả mạo IP/Master IP qua proxy hoặc sửa client IP | Vượt whitelist/nhầm thiết bị | Trung bình | Cao | Master device code, RPC session | Lấy IP ở trusted edge; dùng Auth/session, không tin `p_ip` do client khai báo |
| V-07 | Gọi spam RPC `public_verify_access_token`, join/submit/violation | Chi phí, lock contention, cạn connection | Trung bình | Trung bình-Cao | `rpc_rate_limits` theo key/IP/session | Rate limit theo IP + token + account, backoff, CAPTCHA/WAF, quota và alert |
| V-08 | XSS qua nội dung câu hỏi/tên/thông báo | Đánh cắp token, thao túng phiên | Trung bình | Cao | `escapeHtml` ở nhiều vị trí, `textContent` modal | CSP nghiêm ngặt, Trusted Types nếu khả thi, sanitize HTML/KaTeX, security headers |
| V-09 | Đọc trực tiếp bảng Supabase do policy cũ/overload còn quyền | Lộ đáp án, token, lịch sử | Thấp nếu migration đúng; cao nếu sai | Cao | RLS/revoke trong SQL | Kiểm tra `pg_policies`, `routine_privileges`, negative tests bằng anon key |
| V-10 | Dùng `player_key`/tên mới để tạo attempt khác | Né giới hạn một phiên | Trung bình | Trung bình | Unique theo room/player_key, rate limit | Gắn attempt với Auth/device enrollment; giới hạn attempts theo trusted identity |

## 5. Các Điểm Đã Làm Tốt

- Tách RPC công khai khỏi thao tác Admin và thu hồi quyền trực tiếp trên bảng nhạy cảm.
- Dùng `SECURITY DEFINER` với `search_path = public, pg_temp`, giảm nguy cơ search-path hijacking.
- Có session Admin server-side, hết hạn, logout và bcrypt.
- Không trả đáp án đúng/cấu trúc nhạy cảm của Arena cho client.
- Chấm Arena dựa trên đáp án chuẩn trong database, thời gian server và transaction lock.
- Có idempotency, kiểm tra thứ tự câu hỏi, timeout, concurrent session policy và audit log.
- Có rate limit cho các RPC nhạy cảm và giới hạn tham số tạo phòng.
- Có escaping HTML ở Arena và cơ chế xóa token khỏi URL sau khi đọc.
- Có xử lý schema cũ, retry mạng, autosave và đồng bộ snapshot mới nhất giúp tăng độ tin cậy vận hành.
- Logic nhận diện Admin đã chú ý tới `deviceCode`/`itemIndex`, giảm lỗi thu hồi nhầm các máy dùng chung IP.

## 6. Khuyến Nghị Nâng Cấp

### Ưu tiên P0

1. Tạo một RPC/Edge Function `submit_regular_attempt` nhận `attempt_id`, câu trả lời và session token; server tự lấy câu hỏi/đáp án, tính điểm, kiểm tra deadline, ghi kết quả bất biến. Không nhận `finalScore`, `correctCount`, `duration` từ client.
2. Đảm bảo production đã chạy đầy đủ `supabase_security_migration.sql` sau `supabase_setup.sql` và `supabase_arena_setup.sql`; kiểm tra không còn policy `FOR ALL` cho anon.
3. Thu hồi quyền EXECUTE của mọi overload cũ; cấp đúng signature có tham số token. Tự động kiểm tra bằng SQL catalog trong CI/deploy.
4. Tách bí mật Gemini/API key khỏi `quiz_logins.score_summary`; proxy server phải giữ secret, kiểm tra auth/rate limit và không trả key về browser.

### Ưu tiên P1

1. Lưu token Admin dạng hash/HMAC trong database, chỉ hiển thị một lần, hỗ trợ revoke-all, rotation và giới hạn số session hoạt động.
2. Gắn Arena attempt với danh tính bền vững hơn `player_key`: Supabase Auth hoặc enrollment token có TTL, server-side device binding và giới hạn số attempt.
3. Thêm nonce/sequence chống rollback cho autosave/offline. Server từ chối sequence thấp hơn, payload quá lớn, answer ngoài `question_order` hoặc timestamp bất hợp lệ.
4. Áp dụng CSP (`script-src` hạn chế), HSTS, `frame-ancestors`, `Referrer-Policy`, `Permissions-Policy`, `X-Content-Type-Options` và cookie `HttpOnly/Secure/SameSite` cho session nếu chuyển sang cookie.
5. Không dựa vào IP để cấp quyền Admin/Student. Nếu vẫn cần IP, dùng IP chỉ làm tín hiệu audit/rate-limit và lấy từ trusted reverse proxy.
6. Chuẩn hóa schema câu hỏi: validate q_type, số lựa chọn, kiểu `correct`, kiểu boolean của TF và độ dài short answer trong RPC, không chỉ ở UI.

### Ưu tiên P2

1. Thêm test integration chạy với Supabase test project hoặc PostgreSQL container: RLS deny, RPC unauthorized, expiry, replay, duplicate, concurrent request, timeout và rate limit.
2. Ghi audit cho mọi lần Admin login thất bại/thành công, thay đổi cấu hình, cấp/thu hồi token, thay đổi Master device và force submit.
3. Cài cảnh báo khi một token/IP tạo nhiều attempt, có nhiều `SESSION_REPLACED`, vượt rate limit hoặc gửi payload lỗi lặp lại.
4. Giảm dữ liệu cá nhân trong log, đặt retention, mã hóa backup và hạn chế quyền đọc bảng lịch sử.
5. Thực hiện dependency/SAST/secret scan định kỳ; secret hiện diện trong frontend phải được coi là public và rotate nếu đó là credential nhạy cảm.

## 7. Kế Hoạch Kiểm Thử Đề Xuất

- **Unit:** các hàm chấm MCQ, TF, short answer, speed bonus, normalize token và validate payload.
- **Property-based:** mọi điểm nằm trong miền hợp lệ; elapsed âm/NaN/giá trị rất lớn không tạo bonus ngoài giới hạn; input Unicode/whitespace không bypass.
- **Integration:** gọi RPC bằng anon và token giả, xác nhận lỗi; gọi hai request cùng câu hỏi đồng thời, chỉ một bản ghi được tính.
- **Security regression:** sửa LocalStorage/cờ Admin không tạo quyền server; replay token hết hạn bị từ chối; session cũ nhận `SESSION_REPLACED`; offline sync không có speed bonus.
- **Operational:** rate limit reset đúng cửa sổ, cleanup session hết hạn, lock contention và retry không nhân đôi dữ liệu.

## 8. Kết Luận

Arena là phần có nền tảng chống gian lận tốt nhất vì đã đặt chấm điểm, thời gian, session và idempotency trong PostgreSQL. Luồng quiz thường vẫn phải được xem là mô hình tin cậy client và chỉ phù hợp cho luyện tập hoặc giám sát mềm. Để đạt mức bảo mật phù hợp cho kỳ thi chính thức, cần chuyển toàn bộ quyết định điểm/thời gian/trạng thái hoàn tất sang server-authoritative, kiểm chứng quyền Supabase sau deploy và bổ sung integration/security regression tests.
