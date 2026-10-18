# Phase 2 – Súng (offline, bắn bia)

Mục tiêu: bắn bia đã tay. Logic súng (đạn, fire rate, spread) viết trong `shared/` để phase 4 server dùng lại.

---

## Thông số súng (`shared/src/weapons.ts`)

```ts
export interface WeaponDef {
  id: number;
  name: string;
  auto: boolean;            // giữ chuột là bắn liên tục
  damage: number;
  headMult: number;
  legMult: number;
  fireIntervalMs: number;
  magSize: number;
  reloadMs: number;
  range: number;            // m
  spreadDeg: { stand: number; move: number; air: number; crouch: number };
  recoilPitchDeg: number;   // mỗi phát hếch nòng
  recoilYawDeg: number;     // lệch ngang ngẫu nhiên ± giá trị này
  recoilRecoverDegPerSec: number;
}

export const WEAPONS: WeaponDef[] = [
  { id: 0, name: 'Rifle', auto: true, damage: 25, headMult: 4, legMult: 0.75,
    fireIntervalMs: 100, magSize: 30, reloadMs: 2000, range: 200,
    spreadDeg: { stand: 0.4, move: 1.5, air: 4, crouch: 0.2 },
    recoilPitchDeg: 0.6, recoilYawDeg: 0.3, recoilRecoverDegPerSec: 8 },
  { id: 1, name: 'Pistol', auto: false, damage: 34, headMult: 3, legMult: 0.75,
    fireIntervalMs: 250, magSize: 12, reloadMs: 1400, range: 120,
    spreadDeg: { stand: 0.3, move: 1.0, air: 3, crouch: 0.2 },
    recoilPitchDeg: 1.2, recoilYawDeg: 0.2, recoilRecoverDegPerSec: 10 },
];
```

Trạng thái súng của người chơi:

```ts
export interface WeaponState {
  current: number;           // id súng đang cầm
  ammo: number[];            // đạn trong băng theo id súng
  reloadEndMs: number;       // 0 = không reload
  nextFireMs: number;
  shotSeq: number;           // tăng mỗi phát, dùng làm seed spread
  triggerHeld: boolean;      // cho súng bán tự động
}
```

Thời gian trong logic súng tính bằng **ms của mô phỏng** (`tick * 1000 / TICK_RATE`), không dùng `performance.now()`, để client và server tính giống nhau.

---

## Task 2.1 – Viewmodel + render pass riêng

Làm (`client/src/render/viewmodel.ts`):
- Scene riêng `viewScene` + camera riêng `viewCam` (FOV cố định 60, near 0.01).
- Súng `.glb` đặt trong `viewScene`, vị trí khởi điểm khoảng `(0.25, −0.22, −0.5)`.
- Render mỗi frame:
  ```ts
  renderer.autoClear = false;
  renderer.clear();
  renderer.render(scene, camera);
  renderer.clearDepth();
  renderer.render(viewScene, viewCam);
  ```
- Nếu chưa có file súng: dùng khối hộp dài màu xám làm súng tạm.
- Phím 1/2 đổi Rifle/Pistol (có animation đơn giản: súng hạ xuống rồi đưa lên, 0,3s).

Nghiệm thu:
- [ ] Đứng sát tường, súng không bị tường che.
- [ ] Đổi FOV camera chính (task 1.1 setting) thì súng không méo theo.

---

## Task 2.2 – Hitscan + bia

Làm:
- Bia: vài hình hộp người (cao 1,8m) đặt khu giữa, đầu là khối riêng. Bia dùng **cùng hàm hitbox** sẽ dùng cho người chơi (`shared/src/hitbox.ts`):
  ```ts
  interface HitBox { min: Vec3; max: Vec3; part: 'head' | 'body' | 'legs'; }
  function hitboxesFor(state: PlayerState, cfg): HitBox[];  // AABB, không xoay theo yaw
  function rayAabb(origin, dir, box, maxDist): number | null; // slab test, trả khoảng cách
  ```
  Đứng: legs 0–0,8m, body 0,8–1,45m, head 1,45–1,8m (rộng 0,6/0,6/0,35). Ngồi: hạ tỉ lệ theo `crouchHeight`.
- Bắn: tia từ mắt (`pos + eyeHeight`) theo hướng nhìn (+ spread). Tính `wallDist` bằng Rapier `castRay` chỉ với map; tính trúng hitbox gần nhất có khoảng cách < `wallDist`.
- Trúng: hiện hitmarker (dấu X trắng, đầu thì đỏ) 150ms, bia nháy đỏ. Trượt: decal lỗ đạn nhỏ trên tường (tối đa 50 cái, cũ nhất bị xoá).

Nghiệm thu:
- [ ] Bắn bia qua lỗ bắn trên tường: trúng. Bắn vào phần tường cạnh lỗ: không trúng bia đằng sau.
- [ ] Ngắm đầu → hitmarker đỏ; ngắm thân → trắng.
- [ ] Test: `rayAabb` với tia đi xuyên giữa box, tia sượt ngoài, tia xuất phát bên trong box (trả 0).

Pitfall:
- Hướng nhìn từ yaw/pitch: `dir = (−sin(yaw)·cos(pitch), sin(pitch), −cos(yaw)·cos(pitch))`. Viết test cho hàm này.
- Hitbox dùng AABB không xoay là cố ý (nhân vật khối hộp, đơn giản cho netcode).

---

## Task 2.3 – Logic súng

Làm `shared/src/weaponLogic.ts`:

```ts
function tryFire(ws: WeaponState, def: WeaponDef, nowMs: number, triggerDown: boolean): boolean
```
- Không bắn nếu: đang reload, `nowMs < nextFireMs`, hết đạn, hoặc súng bán tự động mà `triggerHeld` từ tick trước.
- Bắn: `ammo--`, `nextFireMs = nowMs + fireIntervalMs`, `shotSeq++`.
- Hết đạn mà vẫn bóp cò → tự reload (và phát tiếng "tạch" một lần).
- Reload (R hoặc tự động): `reloadEndMs = nowMs + reloadMs`; xong thì nạp đầy. Đổi súng giữa chừng → huỷ reload.

Spread:
- Chọn mức theo trạng thái: air > move (tốc độ ngang > 1 m/s) > crouch > stand.
- Lệch tia bằng random **có seed**: `rng = mulberry32(hashSeed(playerId, shotSeq))`, lấy góc ngẫu nhiên trong hình nón `spreadDeg`.

Recoil:
- Mỗi phát: cộng `recoilPitchDeg` vào một biến `recoilPitch` riêng (không sửa thẳng pitch của chuột), cộng ngang ngẫu nhiên (rng cùng seed).
- Hướng bắn thực tế = góc nhìn + recoil. Recoil hồi dần về 0 theo `recoilRecoverDegPerSec` khi không bắn.
- Camera cũng hiển thị recoil (người chơi thấy tâm nhảy lên).

Nghiệm thu:
- [ ] Rifle giữ chuột: bắn đều 10 phát/giây, đếm đạn chính xác, hết 30 thì tự reload 2 giây.
- [ ] Pistol giữ chuột: chỉ bắn 1 phát; click nhanh bị giới hạn 4 phát/giây.
- [ ] Bắn khi đang nhảy toé đạn rõ rệt hơn khi đứng (nhìn decal trên tường).
- [ ] Test: cùng `playerId` + `shotSeq` luôn cho cùng hướng lệch.

---

## Task 2.4 – Hiệu ứng, âm thanh, HUD

Làm:
- Hiệu ứng bằng code trên viewmodel (không cần animation file):
  - Bắn: lùi súng 4cm + hếch 3° rồi hồi về như lò xo (~80ms).
  - Đi: lắc súng theo hình số 8, biên độ tỉ lệ tốc độ.
  - Reload: chúc súng xuống 35° và hạ 15cm trong 40% thời gian, giữ, rồi đưa lên.
  - Lửa đầu nòng: sprite tại điểm `muzzle` (Empty trong file glb, hoặc toạ độ cố định nếu dùng súng tạm), hiện 1 frame, xoay ngẫu nhiên.
- Âm thanh (`client/src/audio.ts`, Web Audio API):
  - Preload toàn bộ file vào `AudioBuffer`. Mỗi lần phát tạo `AudioBufferSourceNode` mới.
  - Resume `AudioContext` trong sự kiện click khoá chuột.
  - Âm: bắn (mỗi súng), reload, hết đạn, bước chân (theo quãng đường đi, ~mỗi 2,2m), hitmarker, headshot.
- HUD (HTML/CSS đè canvas): tâm ngắm 4 vạch (giãn ra theo spread hiện tại), máu, đạn `25 / 30`, tên súng, hitmarker.

Nghiệm thu:
- [ ] Xả Rifle: tiếng không bị cắt, không bị rè.
- [ ] Tâm ngắm giãn khi chạy/nhảy, co lại khi đứng.
- [ ] Không có âm thanh nào phát trước khi người chơi click lần đầu (không lỗi console).
