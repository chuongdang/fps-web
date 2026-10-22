// Sniffing (plan 16, I.3): players within range show as a faint red overlay through walls on the zombie screen. Uses transparent capsules with `depthTest: false`
// (not an outline shader) so it is cheap: at most 10 reused capsules.
import * as THREE from 'three'

const MAX = 12

export function createSniffFx(scene: THREE.Scene) {
  const geo = new THREE.CapsuleGeometry(0.42, 1.0, 4, 10)
  const mat = new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.38, depthTest: false, depthWrite: false, fog: false })
  const meshes: THREE.Mesh[] = []
  for (let i = 0; i < MAX; i++) {
    const m = new THREE.Mesh(geo, mat)
    m.visible = false; m.renderOrder = 20; m.frustumCulled = false
    scene.add(m); meshes.push(m)
  }
  return {
    /** targets = foot positions of the players to show; active=false hides everything */
    update(active: boolean, targets: readonly { pos: [number, number, number]; crouching?: boolean }[], t: number): void {
      mat.opacity = 0.3 + 0.1 * Math.sin(t / 120)
      for (let i = 0; i < MAX; i++) {
        const m = meshes[i]!
        const tg = active ? targets[i] : undefined
        if (!tg) { m.visible = false; continue }
        m.visible = true
        const h = tg.crouching ? 1.2 : 1.8
        m.scale.y = h / 1.84
        m.position.set(tg.pos[0], tg.pos[1] + h / 2, tg.pos[2])
      }
    },
    clear(): void { for (const m of meshes) m.visible = false },
  }
}
