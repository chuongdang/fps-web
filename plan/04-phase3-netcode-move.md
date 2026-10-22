# Phase 3 – Multiplayer movement ⚠️

Goal: several players in the same room, seeing each other run and jump smoothly, with your own character responding instantly. **No shooting each other yet** (that is phase 4).

Do this phase **one task at a time, testing thoroughly before moving to the next task**. The tasks are ordered so that every step can be verified.

## Big picture

```
Client (every 60Hz tick)                Server (every 60Hz tick)
  read keys + mouse → InputCmd{seq}  ──►   queue it in that player's queue
  run stepMovement immediately (predict)    take inputs out, run stepMovement
  store the cmd in pendingInputs            record lastProcessedSeq
                                          every 3 ticks: send a Snapshot to each client
  receive Snapshot ◄──────────────────────
   - self: reconcile (reset to the server state, replay the unprocessed inputs)
   - others: put into a buffer, draw 100ms late using interpolation
```

## Messages (`shared/src/protocol.ts`)

```ts
// Client → Server
type C2S =
  | { t: 1; name: string; room: string }            // Join
  | { t: 2; cmds: InputCmd[] }                      // Inputs (usually 1 cmd/packet)
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
  flags: number;          // bits: grounded, crouching, sliding
  slideTimer: number; slideCooldown: number;
}
```

- `ack` = the `lastProcessedSeq` of **the client receiving this packet**, so each client receives its own snapshot.
- The snapshot must contain **every field of PlayerState** so the client can reset its own state exactly (missing `slideTimer` makes reconcile drift as soon as you slide).
- `serverTime` = ms since the server started (the server's `performance.now()`).

---

## Task 3.1 – Transport + netsim

Do:
- A shared interface (client and server each have their own implementation):
  ```ts
  interface Transport {
    send(msg): void;
    onMessage(cb: (msg) => void): void;
    onClose(cb: () => void): void;
  }
  ```
- Implement with WebSocket, `binaryType = 'arraybuffer'`, msgpack encode/decode.
- **Netsim** (wraps the Transport, enabled only in dev): per-direction latency `latencyMs`, fluctuation `jitterMs`. Packets are held with `setTimeout` before being delivered, **but order must be preserved** (WebSocket is TCP and never reorders): a later packet's delivery time ≥ the earlier packet's.
- Control netsim with a query string: `?lat=80&jit=10`.

Acceptance:
- [ ] The client sends Ping, the server replies Pong, and the overlay shows RTT. With `?lat=80` RTT is ~160ms.
- [ ] With 30ms jitter on: packet order is still correct (log seq, it never decreases).

---

## Task 3.2 – Room + join/leave

Do:
- Server: `Map<roomId, Room>`. Joining a room that does not exist creates it. A room that stays empty for over 60 seconds is deleted.
- Each player in a room: `{ id, name, transport, state: PlayerState, inputQueue: InputCmd[], lastProcessedSeq, lastCmd }`.
- Join: assign an incrementing id, place at a random spawn (teams are handled in phase 5; for now alternate between team A/B spawns), send Welcome, notify others with PlayerJoined.
- Client: a screen to enter a name + room code, then enter the game.

Acceptance:
- [ ] 2 tabs in the same room: this tab logs "the other player joined". Close one tab: the other sees "left".
- [ ] 2 rooms with different codes cannot see each other.

---

## Task 3.3 – Clock synchronization

Do (`client/src/net/clock.ts`):
- Every 1 second send a Ping `{clientTime: performance.now()}`.
- On Pong: `rtt = now − clientTime`; `offset = serverTime + rtt/2 − now`.
- Keep the 8 most recent samples and use the **sample with the smallest RTT** for the offset (the least noisy).
- `serverNow() = performance.now() + offset`. Do not let `serverNow()` run backwards: if a new offset would make time go back, adjust gradually (at most 1ms per frame).

Acceptance:
- [ ] The overlay shows the client's `serverNow()` and the `serverTime` in the latest snapshot: they differ by ≈ RTT/2.
- [ ] Toggling jitter on/off: `serverNow()` does not jump.

---

## Task 3.4 – Server sim + snapshot + "dumb client"

Purpose: check that the server runs correctly **before** adding prediction. At this point the client only sends input and draws exactly what the server says (it will lag, which is normal).

Server (`simulation.ts`), each tick:
1. For each player: take up to `MAX_INPUTS_PER_TICK` cmds from the queue (in seq order), run `stepMovement` once per cmd, and update `lastProcessedSeq`, `lastCmd`.
2. If the queue is empty: run `stepMovement` with `lastCmd` but with the Jump/Fire/Reload bits stripped, **without** increasing `lastProcessedSeq`.
3. If the queue is longer than `MAX_INPUT_QUEUE`: drop the oldest cmds.
4. Ignore cmds with `seq ≤ lastProcessedSeq` (duplicate/stale).
5. Validate the cmd: pitch within ±1.56, yaw finite, buttons contain only defined bits. Invalid → drop the cmd.
6. Every `SNAPSHOT_EVERY_TICKS` ticks: send a Snapshot to each client (with its own `ack`).

Server loop: use a 1ms `setInterval` or a self-correcting `setTimeout` loop, and compute the number of ticks to run from the real time elapsed (accumulator); **do not** trust `setInterval(…, 16)` to run on beat.

Client: send an InputCmd every tick (task 1.2), draw everyone (including yourself) at the latest snapshot position. Others are drawn as colored capsules.

Acceptance:
- [ ] 2 tabs: run in tab A, tab B sees A moving (choppy at 20 times/second is correct at this step).
- [ ] In tab A, your own character can run, delayed by ping (with `?lat=100` the delay is clearly visible).
- [ ] The server logs ticks/second = 60 ± 1 over 1 minute.
- [ ] Sending a cmd with a duplicate seq (temporarily change the client to send it twice): the server does not run it twice.

---

## Task 3.5 – Interpolating other players

Do (`client/src/net/interpolation.ts`):
- Each other player has a buffer `{serverTime, state}[]`, keeping ~1 second.
- Each frame: `renderTime = serverNow() − INTERP_DELAY_MS`.
- Find 2 snapshots `a`, `b` with `a.serverTime ≤ renderTime < b.serverTime`. `t = (renderTime − a.serverTime) / (b.serverTime − a.serverTime)`.
- Position: `lerp`. yaw: `lerpAngle`. pitch: `lerp`. Flags (crouch, slide): take from `a`.
- No `b` (a snapshot arrived late): hold at the last snapshot for at most 250ms, then stand still (**do not** extrapolate far).
- Write `renderTime` each frame to the global variable `currentRenderTime` (phase 4 uses it when shooting).

Acceptance:
- [ ] Tab B sees A move smoothly, with no stutter.
- [ ] With `?jit=30`: still smooth.
- [ ] A turns 180° across the ±π boundary: B sees A turn the short way, not spin a full circle.

---

## Task 3.6 – Prediction + reconciliation ⚠️

See the approach in the MOBA repo (`MOBA_REPO` in `00-overview.md`), which uses the same input replay idea.

Do (`client/src/net/prediction.ts`):
- Each tick: build a cmd, run `stepMovement` immediately on the predicted state, push `{cmd, stateAfter}` into `pending`, and send the cmd.
- On receiving a Snapshot:
  1. Remove from `pending` every cmd with `seq ≤ ack`.
  2. `serverState` = your own state in the snapshot.
  3. Compare `serverState` with the saved `stateAfter` for the cmd with `seq = ack` (if it is still there): write the error to the overlay.
  4. **Always** set `predicted = serverState`, then re-run `stepMovement` for all cmds still in `pending` (in order), updating each cmd's `stateAfter`.
- Display smoothing: if the position after reconcile differs from the position being drawn by < 1m, keep a `visualOffset` = (old position − new position) and decay it with `visualOffset *= 0.85` each frame. If the difference is ≥ 1m, jump straight (teleport).
- Your own collider in the client world must be reset to the `serverState` position before replaying (Rapier keeps its own collider position).

Acceptance:
- [ ] `?lat=100`: pressing W moves the character **immediately**, with no delay.
- [ ] Running, jumping, sliding, and going up ramps continuously for 1 minute with `?lat=100&jit=20`: the reconcile error on the overlay is mostly 0, occasionally very small; no visible stutter.
- [ ] Temporarily change the server to push the player 2m off: the client jumps back to the correct position (teleport), without getting stuck.

Pitfalls (read before coding):
- The reconcile error is always non-zero even when just walking straight → client and server `stepMovement` are **not identical**: check the same `MovementConfig`, the same map, the same Rapier version, and which PlayerState fields the snapshot is missing.
- The error only appears when sliding → the snapshot is missing `slideTimer`/`slideCooldown`.
- The error when going up/down ramps → your own collider is not reset before the replay, or the `grounded` state is not synced.
- Do not "fix" it by skipping reconcile when the error is small; the root goal is error = 0.

---

## Task 3.7 – Ghost + high-ping testing

Do:
- F5 key: draw a wireframe "ghost" at the true server position of yourself (from the latest snapshot) and of others (latest snapshot, not interpolated).
- Add to the F3 overlay: RTT, clock offset, number of cmds in `pending`, the largest reconcile error in the last 5 seconds, snapshots received per second.

Acceptance (end-of-phase test):
- [ ] 3 tabs in the same room, each with a different `?lat=` (20, 80, 150). Everyone runs and jumps, and everyone sees the others smoothly.
- [ ] Your own character always responds instantly at every ping level.
- [ ] Your own ghost trails behind the character by exactly the ping delay, without drifting off the path.
