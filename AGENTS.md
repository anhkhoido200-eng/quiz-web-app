# Hướng dẫn dự án Quiz Web App cho Codex

## 1. Bảng màu & Giao diện (UI)
- Giữ bảng màu chủ đạo hiện tại của dự án: **Cobalt** (`#2563EB`) và **Golden Folder** (`#FEF9C3` / `#EAB308`).
- Giữ giao diện sạch, gọn, không thêm chữ giải thích thừa thãi trên các nút hoặc hộp thoại.
- Các nút bật/tắt trạng thái (như khóa/mở quyền) phải hiển thị rõ ràng, lưu trạng thái bền vững và phản ánh đúng trên mọi thiết bị.

## 2. Phân quyền & Bảo mật
- Luôn xử lý định danh thiết bị/Admin theo đúng `itemIndex` / `token` / `deviceCode`, không khớp nhầm theo IP dùng chung.
- Khi cấp hoặc thu hồi quyền (`admin` / token), phải cập nhật đồng bộ cả trạng thái lưu trữ lẫn hàm hiển thị UI (`updateAdminUIVisibility`, `syncAdminIpsConfig`, v.v.).

## 3. Kiểm chứng trước khi hoàn thành
- Sau khi sửa các tệp JavaScript chính, luôn chạy kiểm tra cú pháp:
  ```powershell
  node --check app.js
  node --check admin.js
  ```
- Chỉ commit/push khi người dùng yêu cầu hoặc khi đã kiểm tra sạch sẽ.
