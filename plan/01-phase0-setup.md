# Phase 0 – Khung dự án

Mục tiêu: repo chạy được, map "Hai thành" hiện ra trên trình duyệt, camera bay tự do để ngắm.

---

## Task 0.1 – Monorepo + scripts

Làm:
- npm workspaces với 3 package `shared`, `server`, `client`. `server` và `client` import `shared` bằng tên package (ví dụ `@fps/shared`).
- `tsconfig` strict mode (`"strict": true`, `"noUncheckedIndexedAccess": true`).
- Scripts ở gốc:
  - `npm run dev` → chạy server (tsx watch) + client (vite) cùng lúc
  - `npm run typecheck` → `tsc --noEmit` cho cả 3 package
  - `npm test` → vitest
- Server mặc định cổng 8080, client 5173.

Nghiệm thu:
- [ ] `npm run dev` mở được trang trắng có chữ "FPS Web", console server in "listening 8080".
- [ ] `npm run typecheck` và `npm test` (một test giả) pass.
- [ ] Sửa một hằng số trong `shared` thì cả client và server thấy giá trị mới mà không cần build tay.

Pitfall:
- Vite cần được cấu hình để xử lý package workspace dạng TypeScript nguồn (không phải đã build). Nếu lỗi import, kiểm tra `exports`/`main` trong `shared/package.json` trỏ về `src/index.ts`.

---

## Task 0.2 – Hằng số, quy ước, protocol rỗng

Làm:
- `shared/src/constants.ts` theo `00-overview.md`.
- `shared/src/math.ts`:
  - `forwardFromYaw(yaw, out)`, `rightFromYaw(yaw, out)` theo quy ước trong CLAUDE.md
  - `lerp(a, b, t)`, `lerpAngle(a, b, t)` (đi đường ngắn nhất qua ±π)
  - `mulberry32(seed)` trả về hàm random [0,1)
  - `hashSeed(...nums)` gộp nhiều số thành seed 32-bit
- `shared/src/protocol.ts`: khai báo type rỗng cho message (sẽ điền dần), hàm `encode(msg)` / `decode(buf)` dùng msgpack. Mỗi message có field `t` (số nhỏ, ví dụ `1 = Input`) để phân loại.

Nghiệm thu:
- [ ] Test: `forwardFromYaw(0)` = (0,0,−1); `forwardFromYaw(π/2)` = (−1,0,0); `rightFromYaw(0)` = (1,0,0).
- [ ] Test: `lerpAngle(3.0, −3.0, 0.5)` cho kết quả gần ±π (không phải 0).
- [ ] Test: `mulberry32(42)` gọi 3 lần cho cùng dãy số ở mọi lần chạy.
- [ ] Test: encode rồi decode một object ra đúng object ban đầu.

---

## Task 0.3 – Map format + loader + mirror

Kiểu dữ liệu (`shared/src/map/types.ts`):

```ts
type Vec3 = [number, number, number];

interface MapBox {
  pos: Vec3;          // tâm khối
  size: Vec3;         // kích thước đầy đủ (không phải half-extent)
  texture: string;    // "wall" | "floor" | "crate" ...
  noMirror?: boolean; // khối nằm trên trục giữa, không nhân đôi
}

interface MapRamp {
  from: Vec3;   // điểm giữa mép dưới
  to: Vec3;     // điểm giữa mép trên
  width: number;
  noMirror?: boolean;
}

interface MapSpawn { pos: Vec3; yaw: number; }

interface MapFile {
  name: string;
  mirrorX: boolean;
  boxes: MapBox[];
  ramps: MapRamp[];
  spawnsA: MapSpawn[];   // chỉ khai báo đội A khi mirrorX = true
}

interface LoadedMap {
  name: string;
  boxes: MapBox[];
  ramps: MapRamp[];
  spawns: { A: MapSpawn[]; B: MapSpawn[] };
}
```

Quy tắc mirror (`loadMap.ts`), khi `mirrorX = true`:
- Mỗi box/ramp không có `noMirror`: thêm bản sao với `x → −x` (cả `pos`, `from`, `to`). `size` giữ nguyên.
- Mỗi spawn đội A → spawn đội B với `x → −x` và **`yaw → −yaw`**.
- Kiểm tra: không box nào (trừ `noMirror`) được cắt qua `x = 0`; nếu có thì throw lỗi rõ ràng.

Nghiệm thu:
- [ ] Test: một box ở x = −5 sinh ra box ở x = 5.
- [ ] Test: spawn A tại x = −25, yaw = −π/2 (nhìn về +X, tức về phía địch) → spawn B tại x = 25, yaw = π/2 (nhìn về −X). Kiểm tra bằng `forwardFromYaw`: hai hướng ngược dấu x.
- [ ] Test: box có `noMirror` không bị nhân đôi.
- [ ] Test: box cắt qua x = 0 mà thiếu `noMirror` → throw.

Pitfall:
- Đây là chỗ hay sai nhất của phase 0: quên lật yaw, hoặc lật thành `π − yaw`. Với quy ước của dự án, lật trục X tương đương **`yaw → −yaw`**.

---

## Task 0.4 – Dựng map "Hai thành" + render tĩnh

Làm:
- Viết `assets/maps/hai-thanh.json` theo bảng trong `00-overview.md` (chỉ nửa x âm + các khối `noMirror`).
- `shared/src/physics/world.ts`: `createWorld(map: LoadedMap)` tạo Rapier world, mỗi box là cuboid collider tĩnh, mỗi ramp là cuboid xoay theo độ dốc. Hàm này **dùng chung client/server**.
- Lỗ bắn: tường có lỗ được ghép từ nhiều box (đoạn dưới lỗ, đoạn trên lỗ, các đoạn hai bên), **không dùng boolean CSG**.
- Client: `render/mapMesh.ts` dựng mesh từ cùng dữ liệu (BoxGeometry, ramp là box xoay), texture prototype kẻ ô (tạm thời có thể sinh ô bằng canvas nếu chưa có file texture).
- Camera bay tự do (WASD + chuột, Q/E lên xuống) để ngắm map. Đèn: 1 hemisphere + 1 directional.

Nghiệm thu:
- [ ] Map hiện đủ: tường bao, 2 căn cứ, 2 tường thành có lỗ, 2 ramp, 2 tháp, khu giữa.
- [ ] Hai nửa đối xứng nhau (bay lên cao nhìn xuống so sánh).
- [ ] Bật chế độ debug (phím F4) vẽ wireframe collider Rapier chồng lên mesh: collider khớp mesh, kể cả ramp.
- [ ] Spawn hiện bằng mũi tên nhỏ chỉ hướng yaw; mũi tên của 2 đội đều chỉ về phía khu giữa.

Pitfall:
- Ramp: Rapier cuboid xoay bằng quaternion quanh trục vuông góc với hướng dốc. Tính góc = `atan2(to.y − from.y, khoảng cách ngang)`. Kiểm tra bằng wireframe, đừng tin mắt nhìn mesh.
- Texture kẻ ô bị kéo giãn trên khối dài: chỉnh `texture.repeat` theo kích thước từng mặt, hoặc dùng UV theo toạ độ thế giới.
