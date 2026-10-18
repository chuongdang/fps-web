import * as THREE from 'three'
import { loadMap } from '@fps/shared'
import type { MapFile } from '@fps/shared'
import { createWorld } from '@fps/shared/physics/world'
import { buildMapMesh } from './render/mapMesh'
import mapFileRaw from '@assets/maps/deathmatch.json'

const mapFile = mapFileRaw as unknown as MapFile
const loadedMap = loadMap(mapFile)

// ── Renderer ──────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
document.body.style.margin = '0'
document.body.appendChild(renderer.domElement)

// ── Scene ─────────────────────────────────────────────────────────────────────
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x4a6a8a)
scene.fog = new THREE.Fog(0x4a6a8a, 80, 160)

// ── Lights ────────────────────────────────────────────────────────────────────
const hemi = new THREE.HemisphereLight(0x8ab4d4, 0x3a5a2a, 1.0)
scene.add(hemi)
const sun = new THREE.DirectionalLight(0xffffff, 1.4)
sun.position.set(20, 40, 20)
sun.castShadow = true
sun.shadow.camera.near = 0.5
sun.shadow.camera.far = 200
sun.shadow.camera.left = -70
sun.shadow.camera.right = 70
sun.shadow.camera.top = 50
sun.shadow.camera.bottom = -50
sun.shadow.mapSize.set(2048, 2048)
scene.add(sun)

// ── Camera ────────────────────────────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 300)
camera.position.set(0, 30, 0)

// ── Map mesh ──────────────────────────────────────────────────────────────────
scene.add(buildMapMesh(loadedMap))

// ── Spawn arrows ──────────────────────────────────────────────────────────────
for (const sp of loadedMap.spawns.A) {
  const dir = new THREE.Vector3(-Math.sin(sp.yaw), 0, -Math.cos(sp.yaw))
  scene.add(new THREE.ArrowHelper(dir, new THREE.Vector3(sp.pos[0], sp.pos[1], sp.pos[2]), 2, 0x2266ff, 0.6, 0.4))
}
for (const sp of loadedMap.spawns.B) {
  const dir = new THREE.Vector3(-Math.sin(sp.yaw), 0, -Math.cos(sp.yaw))
  scene.add(new THREE.ArrowHelper(dir, new THREE.Vector3(sp.pos[0], sp.pos[1], sp.pos[2]), 2, 0xff4422, 0.6, 0.4))
}

// ── Debug wireframe (F4) ──────────────────────────────────────────────────────
let debugLines: THREE.LineSegments | null = null

async function initDebug() {
  const world = await createWorld(loadedMap)
  const { vertices, colors } = world.debugRender()
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 4))
  debugLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true }))
  debugLines.visible = false
  scene.add(debugLines)
}
initDebug()

document.addEventListener('keydown', (e) => {
  if (e.code === 'F4' && debugLines) {
    debugLines.visible = !debugLines.visible
    e.preventDefault()
  }
})

// ── Fly camera ────────────────────────────────────────────────────────────────
let yaw = 0
let pitch = -0.8
let locked = false
const keys: Record<string, boolean> = {}

const _fwd = new THREE.Vector3()
const _right = new THREE.Vector3()

document.addEventListener('keydown', e => { keys[e.code] = true })
document.addEventListener('keyup',   e => { keys[e.code] = false })

renderer.domElement.addEventListener('click', () => {
  renderer.domElement.requestPointerLock()
})
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement
})
document.addEventListener('mousemove', (e) => {
  if (!locked) return
  yaw   -= e.movementX * 0.002
  pitch -= e.movementY * 0.002
  pitch  = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch))
})

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

// ── Render loop ───────────────────────────────────────────────────────────────
const SPEED = 12
let prev = performance.now()

function frame(now: number) {
  const dt = Math.min((now - prev) / 1000, 0.1)
  prev = now

  _fwd.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
  _right.set(Math.cos(yaw), 0, -Math.sin(yaw))

  if (keys['KeyW']) camera.position.addScaledVector(_fwd, SPEED * dt)
  if (keys['KeyS']) camera.position.addScaledVector(_fwd, -SPEED * dt)
  if (keys['KeyA']) camera.position.addScaledVector(_right, -SPEED * dt)
  if (keys['KeyD']) camera.position.addScaledVector(_right, SPEED * dt)
  if (keys['KeyQ']) camera.position.y -= SPEED * dt
  if (keys['KeyE']) camera.position.y += SPEED * dt

  camera.rotation.order = 'YXZ'
  camera.rotation.y = yaw
  camera.rotation.x = pitch

  renderer.render(scene, camera)
  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)

// HUD hint
const hint = document.createElement('div')
hint.style.cssText = 'position:fixed;bottom:12px;left:12px;color:#fff;font:14px monospace;opacity:0.7;pointer-events:none'
hint.textContent = 'Click để bắt chuột | WASD di chuyển | Q/E lên xuống | F4 debug collider'
document.body.appendChild(hint)
