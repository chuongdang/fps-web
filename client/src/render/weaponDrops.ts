import * as THREE from 'three'
import { DT, TICK_RATE, WEAPON_DROP, dropDistSq, inPickupReach, stepGrenade, type GrenadeState, type Vec3, type WeaponDropRemoveMsg, type WeaponDropSpawnMsg } from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'

// Guns lying in the world (shared/weaponDrop.ts). Like grenades, the client simulates the flight itself from WeaponDropSpawn with the deterministic
// grenade physics, so the server does not stream positions. The server decides who can pick a gun up; this file only draws and finds the nearest one for the HUD prompt.
const MAX_STEPS_PER_FRAME = 400   // fast-forward late-arriving guns
const SPIN_PER_MS = 0.9           // rad/s of tumbling per m/s while flying
const SETTLE_RATE = 12            // 1/s: how fast a gun that stopped rolls into its lying pose
const _up = new THREE.Vector3(0, 1, 0)
const _v = new THREE.Vector3(), _axis = new THREE.Vector3(), _dq = new THREE.Quaternion(), _qYaw = new THREE.Quaternion(), _qFlat = new THREE.Quaternion(0, 0, Math.SQRT1_2, Math.SQRT1_2)   // 90° about the barrel axis: lies on its side

export interface DropView { id: number; weapon: number; ammo: number }

interface Sim {
  g: GrenadeState
  view: DropView
  prev: Vec3
  stepped: number
  spawnServerMs: number   // server time of the tick the state was sent at
  own: boolean            // dropped by us: shown on our own clock instead of the delayed render time, so it appears the moment it leaves our hand
  pivot: THREE.Group
  quat: THREE.Quaternion
  rest: THREE.Quaternion
  lift: number            // half the gun's width: its side rests on the floor
  elapsed: number
}

export interface WeaponDropDeps {
  world(): CollisionWorld | null
  gunModel(id: number): THREE.Object3D | null
  onBounce?(pos: Vec3, speed: number): void
}

export function createWeaponDrops(scene: THREE.Scene, deps: WeaponDropDeps) {
  const sims: Sim[] = []
  const pending: { msg: WeaponDropSpawnMsg; tickOriginMs: number; myId: number }[] = []   // the gun model has not loaded yet
  const box = new THREE.Box3(), size = new THREE.Vector3(), center = new THREE.Vector3()

  function build(msg: WeaponDropSpawnMsg, tickOriginMs: number, myId: number): boolean {
    const tpl = deps.gunModel(msg.weapon)
    if (!tpl) return false
    const pivot = new THREE.Group()
    const inner = tpl.clone(true)
    box.setFromObject(inner); box.getSize(size); box.getCenter(center)
    const holder = new THREE.Group()   // re-centre the model so the pivot is the middle of the gun
    inner.position.sub(center)
    holder.add(inner)
    pivot.add(holder)
    pivot.position.set(msg.pos[0], msg.pos[1], msg.pos[2])
    scene.add(pivot)
    const rest = new THREE.Quaternion().multiplyQuaternions(_qYaw.setFromAxisAngle(_up, (msg.id * 2.399) % (Math.PI * 2)), _qFlat)
    const g: GrenadeState = { id: msg.id, ownerId: msg.ownerId, team: 'A', pos: [msg.pos[0], msg.pos[1], msg.pos[2]], vel: [msg.vel[0], msg.vel[1], msg.vel[2]], spawnTick: msg.spawnTick, resting: msg.resting }
    const s: Sim = {
      g, view: { id: msg.id, weapon: msg.weapon, ammo: msg.ammo }, prev: [msg.pos[0], msg.pos[1], msg.pos[2]], stepped: 0,
      spawnServerMs: tickOriginMs + msg.spawnTick * 1000 / TICK_RATE, own: msg.ownerId === myId,
      pivot, quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6)), rest,
      lift: Math.min(size.x, size.y, size.z) / 2, elapsed: 0,
    }
    if (msg.resting) { s.quat.copy(rest) }
    pivot.quaternion.copy(s.quat)
    sims.push(s)
    return true
  }

  function remove(i: number): void {
    scene.remove(sims[i]!.pivot)
    sims[i] = sims[sims.length - 1]!; sims.pop()
  }

  return {
    /** WeaponDropSpawn. tickOriginMs = serverTime of tick 0 (derived from a snapshot), same as grenades. */
    onSpawn(msg: WeaponDropSpawnMsg, tickOriginMs: number, myId: number): void {
      if (!build(msg, tickOriginMs, myId)) pending.push({ msg, tickOriginMs, myId })
    },

    /** WeaponDropRemove (picked up / expired / cleared). Returns the gun that was removed, if we knew it. */
    onRemove(msg: WeaponDropRemoveMsg): DropView | null {
      if (msg.id < 0) { this.clear(); return null }
      const j = pending.findIndex(p => p.msg.id === msg.id)
      if (j >= 0) pending.splice(j, 1)
      const i = sims.findIndex(s => s.g.id === msg.id)
      if (i < 0) return null
      const view = sims[i]!.view
      remove(i)
      return view
    },

    /** Every frame. renderServerMs = server time being rendered (delayed like other players); nowServerMs = our estimate of the server's current time (own drops). */
    update(dt: number, renderServerMs: number, nowServerMs: number): void {
      for (let i = pending.length - 1; i >= 0; i--) {
        const p = pending[i]!
        if (build(p.msg, p.tickOriginMs, p.myId)) pending.splice(i, 1)
      }
      const world = deps.world()
      for (let i = sims.length - 1; i >= 0; i--) {
        const s = sims[i]!
        s.elapsed = Math.max(0, ((s.own ? nowServerMs : renderServerMs) - s.spawnServerMs) / 1000)
        if (world) {
          let n = 0
          while (!s.g.resting && (s.stepped + 1) * DT <= s.elapsed && n < MAX_STEPS_PER_FRAME) {
            s.prev[0] = s.g.pos[0]; s.prev[1] = s.g.pos[1]; s.prev[2] = s.g.pos[2]
            const ev = stepGrenade(s.g, world, DT)
            s.stepped++; n++
            if (ev && s.elapsed - s.stepped * DT < 0.1) deps.onBounce?.(s.g.pos, ev.speed)   // no clink while fast-forwarding an old gun
          }
        }
        s.pivot.visible = s.elapsed > 0 || s.g.resting
        const a = s.g.resting ? 1 : Math.min(1, Math.max(0, (s.elapsed - s.stepped * DT) / DT))
        const px = s.prev[0] + (s.g.pos[0] - s.prev[0]) * a, py = s.prev[1] + (s.g.pos[1] - s.prev[1]) * a, pz = s.prev[2] + (s.g.pos[2] - s.prev[2]) * a
        if (s.g.resting) {
          s.quat.slerp(s.rest, 1 - Math.exp(-dt * SETTLE_RATE))
          s.pivot.position.set(px, py + s.lift, pz)
        } else {
          const sp = Math.hypot(s.g.vel[0], s.g.vel[1], s.g.vel[2])
          if (sp > 0.05) {
            _v.set(s.g.vel[0], s.g.vel[1], s.g.vel[2])
            _axis.crossVectors(_v, _up)
            if (_axis.lengthSq() < 1e-6) _axis.set(1, 0, 0)
            _axis.normalize()
            s.quat.premultiply(_dq.setFromAxisAngle(_axis, sp * SPIN_PER_MS * dt))
          }
          s.pivot.position.set(px, py, pz)
        }
        s.pivot.quaternion.copy(s.quat)
      }
    },

    /** The gun the player would pick up with E (nearest within reach), or null. `ownerLockMs` mirrors the server's rule for the dropper. */
    nearest(pos: Vec3, myId: number): DropView | null {
      let best: Sim | null = null, bestD = Infinity
      for (const s of sims) {
        if (s.elapsed <= 0 && !s.g.resting) continue
        if (s.g.ownerId === myId && s.elapsed * 1000 < WEAPON_DROP.ownerLockMs) continue
        if (!inPickupReach(pos, s.g.pos)) continue
        const d = dropDistSq(pos, s.g.pos)
        if (d < bestD) { bestD = d; best = s }
      }
      return best ? best.view : null
    },

    clear(): void {
      for (const s of sims) scene.remove(s.pivot)
      sims.length = 0; pending.length = 0
    },
  }
}

export type WeaponDrops = ReturnType<typeof createWeaponDrops>
