// yaw = 0 nhìn về -Z; yaw tăng = quay trái; pitch dương = ngước lên
// forward = (-sin(yaw), 0, -cos(yaw))
// right   = ( cos(yaw), 0, -sin(yaw))

export type Vec3 = [number, number, number]

export function forwardFromYaw(yaw: number, out: Vec3): Vec3 {
  out[0] = -Math.sin(yaw)
  out[1] = 0
  out[2] = -Math.cos(yaw)
  return out
}

export function rightFromYaw(yaw: number, out: Vec3): Vec3 {
  out[0] = Math.cos(yaw)
  out[1] = 0
  out[2] = -Math.sin(yaw)
  return out
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

// Interpolate angle đi đường ngắn nhất qua ±π
export function lerpAngle(a: number, b: number, t: number): number {
  const tau = 2 * Math.PI
  const diff = (((b - a + Math.PI) % tau) + tau) % tau - Math.PI
  return a + diff * t
}

// Deterministic PRNG; trả về hàm random [0, 1)
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return (): number => {
    s = (s + 0x6D2B79F5) | 0
    let z = s
    z = Math.imul(z ^ (z >>> 15), z | 1)
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61)
    return ((z ^ (z >>> 14)) >>> 0) / 0x100000000
  }
}

// Gộp nhiều số thành seed 32-bit
export function hashSeed(...nums: number[]): number {
  let h = 0x811c9dc5 // FNV-1a offset basis
  for (const n of nums) {
    h ^= n | 0
    h = Math.imul(h, 0x01000193) // FNV prime
  }
  return h >>> 0
}
