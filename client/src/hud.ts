import * as THREE from 'three'

// ── Hitmarker ─────────────────────────────────────────────────────────────────
function buildHitmarker() {
  const el = document.createElement('div')
  el.style.cssText =
    'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);' +
    'width:24px;height:24px;pointer-events:none;display:none;z-index:15'

  for (const angle of [45, -45]) {
    const line = document.createElement('div')
    line.style.cssText =
      `position:absolute;width:18px;height:2px;top:calc(50% - 1px);left:calc(50% - 9px);` +
      `transform:rotate(${angle}deg);background:#fff`
    el.appendChild(line)
  }
  document.body.appendChild(el)

  let _timer = 0
  return {
    el,
    show(headshot: boolean) {
      const color = headshot ? '#f55' : '#fff'
      for (const c of el.children) {
        (c as HTMLElement).style.background = color
      }
      el.style.display = 'block'
      _timer = 150
    },
    tick(ms: number) {
      if (_timer <= 0) return
      _timer -= ms
      if (_timer <= 0) el.style.display = 'none'
    },
  }
}

// ── Bullet holes ──────────────────────────────────────────────────────────────
const BH_MAT    = new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 })
const BH_GEO    = new THREE.CircleGeometry(0.10, 12)   // 10cm radius
const MAX_HOLES = 50

function buildBulletHoles(scene: THREE.Scene) {
  const holes: THREE.Mesh[] = []

  return {
    add(hitPos: [number, number, number], normal: [number, number, number]) {
      const mesh = new THREE.Mesh(BH_GEO, BH_MAT)
      const OFFSET = 0.005

      // Đẩy nhẹ theo normal để tránh z-fighting
      mesh.position.set(
        hitPos[0] + normal[0] * OFFSET,
        hitPos[1] + normal[1] * OFFSET,
        hitPos[2] + normal[2] * OFFSET,
      )
      // lookAt(hitPos - normal): -Z nhìn vào tường → front face (+Z) quay ra ngoài về phía player
      mesh.lookAt(
        hitPos[0] - normal[0],
        hitPos[1] - normal[1],
        hitPos[2] - normal[2],
      )

      scene.add(mesh)
      holes.push(mesh)

      if (holes.length > MAX_HOLES) {
        scene.remove(holes.shift()!)
      }
    },
  }
}

// ── Export ────────────────────────────────────────────────────────────────────
export interface HUDHandle {
  showHitmarker(headshot: boolean): void
  addBulletHole(hitPos: [number, number, number], normal: [number, number, number]): void
  tick(dtMs: number): void
}

export function initHUD(scene: THREE.Scene): HUDHandle {
  const hm = buildHitmarker()
  const bh = buildBulletHoles(scene)

  return {
    showHitmarker: (hs) => hm.show(hs),
    addBulletHole: (p, n) => bh.add(p, n),
    tick:          (ms)  => hm.tick(ms),
  }
}
