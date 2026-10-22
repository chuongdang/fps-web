import RAPIER from '@dimforge/rapier3d-compat'
import type { LoadedMap } from '../map/types'

// Collision groups: encoding = (membership << 16) | filter
// An interaction is allowed if (memberA & filterB) != 0 && (memberB & filterA) != 0
const MAP_FILTER    = (0x0001 << 16) | 0xFFFF  // member=1, collides with all
const PLAYER_FILTER = (0x0002 << 16) | 0x0001  // member=2, collides with map only
const GRENADE_FILTER = (0x0004 << 16) | 0x0001 // member=4, collides only with the map (not players: see plan 12, G.2)

// The controller may leave the feet sunk ~1e-4 below the floor surface; unless the shape is lifted, canStand
// is always false (the floor cuts the capsule) and the player gets stuck crouching after releasing Ctrl.
const CANSTAND_EPS = 0.02

// Auto-step (a map with `stepHeight`): the free width needed on top of a ledge for the player to step onto it
const AUTOSTEP_MIN_WIDTH = 0.2

export interface CollisionWorld {
  moveCharacter(
    pos: [number, number, number],
    delta: [number, number, number],
    crouching: boolean,
  ): { pos: [number, number, number]; grounded: boolean; hitCeiling: boolean }
  canStand(pos: [number, number, number]): boolean
  /** Change the capsule height when crouching (zombies are shorter than humans, plan 16). Called every step; only rebuilds the collider when the value changes. Test mocks may ignore it. */
  setCrouchHeight?(h: number): void
  castRay(
    origin: [number, number, number],
    dir: [number, number, number],
    maxDist: number,
  ): { dist: number; normal: [number, number, number] } | null
  /**
   * Sweep a sphere of radius `radius` from `origin` along unit direction `dir` up to `maxDist` (continuous, small fast spheres do not tunnel through walls).
   * Collides only with map colliders. `normal` = surface normal, pointing out toward the sphere (opposite `dir`).
   * dist = 0 when already overlapping at the start.
   */
  castSphere(
    origin: [number, number, number],
    dir: [number, number, number],
    maxDist: number,
    radius: number,
  ): { dist: number; normal: [number, number, number] } | null
  debugRender(): { vertices: Float32Array; colors: Float32Array }
  dispose(): void   // free WASM memory; do not use the world after calling this
}

class PhysicsWorld implements CollisionWorld {
  private _w: RAPIER.World
  private _body: RAPIER.RigidBody
  private _col: RAPIER.Collider
  private _ctrl: RAPIER.KinematicCharacterController
  private _standHalf: number
  private _crouchHalf: number
  private _standOffset: number   // capsule center Y above foot for stand
  private _crouchOffset: number  // capsule center Y above foot for crouch
  private _radius: number
  private _standShape: RAPIER.Capsule
  private _crouching = false
  private _crouchH: number
  private _crouchDirty = false

  constructor(w: RAPIER.World, standH: number, crouchH: number, r: number, stepHeight = 0) {
    this._w      = w
    this._radius = r
    this._crouchH = crouchH
    this._standHalf  = (standH  - 2 * r) / 2
    this._crouchHalf = (crouchH - 2 * r) / 2
    this._standOffset  = r + this._standHalf
    this._crouchOffset = r + this._crouchHalf
    // Stand-check shape: drop CANSTAND_EPS at the bottom so touching the floor does not count as a collision
    this._standShape   = new RAPIER.Capsule(this._standHalf - CANSTAND_EPS / 2, r)

    this._body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased())
    this._col  = w.createCollider(
      RAPIER.ColliderDesc.capsule(this._standHalf, r).setCollisionGroups(PLAYER_FILTER),
      this._body,
    )

    this._ctrl = w.createCharacterController(0.02)
    this._ctrl.setMaxSlopeClimbAngle(50 * Math.PI / 180)
    this._ctrl.enableSnapToGround(0.3)
    if (stepHeight > 0) this._ctrl.enableAutostep(stepHeight, AUTOSTEP_MIN_WIDTH, false)
    else this._ctrl.disableAutostep()
  }

  setCrouchHeight(h: number): void {
    if (h === this._crouchH) return
    this._crouchH = h
    this._crouchHalf = (h - 2 * this._radius) / 2
    this._crouchOffset = this._radius + this._crouchHalf
    this._crouchDirty = true
  }

  moveCharacter(
    pos: [number, number, number],
    delta: [number, number, number],
    crouching: boolean,
  ): { pos: [number, number, number]; grounded: boolean; hitCeiling: boolean } {
    if (crouching !== this._crouching || (this._crouchDirty && crouching)) {
      this._crouchDirty = false
      this._w.removeCollider(this._col, false)
      const half = crouching ? this._crouchHalf : this._standHalf
      this._col = this._w.createCollider(
        RAPIER.ColliderDesc.capsule(half, this._radius).setCollisionGroups(PLAYER_FILTER),
        this._body,
      )
      this._crouching = crouching
    }

    const off = crouching ? this._crouchOffset : this._standOffset
    this._body.setNextKinematicTranslation({ x: pos[0], y: pos[1] + off, z: pos[2] })
    this._w.step()  // apply kinematic translation + update query pipeline

    this._ctrl.computeColliderMovement(
      this._col,
      { x: delta[0], y: delta[1], z: delta[2] },
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      PLAYER_FILTER,
    )

    const mv      = this._ctrl.computedMovement()
    const ground  = this._ctrl.computedGrounded()
    const ceiling = delta[1] > 0 && mv.y < delta[1] * 0.5

    return {
      pos: [pos[0] + mv.x, pos[1] + mv.y, pos[2] + mv.z],
      grounded: ground,
      hitCeiling: ceiling,
    }
  }

  canStand(pos: [number, number, number]): boolean {
    const cy  = pos[1] + this._standOffset + CANSTAND_EPS / 2
    const hit = this._w.intersectionWithShape(
      { x: pos[0], y: cy, z: pos[2] },
      { x: 0, y: 0, z: 0, w: 1 },
      this._standShape,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      PLAYER_FILTER,
      this._col,
    )
    return hit === null
  }

  castRay(
    origin: [number, number, number],
    dir: [number, number, number],
    maxDist: number,
  ): { dist: number; normal: [number, number, number] } | null {
    const ray = new RAPIER.Ray(
      { x: origin[0], y: origin[1], z: origin[2] },
      { x: dir[0],    y: dir[1],    z: dir[2] },
    )
    const hit = this._w.castRayAndGetNormal(
      ray, maxDist, false,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      PLAYER_FILTER,
      this._col,
    )
    if (!hit) return null
    return {
      dist:   hit.toi,
      normal: [hit.normal.x, hit.normal.y, hit.normal.z],
    }
  }

  private _balls = new Map<number, RAPIER.Ball>()
  private _qid = { x: 0, y: 0, z: 0, w: 1 }

  castSphere(
    origin: [number, number, number],
    dir: [number, number, number],
    maxDist: number,
    radius: number,
  ): { dist: number; normal: [number, number, number] } | null {
    let ball = this._balls.get(radius)
    if (!ball) { ball = new RAPIER.Ball(radius); this._balls.set(radius, ball) }
    const hit = this._w.castShape(
      { x: origin[0], y: origin[1], z: origin[2] }, this._qid,
      { x: dir[0], y: dir[1], z: dir[2] },
      ball, maxDist, true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      GRENADE_FILTER,
      this._col,
    )
    if (!hit) return null
    let nx = hit.normal2.x, ny = hit.normal2.y, nz = hit.normal2.z
    // normalise direction: the normal always opposes the movement direction (pointing out toward the sphere)
    if (nx * dir[0] + ny * dir[1] + nz * dir[2] > 0) { nx = -nx; ny = -ny; nz = -nz }
    return { dist: hit.toi, normal: [nx, ny, nz] }
  }

  debugRender(): { vertices: Float32Array; colors: Float32Array } {
    return this._w.debugRender()
  }

  dispose(): void {
    this._w.removeCharacterController(this._ctrl)
    this._w.free()
  }
}

// Quaternion rotating local X-axis to align with unit direction (dx, dy, dz)
function dirToQuatX(dx: number, dy: number, dz: number) {
  const sinTheta = Math.sqrt(dy * dy + dz * dz)
  const cosTheta = dx
  if (sinTheta < 1e-9) {
    return cosTheta > 0
      ? { x: 0, y: 0, z: 0, w: 1 }
      : { x: 0, y: 1, z: 0, w: 0 }
  }
  const half = Math.atan2(sinTheta, cosTheta) / 2
  const f    = Math.sin(half) / sinTheta
  return { x: 0, y: -dz * f, z: dy * f, w: Math.cos(half) }
}

export async function createWorld(
  map: LoadedMap,
  standHeight = 1.8,
  crouchHeight = 1.2,
  radius = 0.4,
): Promise<CollisionWorld> {
  await RAPIER.init()
  const world = new RAPIER.World({ x: 0, y: -20, z: 0 })

  for (const box of map.boxes) {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(box.pos[0], box.pos[1], box.pos[2]),
    )
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(box.size[0] / 2, box.size[1] / 2, box.size[2] / 2)
        .setCollisionGroups(MAP_FILTER),
      body,
    )
  }

  for (const ramp of map.ramps) {
    const cx  = (ramp.from[0] + ramp.to[0]) / 2
    const cy  = (ramp.from[1] + ramp.to[1]) / 2
    const cz  = (ramp.from[2] + ramp.to[2]) / 2
    const dx  = ramp.to[0] - ramp.from[0]
    const dy  = ramp.to[1] - ramp.from[1]
    const dz  = ramp.to[2] - ramp.from[2]
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
    const q   = dirToQuatX(dx / len, dy / len, dz / len)
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(cx, cy, cz),
    )
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(len / 2, 0.15, ramp.width / 2)
        .setRotation(q)
        .setCollisionGroups(MAP_FILTER),
      body,
    )
  }

  if (map.trimesh) {
    world.createCollider(
      RAPIER.ColliderDesc.trimesh(new Float32Array(map.trimesh.vertices), new Uint32Array(map.trimesh.indices))
        .setCollisionGroups(MAP_FILTER),
    )
  }

  // Refresh the query pipeline once: without it castRay/castShape before the first moveCharacter see no colliders (grenades use castSphere independently)
  world.step()
  return new PhysicsWorld(world, standHeight, crouchHeight, radius, map.stepHeight)
}
