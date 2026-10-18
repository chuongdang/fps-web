import RAPIER from '@dimforge/rapier3d-compat'
import type { LoadedMap } from '../map/types'

// Quaternion rotating local X-axis to align with unit direction (dx, dy, dz)
function dirToQuatX(dx: number, dy: number, dz: number) {
  const sinTheta = Math.sqrt(dy * dy + dz * dz)
  const cosTheta = dx
  if (sinTheta < 1e-9) {
    return cosTheta > 0
      ? { x: 0, y: 0, z: 0, w: 1 }   // identity
      : { x: 0, y: 1, z: 0, w: 0 }   // 180° around Y
  }
  const half = Math.atan2(sinTheta, cosTheta) / 2
  const f = Math.sin(half) / sinTheta
  return { x: 0, y: -dz * f, z: dy * f, w: Math.cos(half) }
}

export async function createWorld(map: LoadedMap): Promise<RAPIER.World> {
  await RAPIER.init()
  const world = new RAPIER.World({ x: 0, y: -20, z: 0 })

  for (const box of map.boxes) {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(box.pos[0], box.pos[1], box.pos[2]),
    )
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(box.size[0] / 2, box.size[1] / 2, box.size[2] / 2),
      body,
    )
  }

  for (const ramp of map.ramps) {
    const cx = (ramp.from[0] + ramp.to[0]) / 2
    const cy = (ramp.from[1] + ramp.to[1]) / 2
    const cz = (ramp.from[2] + ramp.to[2]) / 2
    const dx = ramp.to[0] - ramp.from[0]
    const dy = ramp.to[1] - ramp.from[1]
    const dz = ramp.to[2] - ramp.from[2]
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
    const q = dirToQuatX(dx / len, dy / len, dz / len)
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(cx, cy, cz),
    )
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(len / 2, 0.15, ramp.width / 2).setRotation(q),
      body,
    )
  }

  return world
}
