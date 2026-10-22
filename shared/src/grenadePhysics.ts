import type { CollisionWorld } from './physics/world'
import type { PlayerState } from './movement'
import { defaultMovement, type MovementConfig } from './movement'
import { forwardFromYaw, rightFromYaw, type Vec3 } from './math'
import { shootDir } from './hitbox'
import { GRENADE, type ThrowMode } from './grenade'
import type { TeamId } from './teams'

// Grenade physics (plan 12, G.2): pure, deterministic, collides only with map colliders (not players).
// The client re-simulates every grenade from GrenadeSpawn, so server and client must run the exact same function with the same dt.
export interface GrenadeState {
  id: number
  ownerId: number
  team: TeamId
  pos: Vec3
  vel: Vec3
  spawnTick: number        // server tick when it left the hand
  resting: boolean
}

export interface GrenadeEvent { type: 'bounce'; speed: number }

const MAX_ITER = 3            // number of collisions handled in one tick
const SKIN = 0.001            // back off 1mm along the normal after a collision so it does not get stuck in the collider
const EPS = 1e-9
const FLOOR_NORMAL_Y = 0.7    // normal y above this = floor (walkable)

const _fwd: Vec3 = [0, 0, 0]
const _right: Vec3 = [0, 0, 0]
const _dir: Vec3 = [0, 0, 0]   // stepGrenade runs every tick for every grenade: reuse instead of allocating

/** Start point + initial velocity when throwing. Starts offset to the right hand / in front of the eye; if a wall is in the way it starts right at the eye. */
export function throwInitial(
  owner: Pick<PlayerState, 'pos' | 'vel' | 'yaw' | 'pitch' | 'crouching'>,
  mode: ThrowMode,
  world: CollisionWorld,
  cfg: MovementConfig = defaultMovement,
): { pos: Vec3; vel: Vec3 } {
  const eyeY = owner.pos[1] + (owner.crouching ? cfg.eyeCrouch : cfg.eyeStand)
  const eye: Vec3 = [owner.pos[0], eyeY, owner.pos[2]]
  forwardFromYaw(owner.yaw, _fwd); rightFromYaw(owner.yaw, _right)
  const start: Vec3 = [
    eye[0] + _right[0] * 0.15 + _fwd[0] * 0.3,
    eye[1] - 0.05,
    eye[2] + _right[2] * 0.15 + _fwd[2] * 0.3,
  ]
  // ray from the eye to the start point: if it hits a wall, do not let the grenade pass through the wall when standing against it
  const dx = start[0] - eye[0], dy = start[1] - eye[1], dz = start[2] - eye[2]
  const len = Math.hypot(dx, dy, dz)
  const hit = world.castRay(eye, [dx / len, dy / len, dz / len], len)
  const pos: Vec3 = hit ? [eye[0], eye[1], eye[2]] : start
  const dir = shootDir(owner.yaw, owner.pitch + GRENADE.throwUpDeg[mode] * Math.PI / 180)
  const sp = GRENADE.throwSpeed[mode], inh = GRENADE.inheritVelocity
  return { pos, vel: [dir[0] * sp + owner.vel[0] * inh, dir[1] * sp + owner.vel[1] * inh, dir[2] * sp + owner.vel[2] * inh] }
}

/**
 * One physics tick. Returns a 'bounce' event (normal-direction impact speed, the strongest in the tick) or null.
 * Uses castSphere along the tick's path (continuous): a small, fast grenade does not tunnel through walls.
 */
export function stepGrenade(g: GrenadeState, world: CollisionWorld, dt: number): GrenadeEvent | null {
  if (g.resting) return null
  const pos = g.pos, vel = g.vel
  vel[1] -= GRENADE.gravity * dt
  let remaining = dt
  let strongest = 0
  let onFloor = false
  let iter = 0
  while (remaining > 1e-7 && iter < MAX_ITER) {
    const speed = Math.hypot(vel[0], vel[1], vel[2])
    const move = speed * remaining
    if (move < EPS) break
    const inv = 1 / speed
    const dir = _dir; dir[0] = vel[0] * inv; dir[1] = vel[1] * inv; dir[2] = vel[2] * inv
    const hit = world.castSphere(pos, dir, move, GRENADE.radius)
    if (!hit) {
      pos[0] += vel[0] * remaining; pos[1] += vel[1] * remaining; pos[2] += vel[2] * remaining
      remaining = 0
      break
    }
    const n = hit.normal
    const d = Math.min(hit.dist, move)
    pos[0] += dir[0] * d + n[0] * SKIN; pos[1] += dir[1] * d + n[1] * SKIN; pos[2] += dir[2] * d + n[2] * SKIN
    remaining *= 1 - d / move
    const vn = vel[0] * n[0] + vel[1] * n[1] + vel[2] * n[2]   // < 0: moving into the surface
    if (vn < 0) {
      const into = -vn
      const floor = n[1] > FLOOR_NORMAL_Y
      const tx = vel[0] - n[0] * vn, ty = vel[1] - n[1] * vn, tz = vel[2] - n[2] * vn
      if (floor && into <= GRENADE.bounceMinSpeed) {
        // slow floor contact = rolling: no bounce, keep tangential velocity (rolling friction below)
        vel[0] = tx; vel[1] = ty; vel[2] = tz
        onFloor = true
      } else {
        const k = 1 - GRENADE.friction
        vel[0] = -vn * n[0] * GRENADE.restitution + tx * k
        vel[1] = -vn * n[1] * GRENADE.restitution + ty * k
        vel[2] = -vn * n[2] * GRENADE.restitution + tz * k
        if (into > GRENADE.bounceMinSpeed && into > strongest) strongest = into
        if (floor) onFloor = true
      }
    }
    iter++
  }
  if (remaining > 1e-7 && iter >= MAX_ITER) { vel[0] = 0; vel[1] = 0; vel[2] = 0 }   // jittering stuck in a corner: stay still this tick
  if (onFloor) {
    // rolling on the floor: reduce tangential speed; slow enough → comes to rest
    const hs = Math.hypot(vel[0], vel[2])
    const ns = Math.max(0, hs - GRENADE.rollDrag * dt)
    if (hs > EPS) { const k = ns / hs; vel[0] *= k; vel[2] *= k }
    if (Math.hypot(vel[0], vel[1], vel[2]) < GRENADE.restSpeed) { g.resting = true; vel[0] = 0; vel[1] = 0; vel[2] = 0 }
  }
  return strongest > 0 ? { type: 'bounce', speed: strongest } : null
}
