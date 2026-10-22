import * as THREE from 'three'
import { SMOKE, hashSeed, mulberry32, smokeRadiusAt, type Vec3 } from '@fps/shared'

// Smoke cloud of the smoke grenade (like CS 1.6): many soft sprites packed in an expanding sphere, dissipating at the end. Render only; matches the server through the shared smokeRadiusAt.
// When the camera is inside the smoke the sprites cover the whole screen (no separate post-processing needed). Sprites do not write depth so they never occlude each other in the wrong order.
const PUFFS = 56
const TEX_SIZE = 128
const COLOR = 0xc4c8cc
const PEAK_OPACITY = 0.8
const FADE_IN_MS = 350       // sprites fade in as the cloud blooms so they do not "pop" in
const FLATTEN_Y = 0.72       // smoke spreads sideways more than it rises
const SWIRL_RAD_PER_S = 0.05
const WHITEOUT_MAX = 0.93    // camera in the middle of the smoke: the screen is almost fully covered, like CS
const WHITEOUT_COLOR = '#b4b9be'

interface Puff { sprite: THREE.Sprite; dir: THREE.Vector3; size: number; phase: number }
interface Cloud { id: number; group: THREE.Group; puffs: Puff[]; mats: THREE.SpriteMaterial[]; startMs: number }

let texture: THREE.CanvasTexture | null = null
function puffTexture(): THREE.CanvasTexture {
  if (texture) return texture
  const c = document.createElement('canvas')
  c.width = c.height = TEX_SIZE
  const g = c.getContext('2d')!
  const rng = mulberry32(12345)
  // a few overlapping blobs so the edge is not a perfect disc
  for (let i = 0; i < 7; i++) {
    const x = TEX_SIZE * (0.3 + rng() * 0.4), y = TEX_SIZE * (0.3 + rng() * 0.4), r = TEX_SIZE * (0.22 + rng() * 0.22)
    const grad = g.createRadialGradient(x, y, 0, x, y, r)
    grad.addColorStop(0, 'rgba(255,255,255,0.8)'); grad.addColorStop(0.55, 'rgba(255,255,255,0.45)'); grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad; g.fillRect(0, 0, TEX_SIZE, TEX_SIZE)
  }
  texture = new THREE.CanvasTexture(c)
  return texture
}

export function createSmokeFx(scene: THREE.Scene) {
  const clouds: Cloud[] = []
  // Full-screen overlay when the camera is inside the smoke: sprites near the camera do not cover everything, so add a haze layer based on depth
  const overlay = document.createElement('div')
  overlay.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:12;opacity:0;background:${WHITEOUT_COLOR}`
  document.body.appendChild(overlay)
  let overlayOp = 0

  function dispose(c: Cloud): void {
    scene.remove(c.group)
    for (const m of c.mats) m.dispose()
  }

  return {
    /** Bloom the smoke at `pos` (where the grenade exploded). `id` is the seed so every client builds the same shape. */
    spawn(pos: Vec3, id: number): void {
      const rng = mulberry32(hashSeed(id, 0x5b0c3))
      const mats = [0, 1, 2].map(i => new THREE.SpriteMaterial({
        map: puffTexture(), color: COLOR, transparent: true, opacity: 0, depthWrite: false, rotation: i * 2.1 + rng() * 6,
      }))
      const group = new THREE.Group()
      group.position.set(pos[0], pos[1] + SMOKE.centerLift, pos[2])
      const puffs: Puff[] = []
      for (let i = 0; i < PUFFS; i++) {
        // uniformly random point inside the unit sphere
        let x = 0, y = 0, z = 0
        do { x = rng() * 2 - 1; y = rng() * 2 - 1; z = rng() * 2 - 1 } while (x * x + y * y + z * z > 1)
        const sprite = new THREE.Sprite(mats[i % 3]!)
        sprite.renderOrder = 5
        group.add(sprite)
        puffs.push({ sprite, dir: new THREE.Vector3(x, y * FLATTEN_Y, z), size: 3.0 + rng() * 2.2, phase: rng() * 6.28 })
      }
      scene.add(group)
      clouds.push({ id, group, puffs, mats, startMs: performance.now() })
    },

    update(dt: number, cam?: THREE.Vector3): void {
      const now = performance.now()
      let density = 0
      for (let i = clouds.length - 1; i >= 0; i--) {
        const c = clouds[i]!
        const age = now - c.startMs
        if (age >= SMOKE.durationMs) { dispose(c); clouds[i] = clouds[clouds.length - 1]!; clouds.pop(); continue }
        const R = smokeRadiusAt(age)
        const rel = R / SMOKE.radius
        const left = SMOKE.durationMs - age
        const op = PEAK_OPACITY * Math.min(1, age / FADE_IN_MS) * (left < SMOKE.fadeMs ? left / SMOKE.fadeMs : 1)
        for (const m of c.mats) m.opacity = op
        c.group.rotation.y += SWIRL_RAD_PER_S * dt
        if (cam) {   // 0 at the smoke edge -> 1 at the centre (soft curve: leaving the smoke brightens gradually instead of popping)
          const d = Math.hypot(cam.x - c.group.position.x, cam.y - c.group.position.y, cam.z - c.group.position.z)
          const inside = R > 0.1 ? Math.max(0, 1 - d / R) : 0
          density = Math.max(density, Math.min(1, inside * 2.2) * (op / PEAK_OPACITY))
        }
        const floorY = -SMOKE.centerLift + 0.3   // keep the sprite centre from sinking below the floor
        const t = age / 1000
        for (const p of c.puffs) {
          const bob = Math.sin(t * 0.6 + p.phase) * 0.12
          p.sprite.position.set(p.dir.x * R, Math.max(floorY, p.dir.y * R + bob), p.dir.z * R)
          p.sprite.scale.setScalar(p.size * (0.45 + 0.55 * rel))
        }
      }
      const target = density * WHITEOUT_MAX
      overlayOp += (target - overlayOp) * Math.min(1, dt * 8)   // smoothing
      if (Math.abs(overlayOp - Number(overlay.style.opacity)) > 0.004) overlay.style.opacity = String(overlayOp)
    },

    clear(): void {
      for (const c of clouds) dispose(c)
      clouds.length = 0
      overlayOp = 0; overlay.style.opacity = '0'
    },

    get count(): number { return clouds.length },
  }
}

export type SmokeFx = ReturnType<typeof createSmokeFx>
