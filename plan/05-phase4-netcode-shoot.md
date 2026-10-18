# Phase 4 – Bắn online ⚠️

Mục tiêu: bắn nhau trúng đúng cảm giác. Nguyên tắc vàng: **client chỉ báo "tôi bóp cò lúc nào, nhìn hướng nào"; server mới quyết định trúng hay trượt.**

## Message thêm

```ts
// InputCmd đã có: buttons có bit Fire, weapon, và fireRenderTime
// fireRenderTime = currentRenderTime (task 3.5) tại tick bắn; chỉ gửi khi bit Fire bật.

// Server → Client
  | { t: 106; damage: number; headshot: boolean; targetId: number }           // HitConfirm (gửi riêng người bắn)
  | { t: 107; killerId: number; victimId: number; weapon: number; headshot: boolean } // Kill (gửi cả phòng)
  | { t: 108; id: number; pos: Vec3; yaw: number }                             // Respawn (gửi cả phòng)
  | { t: 109; shooterId: number; origin: Vec3; dir: Vec3; dist: number }       // ShotFx (cả phòng, để vẽ vệt đạn/tiếng súng của người khác)
  | { t: 110; origin: Vec3; dir: Vec3; boxes: HitBox[] }                       // DebugShot (chỉ khi bật debug)

// NetPlayer thêm: hp, alive, weapon, ammo (chỉ cần chính xác cho bản thân), invulnUntil
```

---

## Task 4.1 – Bắn qua InputCmd, server kiểm soát đạn/fire rate

Làm:
- Client: khi giữ chuột, bật bit Fire trong cmd và điền `fireRenderTime`. Client vẫn chạy `tryFire` cục bộ để **hiện hiệu ứng ngay** (lửa, tiếng, recoil, trừ đạn trên HUD) — đây là dự đoán, giống prediction di chuyển.
- Server: khi xử lý cmd có bit Fire → chạy `tryFire` (cùng hàm `shared`) với `nowMs` = thời điểm mô phỏng của server. Bắn hợp lệ thì tạo "phát bắn" (task 4.2). Không hợp lệ thì bỏ qua.
- `WeaponState` của mình được gửi trong snapshot; client reconcile ammo/reload giống reconcile vị trí.
- `nowMs` trong `tryFire` ở cả 2 bên = `seq * 1000 / TICK_RATE` của cmd (không dùng tick server), để client và server tính fire rate giống hệt.

Nghiệm thu:
- [ ] Sửa tạm client để gửi Fire mỗi tick với Pistol: server chỉ chấp nhận đúng 4 phát/giây (log).
- [ ] Đạn trên HUD khớp với server sau khi xả hết băng và reload (không lệch 1–2 viên).

Pitfall:
- Nếu dùng tick server làm `nowMs` thì cmd đến dồn 2 cái/tick sẽ bị server từ chối phát thứ 2 dù client cho phép → đạn lệch. Dùng `seq` của cmd.
- Server **phải** giới hạn `seq` không chạy nhanh hơn thời gian thực quá xa (người gian lận gửi seq nhảy cóc để bắn nhanh): nếu số cmd nhận trong 1 giây > 66, bỏ phần dư.

---

## Task 4.2 – Server hitscan (chưa lag compensation)

Mục đích: đúng ở ping 0 trước, rồi mới thêm tua thời gian.

Làm (`server/src/simulation.ts`):
- Gốc tia: mắt người bắn theo state **ngay sau khi chạy cmd đó** (`pos + eyeHeight`).
- Hướng: từ `cmd.yaw`, `cmd.pitch` + recoil + spread (rng seed `playerId, shotSeq`) — **cùng công thức với client**.
- `wallDist` = Rapier `castRay` chỉ với collider map, tối đa `range`.
- Với mỗi người chơi khác còn sống, **khác đội** (phase 5; tạm thời bắn được tất cả trừ bản thân): `hitboxesFor(state hiện tại)`, `rayAabb`, lấy trúng gần nhất < `wallDist`.
- Trúng: tính damage theo phần, gửi HitConfirm cho người bắn. (Trừ máu ở task 4.4.)
- Luôn gửi ShotFx cho cả phòng (trừ người bắn) để vẽ vệt đạn + phát tiếng súng có vị trí (PannerNode).

Nghiệm thu (chạy `?lat=0`):
- [ ] Tab A đứng yên, tab B bắn đầu A: B nhận hitmarker đỏ.
- [ ] B bắn A qua lỗ bắn: trúng. Bắn vào tường cạnh lỗ: không trúng.
- [ ] Tab A thấy vệt đạn và nghe tiếng súng của B đúng hướng.

---

## Task 4.3 – Lịch sử hitbox + lag compensation ⚠️

Ý tưởng: người bắn nhìn thấy đối thủ ở **quá khứ** (trễ ping/2 + 100ms nội suy). Server phải tua đối thủ về đúng thời điểm đó rồi mới chấm.

Làm (`server/src/lagComp.ts`):
- Sau mỗi tick server, lưu vào ring buffer: `{ serverTime, players: Map<id, { pos, crouching, alive }> }`. Giữ `HITBOX_HISTORY_MS` (60 mục).
- Khi xử lý phát bắn:
  1. `t = clamp(cmd.fireRenderTime, serverNow − MAX_REWIND_MS, serverNow)`.
  2. Tìm 2 mục lịch sử kẹp `t`, nội suy `pos` từng người (giống hệt cách client nội suy ở task 3.5). `crouching`, `alive` lấy theo mục trước.
  3. Tạo hitbox từ vị trí đã tua, raycast như task 4.2.
  4. **Tường không tua** (map tĩnh). Người bắn **không tua** (dùng vị trí hiện tại của chính mình).
- Người bị bắn đã chết ở thời điểm `t` thì bỏ qua.
- Phím F7 (debug): server gửi DebugShot gồm tia và các hitbox đã tua; client vẽ wireframe 2 giây. Người bắn nhìn thấy hitbox tua về phải **trùng** với hình nhân vật mình đã thấy lúc bắn.

Nghiệm thu:
- [ ] `?lat=100` ở tab B, A chạy ngang liên tục. B ngắm thẳng vào A (trên màn hình B) rồi bắn: **trúng** (trước khi có lag comp sẽ trượt sau lưng A).
- [ ] Bật F7: hitbox tua về khớp hình A mà B nhìn thấy, sai lệch < 10cm.
- [ ] `fireRenderTime` gửi lên cũ hơn 250ms (sửa tạm client): server kẹp lại, không tua quá giới hạn.

Pitfall:
- Hitbox tua về lệch đều một khoảng theo hướng chạy → client và server tính `renderTime` khác nhau: kiểm tra `INTERP_DELAY_MS` giống nhau, offset đồng hồ (task 3.3) đúng.
- Lệch ngẫu nhiên → cách nội suy ở server khác client (ví dụ server lấy snapshot gần nhất thay vì nội suy). Phải nội suy y hệt.
- Lịch sử phải lưu **theo serverTime của tick**, không theo thời điểm gửi snapshot.

---

## Task 4.4 – Máu, chết, hồi sinh, bất tử

Làm (server):
- `hp = 100` khi spawn. Trúng: `hp −= damage` (không trừ nếu đang bất tử). `hp ≤ 0` → `alive = false`, gửi Kill, lưu `respawnAt = now + RESPAWN_DELAY_MS`.
- Người chết: không xử lý movement/fire, không có hitbox.
- Hồi sinh: chọn spawn (đội của mình ở phase 5; tạm thời bất kỳ) **xa kẻ địch còn sống nhất** (cực đại khoảng cách tới kẻ địch gần nhất), đặt state mới, `hp = 100`, đạn đầy, `invulnUntil = now + SPAWN_INVULN_MS`, gửi Respawn.
- Bất tử kết thúc sớm ngay khi người đó bắn phát hợp lệ đầu tiên.
- Client: chết → màn hình xám + "Bị [tên] hạ" + đếm ngược. Hồi sinh → teleport (xoá `pending`, đặt state mới, không làm mượt). Nhân vật bất tử nhấp nháy mờ.

Nghiệm thu:
- [ ] Rifle bắn thân: 4 phát chết. Bắn đầu: 1 phát chết.
- [ ] Chết 3 giây rồi hồi sinh ở chỗ xa địch.
- [ ] Vừa hồi sinh bị bắn không mất máu; bắn một phát xong thì bị bắn là mất máu.
- [ ] Hai người bắn chết nhau cùng tick: cả hai đều chết (không ai "ăn gian" sống sót), killfeed hiện 2 dòng.

---

## Task 4.5 – Hitmarker, killfeed, hiệu ứng trúng

Làm (client):
- Hitmarker **chỉ hiện khi nhận HitConfirm** (không đoán trước). Âm "tách" khi trúng, "ting" khi headshot.
- Killfeed góc trên phải: `Người bắn [súng] Người chết`, headshot có biểu tượng, mỗi dòng sống 5 giây, tối đa 5 dòng.
- Bị bắn: viền đỏ ở cạnh màn hình phía hướng đạn đến (tính từ ShotFx có trúng mình hoặc thêm trường vào HitConfirm phía nạn nhân).
- Số damage nổi (tuỳ chọn, tắt mặc định).

Nghiệm thu (bài kiểm tra cuối phase):
- [ ] 3 tab với ping 20/80/150, bắn nhau 5 phút: không có ca "ngắm trúng rõ ràng mà không tính" (dùng F7 kiểm tra khi nghi ngờ).
- [ ] Killfeed, hitmarker, hồi sinh hoạt động đúng ở cả 3 tab.
