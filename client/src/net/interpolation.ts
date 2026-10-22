import { INTERP_DELAY_MS, lerp, lerpAngle, type NetPlayer } from '@fps/shared'

const BUFFER_MS = 1000       // keep ~1 second of snapshots per player
const STALE_MS = 250         // past this with no new snapshot, treat the player as standing still (no extrapolation)

interface Entry {
  serverTime: number
  pos: [number, number, number]
  yaw: number
  pitch: number
  flags: number
  weapon: number
  killStreak: number
  adsT: number
  hp: number
  hpMax: number
  ztype?: string
  zscale?: number
  downLeft?: number
  reviveP?: number
}

// Interpolated state, reused every frame (no allocation)
export interface InterpPlayer {
  id: number
  pos: [number, number, number]
  yaw: number
  pitch: number
  flags: number
  weapon: number
  killStreak: number
  adsT: number   // aim level 0..1 (draws the gun up to the cheek)
  hp: number
  hpMax: number          // zombie: max HP (overhead health bar); human: 0
  ztype?: string         // zombie: type → tint/size/name
  zscale?: number
  downLeft?: number      // Defense: downed player, ms remaining
  reviveP?: number       // revive progress 0..1
  stale: boolean   // last snapshot is older than STALE_MS relative to renderTime
}

// Phase 4 uses this when shooting: the server time the player is "seeing" in this frame
export const interp = { currentRenderTime: 0, delayMs: INTERP_DELAY_MS }

const MAX_ONE_WAY_MS = 250
const DELAY_SLEW_MS_PER_FRAME = 1

// serverNow estimates the server's real time, while snapshots arrive late by the one-way delay. Only lagging by a fixed
// INTERP_DELAY_MS would leave no snapshot "b" to interpolate to at high ping, so also lag by exactly
// the one-way delay. Change the delay slowly (≤1ms/frame) so other players don't slide or jump.
export class InterpDelay {
  private _value = INTERP_DELAY_MS
  private started = false

  get value(): number { return this._value }

  // Call every frame with the estimated one-way delay (ms)
  update(oneWayMs: number): number {
    const target = INTERP_DELAY_MS + Math.min(Math.max(oneWayMs, 0), MAX_ONE_WAY_MS)
    if (!this.started) { this._value = target; this.started = oneWayMs > 0 }
    else if (target > this._value) this._value = Math.min(target, this._value + DELAY_SLEW_MS_PER_FRAME)
    else this._value = Math.max(target, this._value - DELAY_SLEW_MS_PER_FRAME)
    return this._value
  }
}

export class Interpolator {
  private buffers = new Map<number, Entry[]>()
  private out = new Map<number, InterpPlayer>()
  private list: InterpPlayer[] = []

  // On snapshot: add to each player's buffer (except selfId), remove players no longer in the snapshot
  push(serverTime: number, players: NetPlayer[], selfId = -1): void {
    const seen = new Set<number>()
    for (const p of players) {
      if (p.id === selfId) continue
      seen.add(p.id)
      let buf = this.buffers.get(p.id)
      if (!buf) { buf = []; this.buffers.set(p.id, buf) }
      const last = buf[buf.length - 1]
      if (last && serverTime <= last.serverTime) continue
      buf.push({ serverTime, pos: [p.pos[0], p.pos[1], p.pos[2]], yaw: p.yaw, pitch: p.pitch, flags: p.flags, weapon: p.weapon, killStreak: p.killStreak ?? 0, adsT: p.adsT ?? 0, hp: p.hp, hpMax: p.hpMax ?? 0, ztype: p.ztype, zscale: p.zscale, downLeft: p.downLeft, reviveP: p.reviveP })
      while (buf.length > 2 && buf[0]!.serverTime < serverTime - BUFFER_MS) buf.shift()
    }
    for (const id of this.buffers.keys()) {
      if (!seen.has(id)) { this.buffers.delete(id); this.out.delete(id) }
    }
  }

  // Call every frame with the current serverNow(); returns a reused list (valid until the next call)
  sample(serverNow: number, delayMs = INTERP_DELAY_MS): InterpPlayer[] {
    const renderTime = serverNow - delayMs
    interp.currentRenderTime = renderTime
    interp.delayMs = delayMs
    this.list.length = 0
    for (const [id, buf] of this.buffers) {
      let o = this.out.get(id)
      if (!o) { o = { id, pos: [0, 0, 0], yaw: 0, pitch: 0, flags: 0, weapon: 0, killStreak: 0, adsT: 0, hp: 0, hpMax: 0, stale: false }; this.out.set(id, o) }
      this.fill(o, buf, renderTime)
      this.list.push(o)
    }
    return this.list
  }

  private fill(o: InterpPlayer, buf: Entry[], renderTime: number): void {
    const first = buf[0]!
    const last = buf[buf.length - 1]!
    if (renderTime >= last.serverTime) {
      // Snapshot arrived late: hold the last one, no extrapolation
      this.copy(o, last)
      o.stale = renderTime - last.serverTime > STALE_MS
      return
    }
    o.stale = false
    if (renderTime <= first.serverTime) { this.copy(o, first); return }
    // a.serverTime ≤ renderTime < b.serverTime
    let i = buf.length - 2
    while (i > 0 && buf[i]!.serverTime > renderTime) i--
    const a = buf[i]!
    const b = buf[i + 1]!
    const t = (renderTime - a.serverTime) / (b.serverTime - a.serverTime)
    o.pos[0] = lerp(a.pos[0], b.pos[0], t)
    o.pos[1] = lerp(a.pos[1], b.pos[1], t)
    o.pos[2] = lerp(a.pos[2], b.pos[2], t)
    o.yaw = lerpAngle(a.yaw, b.yaw, t)
    o.pitch = lerp(a.pitch, b.pitch, t)
    o.flags = a.flags   // crouch/slide flags: taken from a
    o.weapon = a.weapon
    o.killStreak = a.killStreak
    o.adsT = lerp(a.adsT, b.adsT, t)
    o.hp = a.hp; o.hpMax = a.hpMax; o.ztype = a.ztype; o.zscale = a.zscale; o.downLeft = a.downLeft; o.reviveP = a.reviveP
  }

  private copy(o: InterpPlayer, e: Entry): void {
    o.pos[0] = e.pos[0]; o.pos[1] = e.pos[1]; o.pos[2] = e.pos[2]
    o.yaw = e.yaw; o.pitch = e.pitch; o.flags = e.flags; o.weapon = e.weapon; o.killStreak = e.killStreak; o.adsT = e.adsT
    o.hp = e.hp; o.hpMax = e.hpMax; o.ztype = e.ztype; o.zscale = e.zscale; o.downLeft = e.downLeft; o.reviveP = e.reviveP
  }
}
