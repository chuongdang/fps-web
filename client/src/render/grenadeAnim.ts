import type { GrenadeFirst, GrenadePullKey, Vec3 } from './poses'

// First-person grenade animation (plan 12, G.5). Pure maths: the throw logic (ws.nade) provides the phase + pin-pull progress, and this file
// outputs the grenade position/rotation in the right hand, the left-hand target along the pin-pull path, whether the pin has moved to the left hand, and whether the grenade is still visible.
export type NadePhase = 'idle' | 'pull' | 'ready' | 'windup' | 'throw' | 'recover' | 'raise' | 'cancel'
export type LogicPhase = 'idle' | 'pulling' | 'ready'

const CANCEL_MS = 150
const WINDUP_BACK: Vec3 = [0, 0.02, 0.05]    // pull the hand back 5 cm (z + = toward the camera)
const HIDE_DROP = 0.55                        // lower the hand off-screen (m)
const BREATH_AMP = 0.004, BREATH_PERIOD_S = 3.5

const smooth = (x: number) => { const t = x < 0 ? 0 : x > 1 ? 1 : x; return t * t * (3 - 2 * t) }
const lerp3 = (a: Vec3, b: Vec3, t: number, out: Vec3) => { out[0] = a[0] + (b[0] - a[0]) * t; out[1] = a[1] + (b[1] - a[1]) * t; out[2] = a[2] + (b[2] - a[2]) * t }

export interface NadePose {
  pos: Vec3; rotDeg: Vec3
  show: boolean              // whether the grenade in the right hand is visible (hidden from release until a new one is brought up)
  leftS: number              // position along the left-hand path 0..1; −1 = at leftRest (off-screen)
  pin: 'onGrenade' | 'onLeftHand' | 'hidden'
}

/** Point on the pin-pull path at s (0..1): returns the key + interpolation factor between two adjacent keys */
export function pathSegment(keys: GrenadePullKey[], s: number): { a: GrenadePullKey; b: GrenadePullKey; u: number } {
  let i = 0
  while (i < keys.length - 2 && s >= keys[i + 1]!.t) i++
  const a = keys[i]!, b = keys[Math.min(i + 1, keys.length - 1)]!
  return { a, b, u: smooth(b.t > a.t ? (s - a.t) / (b.t - a.t) : 1) }
}

export class GrenadeAnim {
  phase: NadePhase = 'idle'
  private t = 0                  // ms in the current phase
  private mode: 'strong' | 'lob' = 'strong'
  private pull = 0
  private hasMore = false
  private emptyHand = false         // last grenade thrown: empty hand
  private clock = 0              // seconds, for the breathing rhythm
  private from: Vec3 = [0, 0, 0] // pose at the start of the cancel
  private fromRot: Vec3 = [0, 0, 0]
  private pending: { phase: LogicPhase; pull: number } | null = null
  readonly out: NadePose = { pos: [0, 0, 0], rotDeg: [0, 0, 0], show: true, leftS: -1, pin: 'onGrenade' }

  constructor(private cfg: () => GrenadeFirst) {}

  reset(): void { this.phase = 'idle'; this.t = 0; this.pending = null; this.emptyHand = false }

  /** Call every frame with the logic state (ws.nade): phase, mode, pin-pull progress 0..1, whether any grenades remain after the throw */
  setLogic(phase: LogicPhase, mode: 'strong' | 'lob', pullFrac: number, hasMore: boolean): void {
    this.mode = mode
    this.pull = pullFrac < 0 ? 0 : pullFrac > 1 ? 1 : pullFrac
    this.hasMore = hasMore
    switch (this.phase) {
      case 'idle':
        if (phase === 'pulling' || phase === 'ready') this.go('pull')
        break
      case 'pull':
        if (phase === 'ready') this.go('ready')
        else if (phase === 'idle') this.cancel()
        break
      case 'ready':
        if (phase === 'idle') this.cancel()
        break
      case 'raise': case 'recover': case 'windup': case 'throw': case 'cancel':
        this.pending = { phase, pull: this.pull }   // this logic phase is taken once the current motion finishes
        break
    }
  }

  /** Logic just threw (ready + release): swing the arm, the held grenade disappears at once (the real grenade flies from G.4) */
  onThrow(): void { this.go('windup'); this.emptyHand = false }

  private go(p: NadePhase): void { this.phase = p; this.t = 0 }
  private cancel(): void { this.from = [...this.out.pos] as Vec3; this.fromRot = [...this.out.rotDeg] as Vec3; this.go('cancel') }

  update(dtMs: number): NadePose {
    const c = this.cfg()
    this.t += dtMs
    this.clock += dtMs / 1000
    const o = this.out
    const m = this.mode
    const idleRot = c.idleRotDeg, readyRot = c.readyRotDeg[m]
    o.show = true; o.leftS = -1; o.pin = 'onGrenade'
    switch (this.phase) {
      case 'idle':
        o.show = !this.emptyHand; o.pin = this.emptyHand ? 'hidden' : 'onGrenade'
        o.pos[0] = c.idlePos[0]; o.pos[1] = c.idlePos[1]; o.pos[2] = c.idlePos[2]
        o.rotDeg[0] = idleRot[0]; o.rotDeg[1] = idleRot[1]; o.rotDeg[2] = idleRot[2]
        break
      case 'pull': {
        const u = smooth(this.pull)
        lerp3(c.idlePos, c.readyPos[m], u, o.pos); lerp3(idleRot, readyRot, u, o.rotDeg)
        o.leftS = this.pull
        o.pin = this.pull >= (c.pinAttachT ?? 0.75) ? 'onLeftHand' : 'onGrenade'
        break
      }
      case 'ready': {
        const p = c.readyPos[m]
        o.pos[0] = p[0]; o.pos[1] = p[1] + Math.sin(this.clock * 2 * Math.PI / BREATH_PERIOD_S) * BREATH_AMP; o.pos[2] = p[2]
        o.rotDeg[0] = readyRot[0]; o.rotDeg[1] = readyRot[1]; o.rotDeg[2] = readyRot[2]
        o.leftS = 1; o.pin = 'onLeftHand'
        break
      }
      case 'windup': {
        const p = c.readyPos[m], k = smooth(this.t / c.windupMs)
        o.pos[0] = p[0] + WINDUP_BACK[0] * k; o.pos[1] = p[1] + WINDUP_BACK[1] * k; o.pos[2] = p[2] + WINDUP_BACK[2] * k
        o.rotDeg[0] = readyRot[0]; o.rotDeg[1] = readyRot[1]; o.rotDeg[2] = readyRot[2]
        o.show = false; o.pin = 'hidden'
        if (this.t >= c.windupMs) this.go('throw')
        break
      }
      case 'throw': {
        const p = c.readyPos[m], a: Vec3 = [p[0] + WINDUP_BACK[0], p[1] + WINDUP_BACK[1], p[2] + WINDUP_BACK[2]]
        lerp3(a, c.throwPos[m], smooth(this.t / c.throwMs), o.pos)
        o.rotDeg[0] = readyRot[0] * (1 - smooth(this.t / c.throwMs)); o.rotDeg[1] = readyRot[1]; o.rotDeg[2] = readyRot[2]
        o.show = false; o.pin = 'hidden'
        if (this.t >= c.throwMs) this.go('recover')
        break
      }
      case 'recover': {
        const k = smooth(this.t / c.recoverMs), p = c.throwPos[m]
        o.pos[0] = p[0]; o.pos[1] = p[1] - HIDE_DROP * k; o.pos[2] = p[2]
        o.rotDeg[0] = 0; o.rotDeg[1] = readyRot[1]; o.rotDeg[2] = readyRot[2]
        o.show = false; o.pin = 'hidden'
        if (this.t >= c.recoverMs) { if (this.hasMore) this.go('raise'); else { this.emptyHand = true; this.go('idle') } }
        break
      }
      case 'raise': {
        const k = smooth(this.t / c.recoverMs)
        o.pos[0] = c.idlePos[0]; o.pos[1] = c.idlePos[1] - HIDE_DROP * (1 - k); o.pos[2] = c.idlePos[2]
        o.rotDeg[0] = idleRot[0]; o.rotDeg[1] = idleRot[1]; o.rotDeg[2] = idleRot[2]
        if (this.t >= c.recoverMs) this.go('idle')
        break
      }
      case 'cancel': {
        const k = smooth(this.t / CANCEL_MS)
        lerp3(this.from, c.idlePos, k, o.pos); lerp3(this.fromRot, idleRot, k, o.rotDeg)
        if (this.t >= CANCEL_MS) this.go('idle')
        break
      }
    }
    // Motion finished: accept the logic phase that arrived while busy (e.g. pressed again while a new grenade is being brought up)
    if (this.phase === 'idle' && this.pending) {
      const p = this.pending; this.pending = null
      this.setLogic(p.phase, this.mode, p.pull, this.hasMore)
    }
    return o
  }
}
