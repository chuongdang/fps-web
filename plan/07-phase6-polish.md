# Phase 6 – Làm đẹp (chọn lẻ từng task)

Mỗi task độc lập, làm task nào cũng được, không cần theo thứ tự. **Không task nào được đổi logic `shared/movement.ts` hay netcode.**

## 6.1 Model khối hộp Cớm & Cướp
- Dựng bằng code từ các BoxGeometry (đầu, thân, 2 tay, 2 chân) hoặc file `.glb` khối hộp.
- Cớm: thân xanh, mũ kê-pi (hộp dẹt + vành). Cướp: thân đen sọc, khăn che mặt, túi tiền sau lưng.
- Kích thước khớp hitbox (đầu đúng vùng head) để người chơi ngắm đầu là trúng đầu.
- Nghiệm thu: bắn vào đầu model luôn ra headshot (bật F7 so sánh).

## 6.2 Animation thủ tục
- Không cần file animation: tay chân đung đưa theo sin của quãng đường đi, ngồi thì hạ thân, trượt thì ngả người, nhảy thì co chân.
- Thân trên xoay theo pitch (nhìn lên/xuống), cả người xoay theo yaw.
- Chạy theo **vận tốc nội suy**, không theo input.
- Chết: các khối tách ra bay nhẹ rồi mờ dần (rẻ hơn ragdoll, hợp phong cách khối hộp).

## 6.3 Súng trên tay người khác
- Gắn mesh súng vào khối tay phải, đổi theo `weapon` trong NetPlayer.
- Lửa đầu nòng hiện khi nhận ShotFx.

## 6.4 Súng mới
- Sniper: 1 phát/1,2s, damage 90, headMult 2, có scope (giữ chuột phải zoom FOV 30, che màn hình đen ngoài vòng tròn), spread rất lớn khi không scope.
- Shotgun: 8 tia mỗi phát (spread seed theo `shotSeq` và chỉ số tia), damage giảm theo khoảng cách.
- Chỉ thêm vào `WEAPONS` + hiệu ứng; logic bắn dùng lại.

## 6.5 Hình ảnh map
- Texture thật thay ô kẻ (gạch cho tường thành, gỗ cho thùng), skybox, sương mù nhẹ.
- Bóng đổ: chỉ 1 directional light, shadow map 2048, chỉ map đổ bóng, nhân vật không đổ bóng (hoặc dùng bóng tròn giả dưới chân).
- Nghiệm thu: vẫn ≥ 60 FPS trên laptop văn phòng.

## 6.6 Settings
- Sensitivity, FOV, âm lượng tổng / âm súng, màu và kiểu tâm ngắm. Lưu localStorage.

## 6.7 (Tuỳ chọn) Transport geckos.io
- Chỉ đổi cài đặt `Transport` (task 3.1). Nếu phải sửa chỗ khác ngoài transport → dừng, báo lại.
