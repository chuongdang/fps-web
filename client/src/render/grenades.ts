import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DT, GRENADE, TICK_RATE, fuseMsOf, stepGrenade, type GrenadeEvent, type GrenadeState, type GrenadeSpawnMsg, type GrenadeExplodeMsg, type TeamId, type ThrowMode, type Vec3 } from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'
import { tintSmoke } from './nadeTint'

// Client-side grenades (plan 12, G.4). grenadePhysics is deterministic and grenades do not hit people, so the client simulates every grenade ITSELF from
// GrenadeSpawn (the server does not send positions in snapshots). Others' grenades: fast-forwarded from spawnTick to render time (delayed like other players).
// Own grenades: created immediately on the throw prediction, get an id when the GrenadeSpawn with the same throwSeq arrives (off by <0.2 m: kept; off by more: blended over).
// GrenadeExplode is the source of truth. Rendering + simulation only, no game-rule logic.
const TICK_MS = 1000 / TICK_RATE
const MODEL = '/models/grenades/m67.glb'
const SNAP_DIST = 0.2           // if the predicted and server grenades differ by more than this, switch to the server trajectory
const SMOOTH_S = 0.2            // time to blend out the offset
const CONFIRM_TIMEOUT_MS = 500  // remove the predicted grenade if the server does not confirm it (+ RTT)
const MAX_STEPS_PER_FRAME = 400 // fast-forward late-arriving grenades
const SAFETY_EXTRA_S = 2        // remove if fuse + this much has passed with no GrenadeExplode
const SPIN_PER_MS = 1.4         // rad/s of spin per m/s while flying
const SPOON_LIFE_S = 5
const SPOON_PHYS: Pick<GrenadeState, 'team' | 'ownerId' | 'spawnTick'> = { team: 'A', ownerId: -1, spawnTick: 0 }

export interface GrenadeView { id: number; ownerId: number; kind: string; pos: THREE.Vector3; resting: boolean; predicted: boolean }

interface Sim {
  g: GrenadeState
  kind: string               // weapon key: 'm67' | 'smoke'
  prev: Vec3
  init: Vec3                 // position at creation (compared with the server on confirmation)
  stepped: number
  elapsed: number            // seconds since leaving the hand on this grenade's clock
  predicted: boolean
  confirmed: boolean
  throwSeq: number
  createdMs: number
  spawnServerMs: number      // other players' grenade: server timestamp at release
  pivot: THREE.Group
  quat: THREE.Quaternion
  offset: THREE.Vector3      // display offset being blended toward 0
  view: GrenadeView
}

interface Spoon { g: GrenadeState; prev: Vec3; pivot: THREE.Group; age: number; acc: number; spin: THREE.Vector3 }

export interface GrenadeDeps {
  world(): CollisionWorld | null
  /** Offline (no server): explodes by itself when the fuse runs out */
  localFuse(): boolean
  onBounce?(pos: Vec3, speed: number): void
  onExplode?(pos: Vec3, hits: { id: number; damage: number }[], kind: string, id: number): void
  onRelease?(pos: Vec3, own: boolean): void   // grenade leaves the hand (spoon sound)
  /** Others: delay (ms) until the grenade leaves the hand in their throw animation; the real grenade appears in sync with it (G.6) */
  releaseDelayMs?(ownerId: number, mode: ThrowMode): number
}

const _v = new THREE.Vector3(), _axis = new THREE.Vector3(), _dq = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0)

export function createGrenades(scene: THREE.Scene, deps: GrenadeDeps) {
  const sims: Sim[] = []
  const spoons: Spoon[] = []
  const later: { atMs: number; pos: Vec3; vel: Vec3 }[] = []   // spoon + release sound of other players' grenades (wait until their hand lets go)
  let bodyTpl: THREE.Object3D | null = null
  let spoonTpl: THREE.Object3D | null = null
  let loadFailed = false

  new GLTFLoader().loadAsync(MODEL).then(gltf => {
    bodyTpl = gltf.scene.getObjectByName('body') ?? null
    spoonTpl = gltf.scene.getObjectByName('spoon') ?? null
    for (const o of [bodyTpl, spoonTpl]) o?.traverse(m => { if (m instanceof THREE.Mesh) { m.castShadow = false; m.receiveShadow = false } })
    if (!bodyTpl) { loadFailed = true; console.warn('grenades: m67.glb is missing the body node, using a sphere') }
  }).catch(err => { loadFailed = true; console.warn('grenades: failed to load m67.glb, using a sphere', err) })

  const fallbackGeo = new THREE.SphereGeometry(GRENADE.radius * 0.65, 10, 8)
  const fallbackMat = new THREE.MeshLambertMaterial({ color: 0x3f5a2a })

  const smokeFallbackMat = new THREE.MeshLambertMaterial({ color: 0x9aa4ac })
  function makeBody(kind: string): THREE.Group {
    const pivot = new THREE.Group()
    const smoke = kind === 'smoke'
    if (bodyTpl) {
      const b = bodyTpl.clone(true); b.position.set(0, 0, 0); b.quaternion.identity()
      if (smoke) tintSmoke(b)   // shares the M67 model, tinted grey-green to tell it apart from HE
      pivot.add(b)
    } else if (loadFailed) pivot.add(new THREE.Mesh(fallbackGeo, smoke ? smokeFallbackMat : fallbackMat))
    return pivot
  }

  function addSim(g: GrenadeState, kind: string, predicted: boolean, throwSeq: number, spawnServerMs: number): Sim {
    const pivot = makeBody(kind)
    pivot.position.set(g.pos[0], g.pos[1], g.pos[2])
    scene.add(pivot)
    const s: Sim = {
      g, kind, prev: [g.pos[0], g.pos[1], g.pos[2]], init: [g.pos[0], g.pos[1], g.pos[2]], stepped: 0, elapsed: 0,
      predicted, confirmed: !predicted, throwSeq, createdMs: performance.now(), spawnServerMs,
      pivot, quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6)),
      offset: new THREE.Vector3(),
      view: { id: g.id, ownerId: g.ownerId, kind, pos: new THREE.Vector3(), resting: false, predicted },
    }
    sims.push(s)
    return s
  }

  function spawnSpoon(pos: Vec3, vel: Vec3): void {
    if (!spoonTpl) return
    const pivot = new THREE.Group()
    const mesh = spoonTpl.clone(true); mesh.position.set(0, 0, 0); mesh.quaternion.identity()
    pivot.add(mesh)
    pivot.position.set(pos[0], pos[1], pos[2])
    scene.add(pivot)
    // flies diagonally up and back relative to the throw direction, with a bit of randomness
    const sp = Math.hypot(vel[0], vel[1], vel[2]) || 1
    const back = [-vel[0] / sp, -vel[1] / sp, -vel[2] / sp]
    const v: Vec3 = [
      vel[0] * 0.2 + back[0]! * 1.2 + (Math.random() - 0.5) * 1.2,
      vel[1] * 0.2 + 2.2 + Math.random(),
      vel[2] * 0.2 + back[2]! * 1.2 + (Math.random() - 0.5) * 1.2,
    ]
    spoons.push({
      g: { ...SPOON_PHYS, id: -1, pos: [pos[0], pos[1], pos[2]], vel: v, resting: false },
      prev: [pos[0], pos[1], pos[2]], pivot, age: 0, acc: 0,
      spin: new THREE.Vector3((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18),
    })
  }

  function removeSim(i: number): void {
    scene.remove(sims[i]!.pivot)
    sims[i] = sims[sims.length - 1]!; sims.pop()
  }

  function explodeSim(i: number, pos: Vec3, hits: { id: number; damage: number }[]): void {
    const { kind, g } = sims[i]!
    removeSim(i)
    deps.onExplode?.(pos, hits, kind, g.id)
  }

  function advance(s: Sim, world: CollisionWorld | null, target: number): void {
    if (!world) return
    let n = 0
    while ((s.stepped + 1) * DT <= target && n < MAX_STEPS_PER_FRAME) {
      s.prev[0] = s.g.pos[0]; s.prev[1] = s.g.pos[1]; s.prev[2] = s.g.pos[2]
      const ev: GrenadeEvent | null = stepGrenade(s.g, world, DT)
      s.stepped++; n++
      if (ev && ev.type === 'bounce' && target - s.stepped * DT < 0.1) deps.onBounce?.(s.g.pos, ev.speed)   // no bounce sound when fast-forwarding an old grenade
    }
  }

  return {
    /** On throw prediction: create your own grenade immediately (no id yet; the server confirms via throwSeq) */
    spawnLocal(throwSeq: number, ownerId: number, team: TeamId, pos: Vec3, vel: Vec3, _mode: ThrowMode, kind: string = GRENADE.key): void {
      const g: GrenadeState = { id: -throwSeq, ownerId, team, pos: [pos[0], pos[1], pos[2]], vel: [vel[0], vel[1], vel[2]], spawnTick: 0, resting: false }
      addSim(g, kind, true, throwSeq, 0)
      spawnSpoon(pos, vel)
      deps.onRelease?.(pos, true)
    },

    /** GrenadeSpawn from the server. tickOriginMs = serverTime of tick 0 (derived from a snapshot: serverTime − tick·TICK_MS). */
    onSpawn(msg: GrenadeSpawnMsg, tickOriginMs: number, myId: number, team: TeamId): void {
      if (msg.ownerId === myId) {
        const s = sims.find(x => x.predicted && !x.confirmed && x.throwSeq === msg.throwSeq)
        if (s) {
          s.confirmed = true; s.g.id = msg.id; s.view.id = msg.id
          const d = Math.hypot(s.init[0] - msg.pos[0], s.init[1] - msg.pos[1], s.init[2] - msg.pos[2])
          if (d >= SNAP_DIST) {
            // large offset: rebuild from the server state, fast-forward the exact number of steps already run, blend out the offset over SMOOTH_S
            const world = deps.world()
            const ng: GrenadeState = { id: msg.id, ownerId: msg.ownerId, team, pos: [msg.pos[0], msg.pos[1], msg.pos[2]], vel: [msg.vel[0], msg.vel[1], msg.vel[2]], spawnTick: msg.spawnTick, resting: false }
            if (world) for (let i = 0; i < s.stepped; i++) stepGrenade(ng, world, DT)
            s.offset.set(s.g.pos[0] - ng.pos[0], s.g.pos[1] - ng.pos[1], s.g.pos[2] - ng.pos[2]).add(s.offset)
            s.g = ng
            s.prev[0] = ng.pos[0]; s.prev[1] = ng.pos[1]; s.prev[2] = ng.pos[2]
          }
          return
        }
      }
      const g: GrenadeState = { id: msg.id, ownerId: msg.ownerId, team, pos: [msg.pos[0], msg.pos[1], msg.pos[2]], vel: [msg.vel[0], msg.vel[1], msg.vel[2]], spawnTick: msg.spawnTick, resting: false }
      const delay = deps.releaseDelayMs?.(msg.ownerId, msg.mode) ?? 0   // wait for the thrower's hand to let go at the right moment in the animation
      addSim(g, msg.kind ?? GRENADE.key, false, msg.throwSeq, tickOriginMs + msg.spawnTick * TICK_MS + delay)
      if (delay > 0) later.push({ atMs: performance.now() + delay, pos: [msg.pos[0], msg.pos[1], msg.pos[2]], vel: [msg.vel[0], msg.vel[1], msg.vel[2]] })
      else { spawnSpoon(msg.pos, msg.vel); deps.onRelease?.(msg.pos, false) }
    },

    /** GrenadeExplode: explodes where the server says, removes the local grenade even if local time has not reached it yet */
    onExplode(msg: GrenadeExplodeMsg): void {
      const i = sims.findIndex(s => s.g.id === msg.id)
      if (i >= 0) explodeSim(i, msg.pos, msg.hits)
      else deps.onExplode?.(msg.pos, msg.hits, msg.kind ?? GRENADE.key, msg.id)
    },

    /** Every frame. renderServerMs = server time being rendered (delayed like other players); rttMs sets the confirmation deadline for predicted grenades */
    update(dt: number, renderServerMs: number, rttMs: number): void {
      const world = deps.world()
      const nowMs = performance.now()
      for (let i = sims.length - 1; i >= 0; i--) {
        const s = sims[i]!
        if (s.predicted) {
          if (!s.confirmed && !deps.localFuse() && nowMs - s.createdMs > CONFIRM_TIMEOUT_MS + rttMs) { removeSim(i); continue }   // rejected (offline there is no server, so no confirmation is awaited)
          s.elapsed += dt
        } else s.elapsed = Math.max(0, (renderServerMs - s.spawnServerMs) / 1000)
        advance(s, world, s.elapsed)
        const fuseS = fuseMsOf(s.kind) / 1000
        if (deps.localFuse() && s.elapsed >= fuseS) { explodeSim(i, [s.g.pos[0], s.g.pos[1], s.g.pos[2]], []); continue }
        if (s.elapsed > fuseS + SAFETY_EXTRA_S) { removeSim(i); continue }
        s.pivot.visible = s.predicted || s.elapsed > 0   // other players' grenade has not reached its release time: not drawn yet
        // display: interpolate between two steps + blend out the offset
        const a = Math.min(1, Math.max(0, (s.elapsed - s.stepped * DT) / DT))
        s.offset.multiplyScalar(Math.exp(-dt / (SMOOTH_S / 3)))
        s.pivot.position.set(
          s.prev[0] + (s.g.pos[0] - s.prev[0]) * a + s.offset.x,
          s.prev[1] + (s.g.pos[1] - s.prev[1]) * a + s.offset.y,
          s.prev[2] + (s.g.pos[2] - s.prev[2]) * a + s.offset.z,
        )
        // rotation: in flight = tumbling about the axis perpendicular to velocity, ω ∝ speed; rolling on the floor ω = v / radius; at rest = still
        if (!s.g.resting) {
          const sp = Math.hypot(s.g.vel[0], s.g.vel[1], s.g.vel[2])
          if (sp > 0.05) {
            _v.set(s.g.vel[0], s.g.vel[1], s.g.vel[2])
            _axis.crossVectors(_v, _up)
            if (_axis.lengthSq() < 1e-6) _axis.set(1, 0, 0)
            _axis.normalize()
            const rolling = Math.abs(s.g.vel[1]) < 0.5 && s.g.pos[1] < GRENADE.radius * 2.5
            const omega = rolling ? Math.hypot(s.g.vel[0], s.g.vel[2]) / GRENADE.radius : sp * SPIN_PER_MS
            s.quat.premultiply(_dq.setFromAxisAngle(_axis, omega * dt))
            s.pivot.quaternion.copy(s.quat)
          }
        }
        s.view.pos.copy(s.pivot.position); s.view.resting = s.g.resting
      }
      for (let i = later.length - 1; i >= 0; i--) {
        const l = later[i]!
        if (nowMs < l.atMs) continue
        spawnSpoon(l.pos, l.vel); deps.onRelease?.(l.pos, false)
        later[i] = later[later.length - 1]!; later.pop()
      }
      // spoon flies off: physics like a small grenade, disappears after 5 seconds
      for (let i = spoons.length - 1; i >= 0; i--) {
        const p = spoons[i]!
        p.age += dt
        if (p.age > SPOON_LIFE_S) { scene.remove(p.pivot); spoons[i] = spoons[spoons.length - 1]!; spoons.pop(); continue }
        p.acc += dt
        while (p.acc >= DT) {
          p.acc -= DT
          p.prev[0] = p.g.pos[0]; p.prev[1] = p.g.pos[1]; p.prev[2] = p.g.pos[2]
          if (world) stepGrenade(p.g, world, DT)
        }
        const a = p.acc / DT
        p.pivot.position.set(p.prev[0] + (p.g.pos[0] - p.prev[0]) * a, p.prev[1] + (p.g.pos[1] - p.prev[1]) * a, p.prev[2] + (p.g.pos[2] - p.prev[2]) * a)
        if (!p.g.resting) {
          p.pivot.rotateX(p.spin.x * dt); p.pivot.rotateY(p.spin.y * dt); p.pivot.rotateZ(p.spin.z * dt)
        }
      }
    },

    /** Current grenades (proximity warning, G.9). Positions are interpolated */
    list(): GrenadeView[] { return sims.map(s => s.view) },

    clear(): void {
      for (const s of sims) scene.remove(s.pivot)
      for (const p of spoons) scene.remove(p.pivot)
      sims.length = 0; spoons.length = 0; later.length = 0
    },
  }
}

export type Grenades = ReturnType<typeof createGrenades>
