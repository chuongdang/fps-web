# CLAUDE.md – Luật làm việc cho dự án FPS Web

File này đặt ở gốc repo. Claude Code đọc nó mỗi phiên. **Tuân thủ tuyệt đối.**

## Trước khi code
1. Đọc `plan/00-overview.md` và file phase đang được giao (ví dụ `plan/04-phase3-netcode-move.md`).
2. Đọc `plan/PROGRESS.md` để biết task nào đã xong.
3. Nếu yêu cầu mơ hồ hoặc mâu thuẫn với plan: **dừng lại và hỏi**, không tự đoán.

## Phạm vi
- Chỉ làm **đúng task được giao**. Không làm trước task sau, không "tiện tay" refactor chỗ khác.
- Không viết lại cả file khi chỉ cần sửa vài dòng.
- Không đổi interface/kiểu dữ liệu trong `shared/` nếu task không yêu cầu. Nếu thấy cần đổi: dừng, giải thích lý do, chờ đồng ý.
- Không thêm thư viện ngoài danh sách trong `00-overview.md`. Cần thêm thì hỏi trước.
- Không xoá code debug/overlay đã có.

## Quy ước bắt buộc
- Đơn vị: mét, giây, radian. Trục Y hướng lên.
- yaw = 0 nhìn về **-Z**. yaw tăng = quay trái. pitch dương = ngước lên.
- `forward = (-sin(yaw), 0, -cos(yaw))`, `right = (cos(yaw), 0, -sin(yaw))`.
- Mọi thông số gameplay (tốc độ, damage, thời gian...) nằm trong file config của `shared/`, **không hardcode** trong logic.
- Code chạy ở cả client và server đặt trong `shared/`, không import Three.js hay DOM trong `shared/`.
- Không cấp phát object mới (`new Vector3`, mảng tạm) trong vòng lặp mỗi frame/tick; dùng biến tạm tái sử dụng.

## Khi sửa bug
1. Mô tả **nguyên nhân giả định** và **cách xác minh** (log, debug overlay, test) trước khi sửa.
2. Xác minh rồi mới sửa. Sửa **một nguyên nhân mỗi lần**.
3. Nếu sửa 2 lần chưa xong: dừng, tóm tắt những gì đã thử, đề xuất hướng khác. Không sửa vòng vòng.
4. Không "sửa" bằng cách tăng/giảm hằng số ngẫu nhiên cho tới khi có vẻ chạy.

## Sau mỗi task
1. Chạy `npm run typecheck` và `npm test`, phải pass.
2. Cập nhật `plan/PROGRESS.md` (đánh dấu task, ghi chú ngắn).
3. Báo cáo theo mẫu:
   - **Đã làm:** ...
   - **File thay đổi:** ...
   - **Cách test tay:** các bước cụ thể để người dùng tự kiểm tra
   - **Chưa chắc / cần người dùng quyết:** ...
