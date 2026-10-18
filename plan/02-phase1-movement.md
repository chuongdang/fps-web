# Phase 1 – Đi lại một mình (offline)

Mục tiêu: chạy nhảy trượt trong map "Hai thành" thấy sướng tay. **Toàn bộ logic di chuyển nằm trong `shared/`** vì phase 3 server sẽ chạy y hệt.

---

## Kiểu dữ liệu (dùng xuyên suốt dự án)

```ts
// shared/src/movement.ts
export const Btn = {
  Forward: 1 << 0, Back: 1 << 1, Left: 1 << 2, Right: 1 << 3,
  Jump: 1 << 4, Crouch: 1 << 5, Fire: 1 << 6, Reload: 1 << 7,
} as const;

export interface InputCmd {
  seq: number;        // tăng 1 mỗi tick ở client
  buttons: number;    // bitmask Btn
  yaw: number;
  pitch: number;
  weapon: number;     // slot súng (phase 2)
  fireRenderTime?: number; // phase 4, chỉ có khi đang bắn
}

export interface PlayerState {
  pos: [number, number, number];  // chân nhân vật (đáy capsule)
  vel: [number, number, number];
  yaw: number;
  pitch: number;
  grounded: boolean;
  crouching: boolean;
  slideTimer: number;     // > 0 = đang trượt
  slideCooldown: number;
}
```

Chữ ký hàm chính:

```ts
export function stepMovement(
  state: PlayerState,       // KHÔNG sửa trực tiếp, trả về state mới
  input: InputCmd,
  world: CollisionWorld,    // wrapper quanh Rapier, xem dưới
  cfg: MovementConfig,
  dt: number,
): PlayerState;
```

`CollisionWorld` (trong `shared/src/physics/world.ts`) cung cấp đúng 2 việc:
- `moveCharacter(pos, desiredDelta, crouching) → { pos, grounded, hitCeiling }`
- `canStand(pos) → boolean` (đủ chỗ để đứng dậy không)

`stepMovement` **không được** đọc thời gian thực, `Math.random`, biến toàn cục, DOM.

---

## Task 1.1 – Pointer lock + nhìn chuột

Làm (`client/src/input.ts`):
- Click canvas → `requestPointerLock()`. Esc thoát (trình duyệt tự xử lý), hiện overlay "Click để chơi".
- `mousemove`: `yaw -= movementX * sens`, `pitch -= movementY * sens`, kẹp pitch trong ±89° (±1.553 rad). `sens` mặc định 0.0022 rad/pixel, lưu localStorage.
- Phím: giữ trạng thái WASD, Space, Ctrl/C (ngồi), R, chuột trái (bắn). Xuất ra hàm `sampleButtons(): number`.
- Camera: `camera.rotation.order = 'YXZ'`, gán `rotation.y = yaw`, `rotation.x = pitch` **mỗi frame** (không chờ tick, để nhìn chuột không bị trễ).

Nghiệm thu:
- [ ] Chuột phải → nhìn sang phải. Chuột lên → ngước lên. Không lộn ngược khi kéo hết cỡ.
- [ ] Xoay chuột mượt ở màn 144Hz (không giật theo tick 60).
- [ ] Ctrl+W không đóng tab khi đang khoá chuột (dùng C làm phím ngồi mặc định, Ctrl là phụ).

Pitfall:
- Một số trình duyệt thỉnh thoảng trả `movementX` đột biến rất lớn khi vừa khoá chuột → bỏ qua giá trị có |movementX| > 300 trong frame đầu.

---

## Task 1.2 – Fixed timestep loop

Làm (`client/src/loop.ts`):

```ts
let acc = 0, last = performance.now();
function frame(now: number) {
  acc += Math.min((now - last) / 1000, 0.25); // kẹp khi tab bị treo
  last = now;
  while (acc >= DT) {
    prevState = currState;
    const cmd = buildInputCmd();          // seq++, buttons, yaw, pitch
    currState = stepMovement(currState, cmd, world, cfg, DT);
    acc -= DT;
  }
  const alpha = acc / DT;
  renderPlayerAt(lerpState(prevState, currState, alpha)); // vị trí camera
  requestAnimationFrame(frame);
}
```

- Vị trí camera = nội suy giữa `prevState` và `currState` theo `alpha`. Góc nhìn **không** nội suy, dùng yaw/pitch mới nhất từ chuột.

Nghiệm thu:
- [ ] Đặt màn hình 60Hz và 144Hz: tốc độ chạy giống nhau (đo bằng thời gian chạy hết một bức tường).
- [ ] Chuyển tab 10 giây rồi quay lại: nhân vật không bị "bắn" đi xa.

---

## Task 1.3 – stepMovement: đi, ma sát, trọng lực, nhảy ⚠️

`MovementConfig` mặc định (cảm giác Krunker, chỉnh sau):

```ts
export const defaultMovement = {
  runSpeed: 8.5,        // m/s
  crouchSpeed: 4.0,
  groundAccel: 10,      // kiểu Quake: accel * wishSpeed * dt
  airAccel: 12,
  airWishCap: 1.0,      // giới hạn wishSpeed khi trên không (cho air strafe)
  friction: 6,
  stopSpeed: 2.0,
  gravity: 22,
  jumpVelocity: 7.0,    // cao ~1.1m
  standHeight: 1.8, crouchHeight: 1.2, radius: 0.4,
  eyeStand: 1.6, eyeCrouch: 1.0,
  slideBoost: 3.0, slideDuration: 0.6, slideFriction: 0.8, slideCooldown: 1.0,
  slideMinSpeed: 6.0,
};
```

Thuật toán mỗi tick (đúng thứ tự):

1. `wishDir` = tổng `forward`/`right` theo phím (chỉ dùng yaw), chuẩn hoá; không bấm gì thì `wishDir = 0`.
2. `wishSpeed = crouching ? crouchSpeed : runSpeed`.
3. Nếu **grounded**:
   - Nếu đang giữ Jump → nhảy: `vel.y = jumpVelocity`, `grounded = false`, **bỏ qua ma sát tick này**. Giữ Space là tự nhảy lại ngay khi chạm đất (bunny hop kiểu Krunker).
   - Ngược lại: áp ma sát rồi `accelerate(groundAccel)`.
4. Nếu **trên không**: `accelerate(airAccel)` với `wishSpeed = min(wishSpeed, airWishCap)`.
5. `vel.y -= gravity * dt`.
6. Gọi `world.moveCharacter(pos, vel * dt, crouching)`. Nếu `grounded` và `vel.y < 0` → `vel.y = 0`. Nếu `hitCeiling` và `vel.y > 0` → `vel.y = 0`.
7. Giảm `slideTimer`, `slideCooldown` theo dt (task 1.5).

```ts
function accelerate(vel, wishDir, wishSpeed, accel, dt) {
  const current = vel[0] * wishDir[0] + vel[2] * wishDir[2];
  const add = wishSpeed - current;
  if (add <= 0) return;
  const a = Math.min(accel * wishSpeed * dt, add);
  vel[0] += a * wishDir[0];
  vel[2] += a * wishDir[2];
}

function applyFriction(vel, friction, stopSpeed, dt) {
  const speed = Math.hypot(vel[0], vel[2]);
  if (speed < 1e-4) { vel[0] = 0; vel[2] = 0; return; }
  const control = Math.max(speed, stopSpeed);
  const newSpeed = Math.max(speed - control * friction * dt, 0);
  const k = newSpeed / speed;
  vel[0] *= k; vel[2] *= k;
}
```

Cài đặt `moveCharacter` bằng Rapier:
- Mỗi nhân vật: một capsule collider gắn kinematic body. `controller = world.createCharacterController(0.02)`.
- `controller.setMaxSlopeClimbAngle(50°)`, `controller.enableSnapToGround(0.3)`, **tắt autostep** (dùng ramp).
- `controller.computeColliderMovement(collider, delta, filterFlags, filterGroups)` → `computedMovement()`, `computedGrounded()`.
- `hitCeiling`: delta.y > 0 mà movement thực tế theo y < 50% delta.y.
- **Người chơi không va chạm nhau**: dùng collision groups, capsule người chơi chỉ va với map. (Đơn giản hoá netcode.)

Nghiệm thu:
- [ ] Chạy thẳng đạt ~8,5 m/s (hiện tốc độ trên debug overlay, task 1.6).
- [ ] Thả phím: dừng hẳn trong ~0,3 giây, không trượt như băng.
- [ ] Đi lên ramp lên mặt tường thành được, đi xuống không bị "nảy" khỏi mặt dốc.
- [ ] Đứng dưới đất nhảy **không** lên được mặt tường 4m.
- [ ] Nhảy đập đầu vào mặt dưới của gờ/khung lỗ bắn thì rơi xuống ngay, không dính trần.
- [ ] Trượt dọc tường khi chạy chéo vào tường (không bị dính lại).

Pitfall:
- Ma sát áp **trước** accelerate, và chỉ khi grounded.
- Không chuẩn hoá vel khi tính wishDir; chỉ chuẩn hoá wishDir.
- Nếu đi xuống dốc bị nảy: kiểm tra snap-to-ground đã bật, và bước 6 đặt `vel.y = 0` khi grounded.

---

## Task 1.4 – Không trung, bunny hop

Làm: hoàn thiện bước 3–4 ở trên nếu chưa đủ, chỉnh thông số.

Nghiệm thu:
- [ ] Giữ Space liên tục khi chạy: nhảy lại ngay lúc chạm đất, tốc độ không bị tụt do ma sát.
- [ ] Trên không, giữ A + kéo chuột sang trái (air strafe) đổi hướng được và tăng tốc nhẹ.
- [ ] Trên không bấm S không phanh gấp như dưới đất.

---

## Task 1.5 – Ngồi + trượt

Quy tắc:
- Bấm Crouch khi grounded và tốc độ ngang ≥ `slideMinSpeed` và `slideCooldown ≤ 0` → bắt đầu trượt: cộng `slideBoost` theo hướng vận tốc hiện tại, `slideTimer = slideDuration`, `slideCooldown = slideCooldown`.
- Khi `slideTimer > 0`: ma sát dùng `slideFriction`, **bỏ qua accelerate** (không lái được khi trượt, chỉ xoay nhìn), camera hạ xuống `eyeCrouch`.
- Hết trượt mà vẫn giữ Crouch → ngồi bình thường. Nhả Crouch → đứng dậy nếu `canStand`, không thì vẫn ngồi.
- Ngồi: đổi capsule sang `crouchHeight` (giữ chân ở yên chỗ, hạ đỉnh đầu).
- Camera: chiều cao mắt nội suy mượt ~0,1s, không nhảy cụp.

Nghiệm thu:
- [ ] Chạy + bấm C: lướt đi một đoạn rõ rệt rồi chậm lại.
- [ ] Bấm C liên tục không spam trượt được (có cooldown).
- [ ] Trượt qua lỗ bắn thấp được nếu lỗ đủ cao cho tư thế ngồi (thử chỉnh một lỗ cao 1,3m để test).
- [ ] Đứng dậy dưới gầm thấp: không đứng được, vẫn ngồi, không kẹt vào trần.

---

## Task 1.6 – Test determinism + debug overlay

Làm:
- Test (vitest, chạy Rapier thật): tạo 2 world từ cùng map, chạy cùng dãy 600 InputCmd (ngẫu nhiên có seed: chạy, nhảy, trượt, xoay), so sánh state mỗi tick → **phải giống hệt** (so sánh từng số, sai số 0).
- Test: dãy input "chạy thẳng 2 giây" cho tốc độ cuối trong khoảng 8,4–8,6.
- Overlay (phím F3), góc trên trái, chữ nhỏ: FPS, tốc độ ngang, `grounded`, `slideTimer`, vị trí, yaw/pitch.
- Panel chỉnh thông số (phím F6): slider cho mọi trường của `MovementConfig`, áp dụng ngay, nút "copy JSON" để dán lại vào code.

Nghiệm thu:
- [ ] Test determinism pass.
- [ ] Chỉnh `runSpeed` trên panel thấy tác dụng ngay.

Pitfall:
- Nếu test determinism fail: thường do (1) dùng `Math.random`/thời gian trong `stepMovement`, (2) dùng chung một world cho cả 2 lần chạy, (3) thứ tự tạo collider khác nhau giữa 2 world. Sửa tận gốc, **đừng nới sai số** của test.
