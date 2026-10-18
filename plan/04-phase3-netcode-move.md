# Phase 3 – Multiplayer di chuyển ⚠️

Mục tiêu: nhiều người cùng phòng, thấy nhau chạy nhảy mượt, của mình thì phản hồi tức thì. **Chưa bắn nhau** (để phase 4).

Phase này làm **từng task một, test kỹ rồi mới qua task sau**. Thứ tự task được sắp để mỗi bước đều kiểm chứng được.

## Bức tranh tổng

```
Client (mỗi tick 60Hz)                  Server (mỗi tick 60Hz)
  đọc phím + chuột → InputCmd{seq}  ──►   xếp vào hàng đợi của người đó
  tự chạy stepMovement ngay (predict)      lấy input ra, chạy stepMovement
  lưu cmd vào pendingInputs                ghi lastProcessedSeq
                                          mỗi 3 tick: gửi Snapshot cho từng client
  nhận Snapshot ◄──────────────────────
   - bản thân: reconcile (đặt lại state server, chạy lại các input chưa xử lý)
   - người khác: bỏ vào buffer, vẽ trễ 100ms bằng nội suy
```

## Message (`shared/src/protocol.ts`)

```ts
// Client → Server
type C2S =
  | { t: 1; name: string; room: string }            // Join
  | { t: 2; cmds: InputCmd[] }                      // Inputs (thường 1 cmd/gói)
  | { t: 3; clientTime: number };                   // Ping

// Server → Client
type S2C =
  | { t: 101; yourId: number; tick: number; serverTime: number; mapName: string } // Welcome
  | { t: 102; clientTime: number; serverTime: number }                           // Pong
  | { t: 103; tick: number; serverTime: number; ack: number; players: NetPlayer[] } // Snapshot
  | { t: 104; id: number; name: string }                                         // PlayerJoined
  | { t: 105; id: number };                                                      // PlayerLeft

interface NetPlayer {
  id: number;
  pos: Vec3; vel: Vec3;
  yaw: number; pitch: number;
  flags: number;          // bit: grounded, crouching, sliding
  slideTimer: number; slideCooldown: number;
}
```

- `ack` = `lastProcessedSeq` của **chính client nhận** gói này, nên mỗi client nhận snapshot riêng.
- Snapshot phải chứa **đủ mọi trường của PlayerState** để client đặt lại state của mình chính xác (thiếu `slideTimer` là reconcile lệch ngay khi trượt).
- `serverTime` = ms kể từ lúc server khởi động (`performance.now()` của server).

---

## Task 3.1 – Transport + netsim

Làm:
- Interface chung (client và server mỗi bên một bản cài đặt):
  ```ts
  interface Transport {
    send(msg): void;
    onMessage(cb: (msg) => void): void;
    onClose(cb: () => void): void;
  }
  ```
- Cài đặt bằng WebSocket, `binaryType = 'arraybuffer'`, encode/decode msgpack.
- **Netsim** (bọc ngoài Transport, chỉ bật ở dev): độ trễ mỗi chiều `latencyMs`, dao động `jitterMs`. Gói được giữ lại bằng `setTimeout` rồi mới giao, **nhưng phải giữ đúng thứ tự** (WebSocket là TCP, không bao giờ đảo thứ tự): thời điểm giao của gói sau ≥ gói trước.
- Điều khiển netsim bằng query string: `?lat=80&jit=10`.

Nghiệm thu:
- [ ] Client gửi Ping, server trả Pong, overlay hiện RTT. Với `?lat=80` RTT ~160ms.
- [ ] Bật jitter 30ms: thứ tự gói vẫn đúng (log seq, không bao giờ giảm).

---

## Task 3.2 – Room + join/leave

Làm:
- Server: `Map<roomId, Room>`. Join vào phòng chưa có thì tạo mới. Phòng trống quá 60 giây thì xoá.
- Mỗi người chơi trong room: `{ id, name, transport, state: PlayerState, inputQueue: InputCmd[], lastProcessedSeq, lastCmd }`.
- Join: gán id tăng dần, đặt ở một spawn ngẫu nhiên (đội tính ở phase 5, tạm thời dùng spawn đội A/B xen kẽ), gửi Welcome, báo PlayerJoined cho người khác.
- Client: màn hình nhập tên + mã phòng, rồi vào game.

Nghiệm thu:
- [ ] 2 tab cùng phòng: tab này thấy log "người kia vào". Đóng một tab: tab kia thấy "đã rời".
- [ ] 2 phòng khác mã không thấy nhau.

---

## Task 3.3 – Đồng bộ đồng hồ

Làm (`client/src/net/clock.ts`):
- Mỗi 1 giây gửi Ping `{clientTime: performance.now()}`.
- Nhận Pong: `rtt = now − clientTime`; `offset = serverTime + rtt/2 − now`.
- Giữ 8 mẫu gần nhất, dùng **mẫu có RTT nhỏ nhất** làm offset (ít bị nhiễu nhất).
- `serverNow() = performance.now() + offset`. Không cho `serverNow()` chạy lùi: nếu offset mới làm thời gian lùi, điều chỉnh dần (tối đa 1ms mỗi frame).

Nghiệm thu:
- [ ] Overlay hiện `serverNow()` của client và `serverTime` trong snapshot mới nhất: chênh nhau ≈ RTT/2.
- [ ] Bật/tắt jitter: `serverNow()` không nhảy giật.

---

## Task 3.4 – Server sim + snapshot + "client câm"

Mục đích: kiểm tra server chạy đúng **trước** khi có prediction. Client lúc này chỉ gửi input và vẽ đúng những gì server nói (sẽ bị trễ, đó là bình thường).

Server (`simulation.ts`), mỗi tick:
1. Với mỗi người chơi: lấy tối đa `MAX_INPUTS_PER_TICK` cmd từ hàng đợi (theo thứ tự seq), mỗi cmd chạy `stepMovement` một lần, cập nhật `lastProcessedSeq`, `lastCmd`.
2. Nếu hàng đợi trống: chạy `stepMovement` với `lastCmd` nhưng bỏ các bit Jump/Fire/Reload, **không** tăng `lastProcessedSeq`.
3. Hàng đợi dài hơn `MAX_INPUT_QUEUE`: bỏ bớt cmd cũ nhất.
4. Bỏ qua cmd có `seq ≤ lastProcessedSeq` (trùng/cũ).
5. Kiểm tra cmd hợp lệ: pitch trong ±1.56, yaw hữu hạn, buttons chỉ chứa bit đã định nghĩa. Sai → bỏ cmd.
6. Mỗi `SNAPSHOT_EVERY_TICKS` tick: gửi Snapshot cho từng client (với `ack` riêng).

Server loop: dùng `setInterval` 1ms hoặc vòng `setTimeout` tự hiệu chỉnh, tính số tick cần chạy theo thời gian thực đã trôi (accumulator), **không** tin `setInterval(…, 16)` chạy đúng nhịp.

Client: gửi InputCmd mỗi tick (task 1.2), vẽ mọi người (kể cả mình) ở vị trí snapshot mới nhất. Người khác vẽ bằng capsule màu.

Nghiệm thu:
- [ ] 2 tab: chạy ở tab A, tab B thấy A di chuyển (giật cục 20 lần/giây là đúng ở bước này).
- [ ] Ở tab A, nhân vật của mình chạy được, trễ theo ping (`?lat=100` thấy trễ rõ).
- [ ] Server log số tick/giây = 60 ± 1 trong 1 phút.
- [ ] Gửi cmd trùng seq (sửa tạm client để gửi 2 lần): server không chạy 2 lần.

---

## Task 3.5 – Interpolation người khác

Làm (`client/src/net/interpolation.ts`):
- Mỗi người khác có buffer `{serverTime, state}[]`, giữ ~1 giây.
- Mỗi frame: `renderTime = serverNow() − INTERP_DELAY_MS`.
- Tìm 2 snapshot `a`, `b` với `a.serverTime ≤ renderTime < b.serverTime`. `t = (renderTime − a.serverTime) / (b.serverTime − a.serverTime)`.
- Vị trí: `lerp`. yaw: `lerpAngle`. pitch: `lerp`. Cờ (ngồi, trượt): lấy của `a`.
- Không có `b` (snapshot đến muộn): giữ nguyên ở snapshot cuối, tối đa 250ms, sau đó đứng yên (**không** ngoại suy xa).
- Ghi `renderTime` mỗi frame vào biến toàn cục `currentRenderTime` (phase 4 dùng khi bắn).

Nghiệm thu:
- [ ] Tab B thấy A di chuyển mượt, không giật.
- [ ] Với `?jit=30`: vẫn mượt.
- [ ] A quay 180° qua mốc ±π: B thấy A quay ngắn nhất, không xoay vòng cả vòng tròn.

---

## Task 3.6 – Prediction + reconciliation ⚠️

Tham khảo cách làm trong repo MOBA (`MOBA_REPO` trong `00-overview.md`), cùng ý tưởng input replay.

Làm (`client/src/net/prediction.ts`):
- Mỗi tick: tạo cmd, chạy `stepMovement` ngay trên state dự đoán, đẩy `{cmd, stateAfter}` vào `pending`, gửi cmd.
- Nhận Snapshot:
  1. Xoá khỏi `pending` mọi cmd có `seq ≤ ack`.
  2. `serverState` = state của mình trong snapshot.
  3. So `serverState` với `stateAfter` đã lưu cho cmd `seq = ack` (nếu còn): ghi sai số vào overlay.
  4. **Luôn** đặt `predicted = serverState` rồi chạy lại `stepMovement` cho tất cả cmd còn trong `pending` (theo thứ tự), cập nhật lại `stateAfter` của từng cmd.
- Làm mượt hiển thị: nếu vị trí sau reconcile lệch so với vị trí đang vẽ < 1m, giữ một `visualOffset` = (vị trí cũ − vị trí mới) và giảm dần `visualOffset *= 0.85` mỗi frame. Lệch ≥ 1m thì nhảy thẳng (teleport).
- Collider của mình trong world client phải được đặt lại vị trí `serverState` trước khi replay (Rapier giữ vị trí collider riêng).

Nghiệm thu:
- [ ] `?lat=100`: bấm W nhân vật đi **ngay lập tức**, không trễ.
- [ ] Chạy, nhảy, trượt, lên ramp liên tục 1 phút với `?lat=100&jit=20`: sai số reconcile trên overlay hầu hết = 0, thỉnh thoảng rất nhỏ; không giật thấy bằng mắt.
- [ ] Sửa tạm server để đẩy người chơi lệch 2m: client nhảy về vị trí đúng (teleport), không kẹt.

Pitfall (đọc trước khi code):
- Sai số reconcile luôn khác 0 dù chỉ đi thẳng → `stepMovement` client và server **không giống nhau**: kiểm tra cùng `MovementConfig`, cùng map, cùng version Rapier, snapshot thiếu trường nào của PlayerState.
- Sai số chỉ xuất hiện khi trượt → snapshot thiếu `slideTimer`/`slideCooldown`.
- Sai số khi lên/xuống ramp → collider của mình không được đặt lại trước replay, hoặc trạng thái `grounded` không được đồng bộ.
- Đừng "sửa" bằng cách bỏ qua reconcile khi sai số nhỏ; gốc phải là sai số = 0.

---

## Task 3.7 – Ghost + kiểm thử ping cao

Làm:
- Phím F5: vẽ "bóng ma" wireframe ở vị trí server thật của mình (từ snapshot mới nhất) và của người khác (snapshot mới nhất, không nội suy).
- Overlay F3 thêm: RTT, offset đồng hồ, số cmd trong `pending`, sai số reconcile lớn nhất 5 giây gần nhất, số snapshot nhận/giây.

Nghiệm thu (bài kiểm tra cuối phase):
- [ ] 3 tab cùng phòng, mỗi tab một mức `?lat=` khác nhau (20, 80, 150). Tất cả chạy nhảy, ai cũng thấy người khác mượt.
- [ ] Nhân vật của mình luôn phản hồi tức thì ở mọi mức ping.
- [ ] Bóng ma của mình đi theo sau nhân vật đúng khoảng trễ ping, không lệch đường.
