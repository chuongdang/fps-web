import * as THREE from 'three'

const SMOKE_TINT = new THREE.Color(0xc9d2d8)
const SMOKE_GLOW = new THREE.Color(0x4a545c)   // additive grey glow so the smoke grenade is clearly brighter than the dark green HE grenade

/** The smoke grenade shares the M67 model: multiply a grey-blue tint onto a copy of the material to tell it apart from HE (the original material is untouched) */
export function tintSmoke(root: THREE.Object3D): void {
  root.traverse(m => {
    if (!(m instanceof THREE.Mesh)) return
    const mats = Array.isArray(m.material) ? m.material : [m.material]
    const out = mats.map(mt => {
      if (!(mt instanceof THREE.Material) || !('color' in mt)) return mt
      const c = mt.clone() as THREE.MeshStandardMaterial
      c.color.multiply(SMOKE_TINT)
      if ('emissive' in c) c.emissive.copy(SMOKE_GLOW)
      return c
    })
    m.material = Array.isArray(m.material) ? out : out[0]!
  })
}
