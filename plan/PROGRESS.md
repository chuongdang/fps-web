# Tiến độ

Đánh dấu `[x]` khi task xong và đã qua tiêu chí nghiệm thu. Ghi chú ngắn nếu có quyết định quan trọng.

## Phase 0 – Khung dự án
- [x] 0.1 Monorepo + scripts — npm workspaces (shared/server/client), tsx watch + vite dev, typecheck + vitest pass
- [x] 0.2 Hằng số, quy ước, protocol rỗng — constants.ts, math.ts (Vec3, forward/right, lerp, lerpAngle, mulberry32, hashSeed), protocol.ts (msgpack encode/decode, MsgType)
- [ ] 0.3 Map format + loader + mirror
- [ ] 0.4 Dựng map "Hai thành" + render tĩnh

## Phase 1 – Di chuyển offline
- [ ] 1.1 Pointer lock + nhìn chuột
- [ ] 1.2 Fixed timestep loop
- [ ] 1.3 stepMovement: đi, ma sát, trọng lực, nhảy
- [ ] 1.4 Không trung, bunny hop
- [ ] 1.5 Ngồi + trượt
- [ ] 1.6 Test determinism + debug overlay

## Phase 2 – Súng offline
- [ ] 2.1 Viewmodel + render pass riêng
- [ ] 2.2 Hitscan + bia
- [ ] 2.3 Logic súng (đạn, reload, fire rate, spread, recoil)
- [ ] 2.4 Hiệu ứng + âm thanh + HUD

## Phase 3 – Multiplayer di chuyển
- [ ] 3.1 Transport + netsim
- [ ] 3.2 Room + join/leave
- [ ] 3.3 Đồng bộ đồng hồ
- [ ] 3.4 Server sim + snapshot + "client câm"
- [ ] 3.5 Interpolation người khác
- [ ] 3.6 Prediction + reconciliation
- [ ] 3.7 Ghost + kiểm thử ping cao

## Phase 4 – Bắn online
- [ ] 4.1 Bắn qua InputCmd, server kiểm soát đạn/fire rate
- [ ] 4.2 Server hitscan (chưa lag comp)
- [ ] 4.3 Lịch sử hitbox + lag compensation
- [ ] 4.4 Máu, chết, hồi sinh, bất tử
- [ ] 4.5 Hitmarker, killfeed, debug tia bắn

## Phase 5 – Team Deathmatch
- [ ] 5.1 Đội + chia đội
- [ ] 5.2 State machine trận đấu
- [ ] 5.3 Bảng điểm + HUD điểm đội
- [ ] 5.4 Đổi bên + người vào giữa trận

## Phase 6 – Làm đẹp
- [ ] (làm sau, task chọn lẻ)
