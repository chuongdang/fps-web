import { DT, TICK_RATE, adsMoveFor, adsWanted, copyWeaponState, makeWeaponState, moveSpeedMul, stepMovement, stepWeaponCmd, type AdsMove, type InputCmd, type MovementConfig, type PlayerState, type WeaponState } from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'

const MAX_PENDING = 240          // 4 seconds of unacked cmds; beyond that drop the oldest
const TELEPORT_DIST = 1          // error ≥ 1m: snap straight there, no smoothing
const OFFSET_DECAY = 0.85        // per frame
const OFFSET_EPS = 1e-4
const ERROR_WINDOW_MS = 5000

interface Pending { cmd: InputCmd; stateAfter: PlayerState }

// Client-side prediction + reconcile (input replay):
//  - each tick: run stepMovement immediately, remember {cmd, stateAfter}
//  - on snapshot: drop acked cmds, set state = server state, replay the remaining cmds
export class Prediction {
  predicted: PlayerState
  pending: Pending[] = []
  ready = false                   // first snapshot received
  lastError = 0                   // position error (m) at the latest reconcile
  reconciles = 0
  private errors: { t: number; e: number }[] = []
  private wsScratch = makeWeaponState()   // weapon replay in parallel with the position replay (run speed depends on the held weapon)
  // Display smoothing: drawn position = predicted.pos + visualOffset
  readonly visualOffset: [number, number, number] = [0, 0, 0]

  constructor(
    private world: CollisionWorld,
    private cfg: MovementConfig,   // changeable when the role changes (human ↔ zombie): setConfig
    initial: PlayerState,
    private now: () => number = () => performance.now(),
  ) {
    this.predicted = initial
  }

  /** Change the movement config (human ↔ zombie). Call before onSnapshot of the snapshot announcing the new role so the replay uses the right config. */
  setConfig(cfg: MovementConfig): void { this.cfg = cfg }

  // Run one prediction tick. Call after the cmd is created; returns the new state.
  // speedMul = speed factor of the held weapon BEFORE this cmd (moveSpeedMul of the current WeaponState)
  step(cmd: InputCmd, speedMul = 1, ads: AdsMove | null = null, adsWant = false): PlayerState {
    const next = stepMovement(this.predicted, cmd, this.world, this.cfg, DT, speedMul, ads, adsWant)
    this.predicted = next
    this.pending.push({ cmd, stateAfter: next })
    if (this.pending.length > MAX_PENDING) this.pending.shift()
    return next
  }

  // Respawn: set a new state, drop unacked cmds, no smoothing
  teleport(state: PlayerState): void {
    this.predicted = state
    this.pending.length = 0
    this.visualOffset[0] = 0; this.visualOffset[1] = 0; this.visualOffset[2] = 0
  }

  // wpn = the server's WeaponState after cmd `ack`: replay the weapon at the same time to get the right run speed at each unacked cmd
  onSnapshot(ack: number, serverState: PlayerState, wpn?: WeaponState | null): void {
    // Compare with the stateAfter stored for cmd seq = ack (if still present)
    let error = -1
    for (const p of this.pending) {
      if (p.cmd.seq === ack) { error = dist(p.stateAfter.pos, serverState.pos); break }
    }
    let drop = 0
    while (drop < this.pending.length && this.pending[drop]!.cmd.seq <= ack) drop++
    if (drop > 0) this.pending.splice(0, drop)

    // Drawn position before the correction
    const ox = this.predicted.pos[0] + this.visualOffset[0]
    const oy = this.predicted.pos[1] + this.visualOffset[1]
    const oz = this.predicted.pos[2] + this.visualOffset[2]

    // Always reset to the server state, then replay the unacked cmds. stepMovement passes the position into
    // the world every call, so our collider is reset to the state automatically.
    let s = serverState
    const ws = this.wsScratch
    if (wpn) copyWeaponState(ws, wpn)
    for (const p of this.pending) {
      s = wpn
        ? stepMovement(s, p.cmd, this.world, this.cfg, DT, moveSpeedMul(ws), adsMoveFor(ws), adsWanted(ws, p.cmd.buttons, p.cmd.seq * 1000 / TICK_RATE))
        : stepMovement(s, p.cmd, this.world, this.cfg, DT, 1)
      if (wpn) stepWeaponCmd(ws, p.cmd)
      p.stateAfter = s
    }
    this.predicted = s

    const dx = ox - s.pos[0], dy = oy - s.pos[1], dz = oz - s.pos[2]
    if (this.ready && Math.hypot(dx, dy, dz) < TELEPORT_DIST) {
      this.visualOffset[0] = dx; this.visualOffset[1] = dy; this.visualOffset[2] = dz
    } else {
      this.visualOffset[0] = 0; this.visualOffset[1] = 0; this.visualOffset[2] = 0   // teleport
    }
    this.ready = true

    if (error >= 0) {
      this.lastError = error
      this.reconciles++
      const t = this.now()
      this.errors.push({ t, e: error })
      while (this.errors.length > 0 && this.errors[0]!.t < t - ERROR_WINDOW_MS) this.errors.shift()
    }
  }

  // Call every rendered frame
  decayOffset(): readonly [number, number, number] {
    const o = this.visualOffset
    o[0] *= OFFSET_DECAY; o[1] *= OFFSET_DECAY; o[2] *= OFFSET_DECAY
    if (Math.hypot(o[0], o[1], o[2]) < OFFSET_EPS) { o[0] = 0; o[1] = 0; o[2] = 0 }
    return o
  }

  // Largest error in the last 5 seconds
  maxError(): number {
    const t = this.now() - ERROR_WINDOW_MS
    let m = 0
    for (const r of this.errors) if (r.t >= t && r.e > m) m = r.e
    return m
  }
}

function dist(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)
}
