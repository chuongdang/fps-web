// Bot perception (plan 15, B.3): sight (FOV + raycast to head/chest), hearing (gunshots, footsteps), being shot, memory.
// The bot NEVER knows an enemy's position through walls, except via the hearing/hurt sources here (all with error).
import { MsgType, defaultMovement, type AnyMsg, type Vec3 } from '@fps/shared'
import type { Player, Room } from '../room'
import { rand, type BotParams } from './params'
import { smokeBlocks } from '../smoke'

const RAD = Math.PI / 180
const SIGHT_RANGE = 80
const FOOTSTEP_RANGE = 15
const FOOTSTEP_SPEED = 5.5
const HURT_ANGLE_ERR = 20 * RAD
const SUSPECT_ERR_M = 3
export const CHEST_Y = 1.0, HEAD_Y = 1.62   // CHEST_Y = aim point at mid-torso (a human aims at the middle of the body, not the upper chest)
const CROUCH_SCALE = defaultMovement.crouchHeight / defaultMovement.standHeight

export interface Known {
  id: number
  pos: Vec3                  // feet, last seen
  lastSeenMs: number
  visible: boolean           // seen during the most recent think
  headVisible: boolean
  chestVisible: boolean
  reactAtMs: number          // aiming/shooting is allowed only after this time (reaction time)
  stillSince: number         // when it started standing still (moved < STILL_RADIUS around the anchor)
  anchor: Vec3
  dist: number
}

export interface Suspicion { pos: Vec3; atMs: number }

const STILL_RADIUS = 1.2

export function eyeOf(p: Player, out: Vec3): Vec3 {
  out[0] = p.state.pos[0]; out[1] = p.state.pos[1] + (p.state.crouching ? defaultMovement.eyeCrouch : defaultMovement.eyeStand); out[2] = p.state.pos[2]
  return out
}

/** Chest / head point of player `p` (depending on crouching/standing) */
export function bodyPoint(p: Player, head: boolean, out: Vec3): Vec3 {
  const sc = p.state.crouching ? CROUCH_SCALE : 1
  out[0] = p.state.pos[0]; out[1] = p.state.pos[1] + (head ? HEAD_Y : CHEST_Y) * sc; out[2] = p.state.pos[2]
  return out
}

export class Perception {
  readonly known = new Map<number, Known>()
  suspicion: Suspicion | null = null
  hurtAtMs = -1e9
  hurtYaw = 0                // direction (yaw) the bot thinks the bullet came from
  readonly hurtTimes: number[] = []            // times it was hit (to tell whether it is losing the gunfight)
  readonly dealt = new Map<number, { dmg: number; atMs: number }>()   // damage dealt to each enemy (5s window)
  lastDealtMs = -1e9
  private readonly _eye: Vec3 = [0, 0, 0]
  private readonly _pt: Vec3 = [0, 0, 0]
  private readonly _dir: Vec3 = [0, 0, 0]

  constructor(private readonly me: Player, private readonly room: Room, private readonly rng: () => number, private readonly hearsSteps: boolean) {}

  reset(): void {
    this.known.clear(); this.suspicion = null; this.hurtAtMs = -1e9; this.hurtTimes.length = 0; this.dealt.clear()
  }

  /** Messages sent to the bot (the empty transport forwards them here) */
  onMessage(msg: AnyMsg, now: number, params: BotParams): void {
    const me = this.me
    switch (msg.t) {
      case MsgType.ShotFx: {
        const shooter = this.room.players.get(msg.shooterId)
        if (!shooter || shooter.team === me.team) return
        const d = Math.hypot(msg.origin[0] - me.state.pos[0], msg.origin[1] - me.state.pos[1], msg.origin[2] - me.state.pos[2])
        if (d > params.hearingRadius) return
        this.suspect(msg.origin[0], msg.origin[1] - 1.6, msg.origin[2], now)
        break
      }
      case MsgType.Hurt: {
        this.hurtAtMs = now
        this.hurtTimes.push(now)
        if (this.hurtTimes.length > 8) this.hurtTimes.shift()
        const dx = msg.origin[0] - me.state.pos[0], dz = msg.origin[2] - me.state.pos[2]
        // bullet direction ± 20°
        this.hurtYaw = Math.atan2(-dx, -dz) + (this.rng() * 2 - 1) * HURT_ANGLE_ERR
        const dist = Math.max(4, Math.hypot(dx, dz))
        this.suspect(me.state.pos[0] - Math.sin(this.hurtYaw) * dist, msg.origin[1] - 1.6, me.state.pos[2] - Math.cos(this.hurtYaw) * dist, now, true)
        break
      }
      case MsgType.HitConfirm: {
        const e = this.dealt.get(msg.targetId)
        if (e && now - e.atMs < 5000) { e.dmg += msg.damage; e.atMs = now } else this.dealt.set(msg.targetId, { dmg: msg.damage, atMs: now })
        this.lastDealtMs = now
        break
      }
      case MsgType.Kill:
        this.known.delete(msg.victimId)
        this.dealt.delete(msg.victimId)
        break
    }
  }

  private suspect(x: number, y: number, z: number, now: number, exact = false): void {
    const e = exact ? 0 : SUSPECT_ERR_M
    this.suspicion = { pos: [x + (this.rng() * 2 - 1) * e, y, z + (this.rng() * 2 - 1) * e], atMs: now }
  }

  /** Number of times hit within the last `windowMs` */
  hitsTaken(now: number, windowMs: number): number {
    let n = 0
    for (const t of this.hurtTimes) if (now - t <= windowMs) n++
    return n
  }

  dealtTo(id: number, now: number): number {
    const e = this.dealt.get(id)
    return e && now - e.atMs < 5000 ? e.dmg : 0
  }

  /** 10 times per second. lookYaw/lookPitch = the bot's current look direction. Uses ≤ 2 rays per enemy. */
  update(now: number, params: BotParams, lookYaw: number, lookPitch: number): void {
    const me = this.me, world = me.world
    if (!world) return
    const eye = eyeOf(me, this._eye)
    const cp = Math.cos(lookPitch)
    const fx = -Math.sin(lookYaw) * cp, fy = Math.sin(lookPitch), fz = -Math.cos(lookYaw) * cp
    const cosHalf = Math.cos(params.fovDeg * RAD / 2)
    for (const o of this.room.players.values()) {
      if (o.team === me.team || o === me) continue
      if (!o.alive) { this.known.delete(o.id); continue }
      let k = this.known.get(o.id)
      const ox = o.state.pos[0], oy = o.state.pos[1], oz = o.state.pos[2]
      const chest = bodyPoint(o, false, this._pt)
      const dx = chest[0] - eye[0], dy = chest[1] - eye[1], dz = chest[2] - eye[2]
      const dist = Math.hypot(dx, dy, dz)
      let chestVis = false, headVis = false
      if (dist <= SIGHT_RANGE && dist > 0.01 && (dx * fx + dy * fy + dz * fz) / dist >= cosHalf) {
        this._dir[0] = dx / dist; this._dir[1] = dy / dist; this._dir[2] = dz / dist
        const h = world.castRay(eye, this._dir, dist)
        chestVis = (!h || h.dist >= dist - 0.3) && !smokeBlocks(this.room, eye, chest)
        const head = bodyPoint(o, true, this._pt)
        const hx = head[0] - eye[0], hy = head[1] - eye[1], hz = head[2] - eye[2]
        const hd = Math.hypot(hx, hy, hz)
        this._dir[0] = hx / hd; this._dir[1] = hy / hd; this._dir[2] = hz / hd
        const h2 = world.castRay(eye, this._dir, hd)
        headVis = (!h2 || h2.dist >= hd - 0.3) && !smokeBlocks(this.room, eye, head)
      }
      const seen = chestVis || headVis
      if (seen) {
        if (!k) {
          k = { id: o.id, pos: [ox, oy, oz], lastSeenMs: now, visible: false, headVisible: false, chestVisible: false, reactAtMs: 0, stillSince: now, anchor: [ox, oy, oz], dist }
          this.known.set(o.id, k)
        }
        if (!k.visible && now - k.lastSeenMs > 1000) k.reactAtMs = now + rand(this.rng, params.reactionMs)   // first sighting / seen again after losing track
        else if (k.reactAtMs === 0) k.reactAtMs = now + rand(this.rng, params.reactionMs)
        k.visible = true; k.chestVisible = chestVis; k.headVisible = headVis
        k.lastSeenMs = now; k.pos[0] = ox; k.pos[1] = oy; k.pos[2] = oz; k.dist = dist
        if (Math.hypot(ox - k.anchor[0], oz - k.anchor[2]) > STILL_RADIUS) { k.anchor[0] = ox; k.anchor[1] = oy; k.anchor[2] = oz; k.stillSince = now }
      } else {
        if (k) {
          k.visible = false; k.chestVisible = false; k.headVisible = false
          if (now - k.lastSeenMs > params.memoryMs) this.known.delete(o.id)
        }
        // Running footsteps nearby (hard bots only): suspect an enemy around there
        if (this.hearsSteps && dist <= FOOTSTEP_RANGE && !o.state.crouching && o.state.grounded &&
            Math.hypot(o.state.vel[0], o.state.vel[2]) > FOOTSTEP_SPEED) this.suspect(ox, oy, oz, now)
      }
    }
    if (this.suspicion && now - this.suspicion.atMs > params.memoryMs) this.suspicion = null
  }
}
