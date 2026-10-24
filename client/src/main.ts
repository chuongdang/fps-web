import * as THREE from 'three'
import {
  loadMap, DT, Btn, WEAPONS, RESPAWN_DELAY_MS, makeWeaponState, magSizeOf, makeRecoilState,
  stepWeaponCmd, computeSpreadDeg, spreadParts, adsMoveFor, adsWanted, computeShotDirs, MAX_PELLETS, recoverRecoil,
  CATEGORY_SLOT, DEFAULT_SLOT, ECONOMY, ECONOMY_ELIM, SLOT_COUNT, GRENADE, GRENADE_ID, GRENADE_SLOT, SMOKE_ID, TICK_RATE, defaultLoadout, dropsEnabled, inBuyZone, loadoutWeaponIds, moveSpeedMul, throwInitial, weaponByKey,
} from '@fps/shared'
import { t } from './i18n'
import { weaponLabel } from './weaponIcon'
import type { LoadedMap, MovementConfig, SpreadParts } from '@fps/shared'
import { CLAW_HEAVY_ID, CLAW_ID, DEFENSE, flagSpeedMul, INFECTION, ZOMBIE, isZombieMode, ZOMBIE_DEFAULT_RUN_SPEED, economyFor, movementFor } from '@fps/shared'
import { createWorld, type CollisionWorld } from '@fps/shared/physics/world'
import { buildMapMesh, disposeMapMesh } from './render/mapMesh'
import { sunFitFor, SUN_OFFSET } from './render/sunFit'
import { setFlashlightAllowed, flashlightOn, initInput, setOverlayDim, applyCameraRotation, isLocked, yaw, pitch, setLook, sampleButtons, setSensScale, consumeWheel, requestCycleNade, setTouchContext, setTouchActions, isTouchControls } from './input'
import { abilitiesOf, type TouchContext } from './touch/buttons'
import { IS_TOUCH } from './touch/mode'
import { getQuality, pixelRatioFor } from './touch/quality'
import { createScope } from './scope'
import { createSky, SKY_HORIZON } from './render/sky'
import { createNight } from './render/night'
import { createZombieOverlay } from './render/zombieOverlay'
import { createSniffFx } from './render/sniffFx'
import { startLoop, initGameState, defaultMovement, setNetHooks, currentState, setWantedWeapon, wantedWeapon, setWeaponMove, setDead, setMatchPhase, setTransforming, setDowned } from './loop'
import { initDebugOverlay } from './debug'
import { showLobby, BACK_KEY, type Session } from './net/lobby'
import { startPing, type PingStats } from './net/ping'
import { clock } from './net/clock'
import { attachSnapshots, type SnapshotStore } from './net/snapshots'
import { createPlayersRenderer } from './render/players'
import { Interpolator, InterpDelay, interp } from './net/interpolation'
import { reconcileWeapon } from './net/weaponSync'
import { Prediction } from './net/prediction'
import { createGhosts } from './render/ghosts'
import { createTracers } from './render/tracers'
import { createDebugShots } from './render/debugShots'
import { createKillfeed, createDeathScreen, createHurtIndicator, createBountyBanner, createSpectateLabel } from './hudNet'
import { createShop } from './shop'
import { createKeyHints, createPickupPrompt, createTopButtons, createConfirmPrompt, createToast, createLeaveButton, createRoomLabel, createCommandBox } from './hudButtons'
import { createSpectator, type SpecCandidate } from './spectate'
import { createMatchHud, createScoreboard } from './hudMatch'
import { createZombieHud } from './hudZombie'
import { createOfflinePanel } from './hudOffline'
import { createBotDebug } from './render/botDebug'
import { MsgType, MatchPhase, NetFlag, DEFAULT_CHARACTER_SET, type TeamId } from '@fps/shared'
import { skinOfSet } from './render/characterRig'
import { initTuningPanel } from './tuning'
import { createViewmodel } from './render/viewmodel'
import { createPoseEditor } from './render/poseEditor'
import { createBloodFx } from './render/bloodFx'
import { createGrenades } from './render/grenades'
import { createWeaponDrops } from './render/weaponDrops'
import { createGrenadeWarning } from './hudGrenadeWarn'
import { createExplosionFx } from './render/explosionFx'
import { createSmokeFx } from './render/smokeFx'
import { createTargets, createBoards, rayBoards, updateTargets, flashTarget } from './targets'
import { fireHitscan } from './hitscan'
import { initHUD } from './hud'
import {
  initAudio, updateListener, settings as audioSettings, playShot, playDry, playDraw, startReload, cancelReload,
  playScream, playInfectSting, playZombieHurt, startNightAmbient, stopNightAmbient, updateZombieAudio,
  playHit, playHurt, playFallHurt, setHealthForAudio, playShotOther, playFootstep, playLanding, StepTracker, FOOTSTEPS, playBuyOk, playBuyFail,
  playPin, playSpoon, playThrowSwish, playBounce, playExplode, playSmokeBurst, playRoundStart, playRoundWin, playRoundLose, playTick,
} from './audio'
import { initAudioTuning } from './audio/tuning'
import { MAPS, DEFAULT_MAP_ID } from '@assets/maps'

// The lobby backdrop is the default map; once the room is known (its Welcome carries the map id) the room's map replaces it (showMap below)
let loadedMap = loadMap(MAPS[DEFAULT_MAP_ID]!)

// ── Renderer ──────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true })
if (IS_TOUCH) renderer.setPixelRatio(pixelRatioFor(window.devicePixelRatio, getQuality()))   // phones: cap the pixels drawn (the lobby's Graphics choice); desktop stays at ratio 1
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
renderer.autoClear = false   // manual clear so the viewmodel pass can render separately
document.body.style.margin = '0'
document.body.appendChild(renderer.domElement)

// ── Scene ─────────────────────────────────────────────────────────────────────
const scene = new THREE.Scene()
scene.background = new THREE.Color(SKY_HORIZON)
scene.fog = new THREE.Fog(SKY_HORIZON, 70, 200)   // light fog, same color as the sky horizon

// ── Lights ────────────────────────────────────────────────────────────────────
const hemi = new THREE.HemisphereLight(0x8ab4d4, 0x3a5a2a, 1.0)
scene.add(hemi)
const sun = new THREE.DirectionalLight(0xffffff, 1.4)
sun.position.set(20, 40, 20)
sun.castShadow = true
sun.shadow.camera.near = 0.5
sun.shadow.mapSize.set(2048, 2048)
scene.add(sun, sun.target)
function fitSunTo(map: LoadedMap): void {   // the shadow camera covers exactly this map: finer 2048 shadow map on small maps
  const fit = sunFitFor(map)
  const cam = sun.shadow.camera
  cam.left = cam.bottom = -fit.radius
  cam.right = cam.top = fit.radius
  cam.far = fit.far
  cam.updateProjectionMatrix()
  sun.target.position.set(...fit.center)
  sun.position.set(fit.center[0] + SUN_OFFSET[0], fit.center[1] + SUN_OFFSET[1], fit.center[2] + SUN_OFFSET[2])
}
fitSunTo(loadedMap)
const sky = createSky(scene, sun.position)

// ── Camera ────────────────────────────────────────────────────────────────────
const BASE_FOV = 75
const RECOIL_VIEW_TAU = 0.045   // s: smoothing of the camera lifting with recoil
const recView = { pitch: 0, yaw: 0 }
const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.1, 300)
camera.rotation.order = 'YXZ'

initInput(renderer.domElement)

// ── Map mesh ──────────────────────────────────────────────────────────────────
let mapMesh = buildMapMesh(loadedMap)
scene.add(mapMesh)
const night = createNight(scene, hemi, sun, sky, loadedMap.name)

// ── Spawn arrows: only shown when debug F4 is on (same switch as drawing colliders) ──────────
const spawnMarkers = new THREE.Group()
spawnMarkers.visible = false
scene.add(spawnMarkers)
function fillSpawnMarkers(map: LoadedMap): void {
  spawnMarkers.clear()
  for (const [list, color] of [[map.spawns.A, 0x2266ff], [map.spawns.B, 0xff4422]] as const) {
    for (const sp of list) {
      const dir = new THREE.Vector3(-Math.sin(sp.yaw), 0, -Math.cos(sp.yaw))
      spawnMarkers.add(new THREE.ArrowHelper(dir, new THREE.Vector3(sp.pos[0], sp.pos[1], sp.pos[2]), 2, color, 0.6, 0.4))
    }
  }
}
fillSpawnMarkers(loadedMap)

/** The room's map is known: swap the lobby backdrop for it (everything that depends on the map follows loadedMap) */
function showMap(map: LoadedMap): void {
  loadedMap = map
  scene.remove(mapMesh)
  disposeMapMesh(mapMesh)
  mapMesh = buildMapMesh(map)
  scene.add(mapMesh)
  fitSunTo(map)
  night.setMap(map.name)
  fillSpawnMarkers(map)
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  vm.updateAspect(camera.aspect)
})

// ── Viewmodel ─────────────────────────────────────────────────────────────────
const vm = createViewmodel(window.innerWidth / window.innerHeight)
const poseEditor = createPoseEditor(vm, () => vm.currentWeapon, id => {
  // F9 picks a weapon → hold it immediately (offline only; online weapons are issued by the server). Put it in the slot of its category and switch to that slot
  if (sessionRef || dead) return
  const slot = CATEGORY_SLOT[WEAPONS[id]!.category]
  ws.slots[slot] = id; ws.slot = slot; ws.current = id; ws.wantSlot = slot; ws.reloadEndMs = 0
  setWantedWeapon(slot)
})   // F9 hand/weapon pose tuning panel, F10 orbit camera
let vmTeam: TeamId | undefined

initAudio(() => playDraw(ws.current))   // entering the game screen: the default weapon also plays its draw sound
initAudioTuning()

// ── Weapon logic (shared) ───────────────────────────────────────────────────────
let playerId = 1   // offline = 1; online = id issued by the server (the spread seed must match the server)
const steps = new StepTracker()
// Offline: the Cops' default loadout; try other weapons with ?loadout=knife,colt,smg,sniper (each weapon goes in the slot of its category)
function offlineSlots(): number[] {
  const slots = loadoutWeaponIds(defaultLoadout('A'))
  for (const key of (new URLSearchParams(location.search).get('loadout') ?? '').split(',')) {
    const def = weaponByKey(key.trim())
    if (def) slots[CATEGORY_SLOT[def.category]] = def.id
  }
  return slots
}
const ws  = makeWeaponState(offlineSlots())
if ((ws.slots[GRENADE_SLOT] ?? -1) >= 0) ws.ammo[ws.slots[GRENADE_SLOT]!] = ws.slots[GRENADE_SLOT] === SMOKE_ID ? 1 : 2   // offline ?loadout=m67 / smoke: grenades are provided so you can test throwing
vm.snapTo(ws.current)
const rec = makeRecoilState()
const shotDirs: [number, number, number][] = Array.from({ length: MAX_PELLETS }, () => [0, 0, 0] as [number, number, number])
const eyeTmp:  [number, number, number] = [0, 0, 0]
let simMs = 0
setWeaponMove({ mul: () => moveSpeedMul(ws), ads: () => adsMoveFor(ws), want: cmd => adsWanted(ws, cmd.buttons, cmd.seq * 1000 / TICK_RATE) })   // offline; online goes through Prediction's step hook

// Weapon switching by slot (H.4): cmd.weapon = slot; the weapon logic switches on the next tick (same on client and server), the viewmodel follows ws.current
let dead = false
let prevSlot = -1      // slot held before, for the Q key
let seenSlot = ws.slot
function requestSlot(slot: number): void {
  if (dead || slot === wantedWeapon()) return
  if ((ws.slots[slot] ?? -1) < 0) return   // empty slot: ignore
  setWantedWeapon(slot)
}
function cycleSlot(dir: number): void {
  let s = wantedWeapon()
  for (let i = 0; i < SLOT_COUNT; i++) {
    s = (s + dir + SLOT_COUNT) % SLOT_COUNT
    if ((ws.slots[s] ?? -1) >= 0) { requestSlot(s); return }
  }
}
const slotKeysBuf: (string | null)[] = [null, null, null, null, null]
const slotCountsBuf: (number | null)[] = [null, null, null, null, null]

// Number keys as in CS 1.6: 1 primary, 2 pistol, 3 knife, 4 grenade. Pressing the key of the held slot again switches within that slot
// (1: rifle ↔ mid-range; 4: HE ↔ smoke). Q = previously held weapon.
const SLOT_PRIMARY_LONG = CATEGORY_SLOT.long, SLOT_PRIMARY_MID = CATEGORY_SLOT.mid, SLOT_PISTOL = CATEGORY_SLOT.pistol, SLOT_KNIFE = CATEGORY_SLOT.knife
function pressNumberKey(n: number): void {
  if (n === 1) {   // primary: with both a rifle and a mid-range weapon, pressing again toggles between them
    const hasLong = (ws.slots[SLOT_PRIMARY_LONG] ?? -1) >= 0, hasMid = (ws.slots[SLOT_PRIMARY_MID] ?? -1) >= 0
    const cur = wantedWeapon()
    if (cur === SLOT_PRIMARY_LONG && hasMid) requestSlot(SLOT_PRIMARY_MID)
    else if (cur === SLOT_PRIMARY_MID && hasLong) requestSlot(SLOT_PRIMARY_LONG)
    else requestSlot(hasLong ? SLOT_PRIMARY_LONG : SLOT_PRIMARY_MID)
  } else if (n === 2) requestSlot(SLOT_PISTOL)
  else if (n === 3) requestSlot(SLOT_KNIFE)
  else if (n === 4) {
    if (!dead && wantedWeapon() === GRENADE_SLOT && ws.slot === GRENADE_SLOT) requestCycleNade()   // holding a grenade: switch type
    else requestSlot(GRENADE_SLOT)
  }
}

// Q = previously held weapon. With no previous weapon (just respawned) or it is gone: toggle between primary (1) and pistol (2), as in CS 1.6
function pressLastWeapon(): void {
  const cur = wantedWeapon()
  if (prevSlot >= 0 && prevSlot !== cur && (ws.slots[prevSlot] ?? -1) >= 0) { requestSlot(prevSlot); return }
  if (cur === SLOT_PISTOL) pressNumberKey(1)
  else requestSlot(SLOT_PISTOL)
}

document.addEventListener('keydown', (e) => {
  if (e.repeat) return
  const m = /^Digit([0-9])$/.exec(e.code)
  if (m) {
    const n = Number(m[1])
    if (shop.digit(n)) return   // menu open: number keys are used to buy
    pressNumberKey(n)
  }
  if (e.code === 'KeyQ') pressLastWeapon()
  if (e.code === 'KeyG' && isLocked()) sendWeaponCmd(MsgType.DropWeapon)
  if (e.code === 'KeyE' && isLocked()) sendWeaponCmd(MsgType.PickupWeapon)
  if (e.code === 'KeyB') shop.toggle()
  if (e.code === 'Backquote') { e.preventDefault(); askSwitchTeam() }
  if (e.code === 'F4' && debugLines) { debugLines.visible = !debugLines.visible; spawnMarkers.visible = debugLines.visible; e.preventDefault() }
})

// ── Physics world + game loop ─────────────────────────────────────────────────
const cfg = { ...defaultMovement }
let selfCfg: MovementConfig = cfg   // movement config of ourselves: zombies differ from humans (plan 16)

// Network: join a room through the lobby screen; play offline if skipped. Ping starts after joining a room
const netStats: PingStats = { rttMs: 0, outOfOrder: 0 }
let snapStore: SnapshotStore | null = null
let sessionRef: Session | null = null
const playersRenderer = createPlayersRenderer(scene, {
  teamOf: id => sessionRef?.teams.get(id),
  nameOf: id => sessionRef?.names.get(id),
  myTeam: () => sessionRef?.teams.get(sessionRef.yourId),
  characterSet: () => sessionRef?.characterSet ?? '',
  // Infection: an infected player keeps their own model; Defense: zombies use the Terrorist model (+ tint by type)
  modelTeam: (id, flags) => (sessionRef && isZombieMode(sessionRef.config.settings.mode) ? (sessionRef.config.settings.mode === 'defense' && (flags & NetFlag.Zombie) !== 0 ? 'B' : 'A') : sessionRef?.teams.get(id)),
  viewer: () => [camera.position.x, camera.position.y, camera.position.z],
  zombieMode: () => !!sessionRef && isZombieMode(sessionRef.config.settings.mode),
})
const explosionFx = createExplosionFx(scene, () => (worldRef ? (o, d, m) => worldRef!.castRay(o, d, m) : null))
const smokeFx = createSmokeFx(scene)
const grenades = createGrenades(scene, {
  world: () => worldRef,
  onExplode: (pos, _hits, kind, id) => {
    if (kind === 'smoke') { smokeFx.spawn(pos, id); playSmokeBurst(pos); return }   // smoke: no explosion, no shake, no tinnitus
    explosionFx.explode(pos, [camera.position.x, camera.position.y, camera.position.z]); playExplode(pos, !dead)
  },
  onBounce: (pos, speed) => playBounce(pos, speed),
  onRelease: (pos, own) => playSpoon(own ? undefined : pos),
  localFuse: () => !sessionRef,   // offline has no server: explode by itself when the fuse runs out
  releaseDelayMs: (id, mode) => playersRenderer.grenadeReleaseDelayMs(id, mode),
})
const weaponDrops = createWeaponDrops(scene, {
  world: () => worldRef,
  gunModel: id => playersRenderer.gunModel(id),
  onBounce: (pos, speed) => playBounce(pos, speed),
})
const nadeWarn = createGrenadeWarning()
const nadeAimState = { pos: [0, 0, 0] as [number, number, number], vel: [0, 0, 0] as [number, number, number], yaw: 0, pitch: 0, grounded: true, crouching: false, slideTimer: 0, slideCooldown: 0, adsT: 0 }
if (import.meta.env.DEV) Object.assign(globalThis, { __players: playersRenderer, __renderer: renderer, __grenades: grenades, __weaponDrops: weaponDrops, __camera: camera, __explosionFx: explosionFx, __smokeFx: smokeFx })   // debug: lets a script inspect from the browser
const interpolator = new Interpolator()
const interpDelay = new InterpDelay()
let prediction: Prediction | null = null
let hudRef: ReturnType<typeof initHUD> | null = null
let worldRef: CollisionWorld | null = null
const HOLE_EPS = 0.05   // tolerance when deciding that a ray ends at a wall (not at a player)
const ghosts = createGhosts(scene)
const tracers = createTracers(scene)
// White blood on hitting a player: droplets collide with the map via the physics world castRay (offline has a world too)
const bloodCast = (o: [number, number, number], d: [number, number, number], m: number) => worldRef?.castRay(o, d, m) ?? null
const blood = createBloodFx(scene, () => (worldRef ? bloodCast : null))
let lastSampled: ReturnType<Interpolator['sample']> = []   // other players at the last drawn frame (the target of HitConfirm)
const lastFireOrigin: [number, number, number] = [0, 0, 0]
const lastFireDir: [number, number, number] = [0, 0, -1]
const hitCenter: [number, number, number] = [0, 0, 0]
const debugShots = createDebugShots(scene)
const killfeed = createKillfeed()
const deathScreen = createDeathScreen()
const hurtIndicator = createHurtIndicator()
const bountyBanner = createBountyBanner()
let sideSwapped = false
let matchPhaseNow: MatchPhase = MatchPhase.Playing
let buyEndsAt: number | null = null   // Elimination: end of the buy time (serverTime); null = unlimited
let deadAt = 0                        // performance.now() at death, to wait 2 seconds before switching to spectating a teammate
/** Why the shop cannot be used right now (an i18n key, shown as a toast when the player taps the cart); null = it can */
function shopDenied(): string | null {
  const s = sessionRef, pos = prediction?.predicted.pos
  if (!s || !pos || dead || matchPhaseNow === MatchPhase.Ended || matchPhaseNow === MatchPhase.Halftime) return 'hud.shop.deny.closed'
  if (buyEndsAt !== null && clock.serverNow() >= buyEndsAt) return 'hud.shop.deny.time'
  if (s.config.settings.mode === 'infection') return matchPhaseNow === MatchPhase.Prep && ((snapStore?.flags ?? 0) & NetFlag.Zombie) === 0 ? null : 'hud.shop.deny.prep'   // Infection: buy anywhere during the prep phase
  const team = s.teams.get(s.yourId)
  return team !== undefined && inBuyZone(loadedMap, team, sideSwapped, pos) ? null : 'hud.shop.deny.zone'
}
// Shop (H.7): display/send commands only; the server decides money, loadout, buy zone
const shop = createShop({
  money: () => snapStore?.money ?? 0,
  loadout: () => snapStore?.loadout ?? [],
  eco: () => economyFor(sessionRef?.config.settings.mode ?? 'tdm'),
  canShop: () => shopDenied() === null,
  onDenied: () => { const why = shopDenied(); if (why !== null) toast(t(why)) },
  send: key => sessionRef?.transport.send({ t: MsgType.Buy, key }),
  sounds: { ok: playBuyOk, fail: playBuyFail },
})
const zombieHud = createZombieHud()
const zoverlay = createZombieOverlay(scene)
const sniffFx = createSniffFx(scene)
let sniffedUntil = 0   // sniffed by a zombie: nose icon for 2s
const matchHud = createMatchHud({ start: playRoundStart, win: playRoundWin, lose: playRoundLose, tick: playTick })
const spectator = createSpectator(() => (worldRef ? (o, d, m) => worldRef!.castRay(o, d, m) : null))
let spectatingId = -2   // -2 = not spectating; -1 = flying camera overhead; ≥0 = watching that player
const specBuf: SpecCandidate[] = []
const specLabel = createSpectateLabel()
let hudShown = true
let prevLeapCd = 0
let defPhase = '', defEndsAt = 0, defCuePlayed = false   // Defense: a distant roar 5s before a new wave
const camDir = new THREE.Vector3()
// World HUD of the zombie modes: boss health bar, revive prompt, arrows to attacked teammates, sniff (Q)
const sniffTargets: { pos: [number, number, number]; crouching?: boolean }[] = []
function zombieWorldHud(state: { pos: [number, number, number] }, _dt: number): void {
  const mode = sessionRef?.config.settings.mode
  if (!snapStore || !sessionRef || !mode || !isZombieMode(mode)) { zombieHud.setBoss(null); return }
  let boss: (typeof lastSampled)[number] | null = null
  for (const o of lastSampled) if (o.ztype === 'boss' && (o.flags & NetFlag.Dead) === 0 && o.hpMax > 0) boss = o
  zombieHud.setBoss(boss ? boss.hp / boss.hpMax : null)
  if (mode === 'defense') {
    // Downed: we are downed / a downed teammate within 1.5m to revive
    const selfDowned = (snapStore.flags & NetFlag.Downed) !== 0
    zombieHud.setDownedSelf(selfDowned ? (snapStore.me?.downLeft ?? 0) / 1000 : null)
    let near: { name: string; progress: number } | null = null
    let arrowTarget: (typeof lastSampled)[number] | null = null, arrowD = Infinity
    if (!selfDowned && !dead) {
      for (const o of lastSampled) {
        if ((o.flags & NetFlag.Zombie) !== 0 || (o.flags & NetFlag.Dead) !== 0) continue
        const d = Math.hypot(o.pos[0] - state.pos[0], o.pos[2] - state.pos[2])
        if ((o.flags & NetFlag.Downed) !== 0 && d <= DEFENSE.down.reviveRangeM && Math.abs(o.pos[1] - state.pos[1]) < 1.5) near = { name: sessionRef.names.get(o.id) ?? `#${o.id}`, progress: o.reviveP ?? 0 }
        // teammate surrounded by zombies: a live zombie within 2.2m
        let attacked = false
        for (const z of lastSampled) if ((z.flags & NetFlag.Zombie) !== 0 && (z.flags & NetFlag.Dead) === 0 && Math.hypot(z.pos[0] - o.pos[0], z.pos[2] - o.pos[2]) < 2.2 && Math.abs(z.pos[1] - o.pos[1]) < 2) { attacked = true; break }
        if (attacked && d > 3 && d < arrowD) { arrowD = d; arrowTarget = o }
      }
    }
    zombieHud.setRevivePrompt(near)
    zombieHud.setAttackArrow(arrowTarget ? relAngle(arrowTarget.pos[0] - state.pos[0], arrowTarget.pos[2] - state.pos[2]) : null)
  }
  // Sniff: players within the radius show red through walls while the ability runs
  const me = snapStore.me
  const sniffing = mode === 'infection' && zombieSelf && (me?.sniffLeft ?? 0) > 0
  sniffTargets.length = 0
  if (sniffing) for (const o of lastSampled) {
    if ((o.flags & NetFlag.Zombie) !== 0 || (o.flags & NetFlag.Dead) !== 0) continue
    if (Math.hypot(o.pos[0] - state.pos[0], o.pos[2] - state.pos[2]) <= INFECTION.sniff.radius) sniffTargets.push({ pos: o.pos, crouching: (o.flags & NetFlag.Crouching) !== 0 })
  }
  sniffFx.update(!!sniffing, sniffTargets, performance.now())
  zombieHud.setNose(performance.now() < sniffedUntil)
}
/** Angle (rad, 0 = straight ahead, + = to the right) from the camera to the vector (dx, dz) on the horizontal plane */
function relAngle(dx: number, dz: number): number {
  const f = dx * -Math.sin(yaw) + dz * -Math.cos(yaw)
  const r = dx * Math.cos(yaw) + dz * -Math.sin(yaw)
  return Math.atan2(r, f)
}
let zombieSelf = false
const touchCtx: TouchContext = { live: false, human: true, ability: 'none', sniff: false, flashlight: false }   // one object, rewritten every frame (no allocation)
const specNext = () => { if (spectatingId !== -2) spectator.next(specBuf) }
// Touch (plan 19): a tap on the world switches the spectated player (the mouse click does this on desktop) or closes the buy menu; the "last weapon" button is the Q key
setTouchActions({ tap: () => { if (shop.isOpen) shop.close(); else specNext() }, lastWeapon: pressLastWeapon, dropWeapon: () => sendWeaponCmd(MsgType.DropWeapon) })
document.addEventListener('mousedown', e => { if (e.button === 0) specNext() })
document.addEventListener('keydown', e => { if (e.code === 'Space' && !e.repeat) specNext() })
const scoreboard = createScoreboard()
let tabHeld = false
let scoreToggle = false   // the "Scoreboard" button toggles the scoreboard
let topButtons: ReturnType<typeof createTopButtons> | null = null
const keyHints = createKeyHints()
let askSwitchTeam: () => void = () => {}
const teamPrompt = createConfirmPrompt()
const toast = createToast()
// Dropping (G) and picking up (E) guns: the server decides; the client only asks (alive, human, not spectating)
function sendWeaponCmd(t: typeof MsgType.DropWeapon | typeof MsgType.PickupWeapon): void {
  if (!sessionRef || dead || zombieSelf || spectatingId !== -2) return
  sessionRef.transport.send({ t })
}
const pickupPrompt = createPickupPrompt(() => sendWeaponCmd(MsgType.PickupWeapon))
const pickupLabel = (d: { weapon: number } | null): string | null => (d ? t('hud.pickup', { weapon: WEAPONS[d.weapon]!.name }) : null)
// Back to the lobby: reload the page (closing the connection makes the server remove us), the lobby skips the name step
createLeaveButton(() => {
  if (teamPrompt.isOpen) return
  teamPrompt.open(t('hud.confirm.leave'), () => {
    try { sessionStorage.setItem(BACK_KEY, '1') } catch { /* ignore */ }
    location.reload()
  })
})
document.addEventListener('keydown', e => { if (e.code === 'Tab') { e.preventDefault(); tabHeld = true } })
document.addEventListener('keyup', e => { if (e.code === 'Tab') { e.preventDefault(); tabHeld = false } })
window.addEventListener('blur', () => { tabHeld = false })
let lastHp = 100
// Camera kick on a hard landing (rad, positive = pitch down), decays exponentially. Only added to the displayed camera, like recoil
let fallPunch = 0
const FALL_PUNCH_TAU = 0.22, FALL_PUNCH_MIN = 0.05, FALL_PUNCH_PER_DMG = 0.004, FALL_PUNCH_MAX = 0.35
const FALL_FLASH_MIN = 0.3, FALL_FLASH_DMG = 60   // intensity = 0.3 + damage/60 (clamped to 1)
const selfDebug = { id: 0, pos: [0, 0, 0] as [number, number, number], yaw: 0, pitch: 0, flags: 0, weapon: 0, adsT: 0 }   // F10
// Offline (plan 15): bot panel, shortcuts, F11. Everything goes through OfflineCmd to the worker; infinite money shows `∞`.
let infiniteMoney = false
function setupOffline(session: Session): void {
  const send = (msg: Parameters<Session['transport']['send']>[0]) => session.transport.send(msg)
  const panel = createOfflinePanel({
    addBot: (difficulty, ally) => send({ t: MsgType.OfflineCmd, cmd: 'addBot', difficulty, ally }),
    removeBot: id => send({ t: MsgType.OfflineCmd, cmd: 'removeBot', id }),
    clearBots: () => send({ t: MsgType.OfflineCmd, cmd: 'clearBots' }),
  })
  const botDebug = createBotDebug(scene, on => send({ t: MsgType.OfflineCmd, cmd: 'botDebug', on }))
  session.transport.onMessage(msg => {
    if (msg.t === MsgType.OfflineState) { panel.setState(msg); botDebug.setBots(msg.bots); infiniteMoney = msg.infiniteMoney }
    else if (msg.t === MsgType.NavDebug) botDebug.onNav(msg)
    else if (msg.t === MsgType.BotDebug) botDebug.onBots(msg)
    else if (msg.t === MsgType.TeamAssigned && msg.id === session.yourId) panel.setMyTeam(msg.team)
  })
  document.addEventListener('keydown', e => {
    if (e.repeat || teamPrompt.isOpen) return
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
    if (e.code === 'BracketLeft') send({ t: MsgType.OfflineCmd, cmd: 'addBot', difficulty: 'medium', ally: e.shiftKey })
    else if (e.code === 'BracketRight') send({ t: MsgType.OfflineCmd, cmd: 'addBot', difficulty: 'hard', ally: e.shiftKey })
    else if (e.code === 'Backslash') send({ t: MsgType.OfflineCmd, cmd: 'clearBots' })
    else if (e.code === 'Semicolon' && DEBUG_KEYS) { e.preventDefault(); botDebug.toggle() }   // `;`: nav mesh + bot state (not F11: players press F11 for fullscreen)
  })
}

// Debug keys (hitscan boxes, bot grid) only work in dev or with ?debug=1, so players do not press them by accident
const DEBUG_KEYS = import.meta.env.DEV || new URLSearchParams(location.search).has('debug')
const sessionP = showLobby()
sessionP.then(session => {
  if (!session) {
    setOverlayDim(false)
    topButtons = createTopButtons({ onScores: () => { scoreToggle = !scoreToggle; topButtons?.setScoresActive(scoreToggle) }, onSwitch: () => {} }, false)
    return
  }
  topButtons = createTopButtons({
    onScores: () => { scoreToggle = !scoreToggle; topButtons?.setScoresActive(scoreToggle) },
    onSwitch: () => askSwitchTeam(),
  }, true)
  let lastTeam = session.teams.get(session.yourId)
  let pendingSwitch = false
  askSwitchTeam = () => {
    const mine = session.teams.get(session.yourId)
    if (!mine || teamPrompt.isOpen) return
    const other = mine === 'A' ? 'B' : 'A'
    if (session.offline) {   // offline: swap sides for the bots too (enemy bots stay enemies, teammates stay teammates)
      teamPrompt.open(t('hud.confirm.switchTeamBots', { team: t(`team.${other}.name`) }), () => { pendingSwitch = true; session.transport.send({ t: MsgType.OfflineCmd, cmd: 'swapSide' }) })
      return
    }
    teamPrompt.open(t('hud.confirm.switchTeam', { team: t(`team.${other}.name`) }), () => { pendingSwitch = true; session.transport.send({ t: MsgType.ChooseTeam, team: other }) })
  }
  session.transport.onMessage(msg => {
    if (msg.t !== MsgType.TeamAssigned || msg.id !== session.yourId) return
    const changed = lastTeam !== undefined && lastTeam !== msg.team
    if (pendingSwitch) { pendingSwitch = false; toast(changed ? t('hud.toast.switched', { team: t(`team.${msg.team}.name`) }) : t('hud.toast.switchFailed')) }
    else if (changed) toast(t('hud.toast.balanced', { team: t(`team.${msg.team}.name`) }))
    lastTeam = msg.team
  })
  playerId = session.yourId
  sessionRef = session
  ws.magMult = economyFor(session.config.settings.mode).magMult ?? 1   // magazines ×2 in the zombie modes (matches the server)
  matchHud.setConfig(session.config)
  {   // zombie modes: night according to the room settings
    const st = session.config.settings
    night.setNight(st.mode === 'infection' || st.mode === 'defense' ? st.lighting === 'night' : false)
  }
  if (session.offline) matchHud.setUnlimited(true)
  createRoomLabel(session.offline ? `${t('hud.room.offline')} · ${session.mapName} · ${t(`mode.${session.config.settings.mode}`)}` : `${t(`mode.${session.config.settings.mode}`)} · ${session.mapName} · ${session.roomName}`,
    session.offline ? null : `${location.origin}/?room=${encodeURIComponent(session.roomName)}`, () => toast(t('hud.toast.linkCopied')))
  {   // key hints on the right of the screen (under the killfeed)
    const st = session.config.settings
    const items: [string, string][] = [[t('hud.hint.quickSwitch'), 'Q'], [t('hud.hint.reload'), 'R']]
    if ((st.mode === 'infection' || st.mode === 'defense') && st.lighting === 'night') items.push([t('hud.hint.flashlight'), 'F'])
    if (st.mode === 'defense') items.push([t('hud.hint.revive'), 'E'])
    if (dropsEnabled(st.mode)) items.push([t('hud.hint.dropWeapon'), 'G'])
    keyHints.setItems(items)
  }
  if (session.offline) setupOffline(session)
  if (import.meta.env.DEV) {   // debug commands (M.8): the / key opens the command box; the server ignores them in production
    const cmdBox = createCommandBox(cmd => session.transport.send({ t: MsgType.DebugCmd, cmd }))
    document.addEventListener('keydown', e => { if (e.code === 'Slash' && !e.repeat && !cmdBox.isOpen && !teamPrompt.isOpen) { e.preventDefault(); cmdBox.open() } })
  }
  startPing(session.transport, netStats)
  session.transport.onMessage(msg => {
    if (msg.t === MsgType.HitConfirm) {
      hudRef?.showHitmarker(msg.headshot)   // only shown once the server confirms
      // Blood: the server does not send the hit point, so use the point on the ray just fired nearest the target's body/head
      const tgt = lastSampled.find(o => o.id === msg.targetId)
      if (tgt) {
        hitCenter[0] = tgt.pos[0]; hitCenter[1] = tgt.pos[1] + (msg.headshot ? 1.62 : 1.1); hitCenter[2] = tgt.pos[2]
        const t = Math.max(0, (hitCenter[0] - lastFireOrigin[0]) * lastFireDir[0] + (hitCenter[1] - lastFireOrigin[1]) * lastFireDir[1] + (hitCenter[2] - lastFireOrigin[2]) * lastFireDir[2])
        const hx = lastFireOrigin[0] + lastFireDir[0] * t, hy = lastFireOrigin[1] + lastFireDir[1] * t, hz = lastFireOrigin[2] + lastFireDir[2] * t
        const off = Math.hypot(hx - hitCenter[0], hy - hitCenter[1], hz - hitCenter[2])
        if (off < 0.5) { hitCenter[0] = hx; hitCenter[1] = hy; hitCenter[2] = hz }
        blood.spawn(hitCenter, lastFireDir, msg.headshot)
      }
      playHit(msg.headshot ? 'head' : 'body')
      if (isZombieMode(session.config.settings.mode)) {   // floating damage numbers + zombie health bar (health is large, so you need to see how much you deal)
        zoverlay.onHit(msg.targetId)
        if (tgt) playZombieHurt(msg.targetId, [tgt.pos[0], tgt.pos[1] + 1.3, tgt.pos[2]])
        if (tgt && msg.damage > 0) zoverlay.floatDamage([tgt.pos[0], tgt.pos[1] + (msg.headshot ? 1.9 : 1.4), tgt.pos[2]], msg.damage, msg.headshot)
      }
    } else if (msg.t === MsgType.ShotFx) {
      const ray = (dir: [number, number, number], dist: number) => {
        tracers.add(msg.origin, dir, dist)
        // The server only sends the ray end point; raycast the map again: if the ray stops exactly at a wall it leaves a bullet mark, if it hit a player it does not
        const wh = worldRef?.castRay(msg.origin, dir, dist + HOLE_EPS)
        if (wh && wh.dist >= dist - HOLE_EPS) {
          hudRef?.addBulletHole([msg.origin[0] + dir[0] * wh.dist, msg.origin[1] + dir[1] * wh.dist, msg.origin[2] + dir[2] * wh.dist], wh.normal)
        } else if (dist < (WEAPONS[msg.weapon]?.range ?? 0) - 0.5) {
          // A ray ending in mid-air before the range = hit a player. Ignore if it hit ourselves (point right next to the camera)
          const hx = msg.origin[0] + dir[0] * dist, hy = msg.origin[1] + dir[1] * dist, hz = msg.origin[2] + dir[2] * dist
          if (Math.hypot(hx - camera.position.x, hy - camera.position.y, hz - camera.position.z) > 1.2) blood.spawn([hx, hy, hz], dir, false)
        }
      }
      if (!WEAPONS[msg.weapon]?.melee) {   // knife: no tracer/muzzle flash, only a swing sound
        ray(msg.dir, msg.dist)
        if (msg.extra) for (const e of msg.extra) ray(e.dir, e.dist)
        playersRenderer.muzzleFlash(msg.shooterId)
      } else if (msg.weapon === CLAW_ID || msg.weapon === CLAW_HEAVY_ID) {
        playersRenderer.zombieAttack(msg.shooterId, msg.weapon === CLAW_HEAVY_ID)
      }
      playShotOther(msg.weapon, msg.origin)
    } else if (msg.t === MsgType.DebugShot) {
      debugShots.add(msg.origin, msg.dir, msg.boxes)
    } else if (msg.t === MsgType.Kill) {
      playersRenderer.markKill(msg.victimId, msg.headshot)
      const name = (id: number) => session.names.get(id) ?? `#${id}`
      const me = session.yourId
      killfeed.add(name(msg.killerId), WEAPONS[msg.weapon] ? weaponLabel(WEAPONS[msg.weapon]!.key, WEAPONS[msg.weapon]!.name) : '?', name(msg.victimId), msg.headshot,
        msg.killerId === me, msg.victimId === me, msg.reward)
      if (msg.killerId === me && msg.victimId !== me) {
        playHit(msg.headshot ? 'killHead' : 'kill')
        if (msg.victimStreak >= ECONOMY.bountyStreak) {   // killed a wanted player
          bountyBanner.show(name(msg.victimId), msg.victimStreak)
          playBuyOk()
        }
      }
      if (msg.victimId === me) {
        dead = true
        deadAt = performance.now()
        setDead(true)
        deathScreen.show(msg.killerId === me ? '' : name(msg.killerId), matchHud.mode === 'elimination' ? -1 : (matchHud.mode === 'infection' ? INFECTION.zombieRespawnMs : RESPAWN_DELAY_MS) - clock.oneWayMs)
      }
    } else if (msg.t === MsgType.GrenadeSpawn) {
      // serverTime of tick 0 is derived from the snapshot (serverTime = start + tick·TICK_MS); with no snapshot yet use the estimated server time
      const origin = snapStore && snapStore.serverTime > 0 ? snapStore.serverTime - snapStore.tick * 1000 / TICK_RATE : clock.serverNow() - msg.spawnTick * 1000 / TICK_RATE
      grenades.onSpawn(msg, origin, session.yourId, session.teams.get(msg.ownerId) ?? 'A')
    } else if (msg.t === MsgType.GrenadeAnim) {
      const who = lastSampled.find(o => o.id === msg.playerId)
      if (who && msg.playerId !== session.yourId) {   // other players' sounds (the pin is only audible when close)
        if (msg.phase === 'pulling') playPin([who.pos[0], who.pos[1] + 1.4, who.pos[2]])
        else if (msg.phase === 'throw') playThrowSwish([who.pos[0], who.pos[1] + 1.4, who.pos[2]])
      }
      if (msg.playerId !== session.yourId || poseEditor.orbitOn) playersRenderer.grenadeAnim(msg.playerId, msg.phase, msg.mode)   // our own is only shown in F10
    } else if (msg.t === MsgType.GrenadeExplode) {
      grenades.onExplode(msg)
    } else if (msg.t === MsgType.WeaponDropSpawn) {
      const origin = snapStore && snapStore.serverTime > 0 ? snapStore.serverTime - snapStore.tick * 1000 / TICK_RATE : clock.serverNow() - msg.spawnTick * 1000 / TICK_RATE   // as for grenades: serverTime of tick 0
      weaponDrops.onSpawn(msg, origin, session.yourId)
    } else if (msg.t === MsgType.WeaponDropRemove) {
      weaponDrops.onRemove(msg)
    } else if (msg.t === MsgType.HoldSlot) {
      setWantedWeapon(msg.slot)   // the server changed the weapon we hold (drop / pickup): the next cmd must carry that slot or the number keys would think it is already selected
    } else if (msg.t === MsgType.Respawn && msg.id === session.yourId) {
      // Respawn: teleport (no smoothing), full ammo, look along the spawn direction
      dead = false
      setDead(false)
      deathScreen.hide()
      spectator.reset(); spectatingId = -2
      prediction?.teleport({
        pos: [msg.pos[0], msg.pos[1], msg.pos[2]], vel: [0, 0, 0], yaw: msg.yaw, pitch: 0,
        grounded: false, crouching: false, slideTimer: 0, slideCooldown: 0, adsT: 0,
      })
      setLook(msg.yaw, 0)
      // Dying loses purchased weapons: back to the team default loadout, hold the rifle (the server does the same; the next snapshot will match)
      const ids = loadoutWeaponIds(defaultLoadout(session.teams.get(session.yourId) ?? 'A'))
      for (let i = 0; i < ids.length; i++) ws.slots[i] = ids[i]!
      ws.slot = DEFAULT_SLOT; ws.current = ids[DEFAULT_SLOT]!
      setWantedWeapon(DEFAULT_SLOT)
      for (const w of WEAPONS) ws.ammo[w.id] = magSizeOf(w, ws.magMult)
      ws.reloadEndMs = 0; ws.nextFireMs = 0; ws.triggerHeld = false
      ws.nade.phase = 'idle'; ws.nade.quick = false; ws.quickHeld = false; ws.cycleHeld = false; ws.switchBackAtMs = 0
      cancelReload()
    } else if (msg.t === MsgType.MatchState) {
      matchHud.setMatch(msg)
      zombieHud.setMatch(msg)
      setMatchPhase(msg.phase)
      matchPhaseNow = msg.phase
      sideSwapped = msg.sideSwapped
      buyEndsAt = msg.buyEndsAt
    } else if (msg.t === MsgType.RoundEnd) {
      matchHud.onRoundEnd(msg, session.teams.get(session.yourId))
      zombieHud.onRoundEnd(msg)
    } else if (msg.t === MsgType.RoundReset) {
      // New round: clear flying grenades, scorch marks, tracers, blood
      grenades.clear(); weaponDrops.clear(); explosionFx.clear(); smokeFx.clear(); blood.clear()
    } else if (msg.t === MsgType.MatchEnd) {
      matchHud.onMatchEnd(msg, msg.mvpId !== null ? session.names.get(msg.mvpId) ?? '' : '')
      zombieHud.onMatchEnd(msg, msg.mvpId !== null ? session.names.get(msg.mvpId) ?? '' : '')
    } else if (msg.t === MsgType.Infected) {
      zombieHud.onInfected(msg, id => session.names.get(id) ?? `#${id}`, session.yourId)
      {   // a roar at that player's position (louder when the mother appears); if we are the one infected, roar inside our head
        const who = lastSampled.find(o => o.id === msg.playerId)
        playScream(msg.playerId === session.yourId ? null : who ? [who.pos[0], who.pos[1] + 1.5, who.pos[2]] : null, msg.kind === 'mother')
        if (msg.kind === 'infected') playInfectSting()
      }
      if (msg.kind === 'infected' && msg.byId !== null) killfeed.add(session.names.get(msg.byId) ?? `#${msg.byId}`, { icon: 'zombie' }, session.names.get(msg.playerId) ?? `#${msg.playerId}`, false, msg.byId === session.yourId, msg.playerId === session.yourId)
    } else if (msg.t === MsgType.HeroChosen) {
      zombieHud.onHero(msg, id => session.names.get(id) ?? `#${id}`, session.yourId)
    } else if (msg.t === MsgType.InfectionCount) {
      zombieHud.onCount(msg)
    } else if (msg.t === MsgType.Sniffed) {
      sniffedUntil = performance.now() + 2000
    } else if (msg.t === MsgType.DefenseState) {
      zombieHud.setDefense(msg)
      if (msg.phase !== defPhase || msg.phaseEndsAt !== defEndsAt) { if (msg.phase !== defPhase) defCuePlayed = false; defPhase = msg.phase; defEndsAt = msg.phaseEndsAt }
    } else if (msg.t === MsgType.WaveStart) {
      zombieHud.onWaveStart(msg)
    } else if (msg.t === MsgType.WaveClear) {
      zombieHud.onWaveClear(msg)
    } else if (msg.t === MsgType.DefenseEnd) {
      zombieHud.onDefenseEnd(msg, id => session.names.get(id) ?? `#${id}`)
      deathScreen.hide()
    } else if (msg.t === MsgType.Telegraph) {
      zoverlay.telegraph(msg, t => performance.now() + (t - clock.serverNow()))
    } else if (msg.t === MsgType.Scoreboard) {
      scoreboard.setRows(msg.rows, session.yourId)
    } else if (msg.t === MsgType.BuyResult) {
      shop.onBuyResult(msg.ok, msg.key)
      const def = weaponByKey(msg.key)
      if (msg.ok && def && !def.consumable) setWantedWeapon(CATEGORY_SLOT[def.category])   // the server already made us hold the weapon just bought: the next cmd carries the right slot (grenades are not auto-held)
    } else if (msg.t === MsgType.MoneyEvent) {
      matchHud.onMoney(msg.delta, msg.reason)
      if (msg.reason === 'kill' || msg.reason === 'bounty') hudRef?.bottom.floatMoney(msg.delta, msg.reason === 'bounty')
    } else if (msg.t === MsgType.Hurt && msg.fall) {
      // Fall from a height (CS style): full-screen red flash + camera kick down, pain sound in the center. The heavier the hit the stronger
      hurtIndicator.flash(FALL_FLASH_MIN + msg.damage / FALL_FLASH_DMG)
      fallPunch = Math.max(fallPunch, Math.min(FALL_PUNCH_MAX, FALL_PUNCH_MIN + msg.damage * FALL_PUNCH_PER_DMG))
      playFallHurt(msg.damage)
    } else if (msg.t === MsgType.Hurt) {
      const dx = msg.origin[0] - camera.position.x, dy = msg.origin[1] - camera.position.y, dz = msg.origin[2] - camera.position.z
      hurtIndicator.show(dx, dz, yaw)
      playHurt(dx, dy, dz)
    }
  })
  // F7: the server sends DebugShot (ray + rewound hitbox) for each of our shots
  let debugOn = false
  document.addEventListener('keydown', e => {
    if (e.code !== 'F7' || !DEBUG_KEYS) return
    e.preventDefault()
    debugOn = !debugOn
    session.transport.send({ t: MsgType.SetDebug, shots: debugOn })
  })
  snapStore = attachSnapshots(session.transport, session.yourId, s => {
    interpolator.push(s.serverTime, s.players, s.yourId)
    if (s.hp !== lastHp) { lastHp = s.hp; hudRef?.setHealth(s.hp); setHealthForAudio(s.hp) }
    hudRef?.bottom.setInfiniteMoney(infiniteMoney)
    hudRef?.bottom.setMoney(s.money)
    if (matchHud.mode === 'elimination') {   // Elimination: the server is the source of truth for alive/dead (Dead flag in the snapshot)
      const srvDead = (s.flags & NetFlag.Dead) !== 0
      if (srvDead && !dead) { dead = true; deadAt = performance.now() - 2000; setDead(true) }   // joined mid-round: spectate only
      else if (!srvDead && dead) { dead = false; setDead(false); deathScreen.hide(); spectator.reset() }   // missed the Respawn message: do not get stuck in spectate mode
    }
    {   // role (human/zombie) decides the movement config; change it before reconcile so the replay uses the right config
      const zr = (s.flags & NetFlag.Zombie) !== 0 ? (s.me?.runSpeed ?? ZOMBIE_DEFAULT_RUN_SPEED) : null
      const want = movementFor(cfg, zr !== null ? { runSpeed: zr } : null, zr !== null ? 1 : flagSpeedMul(s.flags, cfg.runSpeed))
      if (want !== selfCfg) { selfCfg = want; prediction?.setConfig(want) }
      setTransforming((s.flags & NetFlag.Transform) !== 0)
      setDowned((s.flags & NetFlag.Downed) !== 0)
    }
    if (s.self) prediction?.onSnapshot(s.ack, s.self, s.wpn)
    if (s.wpn && prediction) reconcileWeapon(ws, s.wpn, prediction.pending)
  })
  session.transport.onClose(() => {
    setNetHooks(null); snapStore = null; prediction = null
    dead = false; matchPhaseNow = MatchPhase.Playing; buyEndsAt = null; shop.close(); spectator.reset(); spectatingId = -2
    setDead(false); deathScreen.hide(); setMatchPhase(MatchPhase.Playing); matchHud.clear(); zombieHud.clear(); night.setNight(false); sessionRef = null
    interpolator.push(0, []); playersRenderer.clear(); ghosts.clear(); grenades.clear(); weaponDrops.clear(); smokeFx.clear()
  })
})
const dbgParts: SpreadParts = { base: 0, move: 0, air: 0, bloom: 0, mult: 1, total: 0 }
const updateDebug = initDebugOverlay(netStats, () => snapStore, () => prediction, () => {
  const d = WEAPONS[ws.current]!
  const p = spreadParts(dbgParts, currentState(), ws, d, cfg, simMs)
  return [`spread ${p.total.toFixed(2)}° = base ${p.base.toFixed(2)} + move ${p.move.toFixed(2)} + air ${p.air.toFixed(2)} + bloom ${p.bloom.toFixed(2)}${p.mult !== 1 ? ` × ads ${p.mult.toFixed(2)}` : ''}`]
})
initTuningPanel(cfg)

let debugLines: THREE.LineSegments | null = null

// The default map's world starts building while the player is still in the lobby (Rapier wasm init is the slow part), so the usual case does not wait after joining.
const defaultWorldP = createWorld(loadedMap, cfg.standHeight, cfg.crouchHeight, cfg.radius)
// The room's map (from Welcome) replaces the lobby backdrop, then the physics world is built from it. No session = client-only fallback on the default map.
sessionP.then(session => {
  const id = session?.mapId
  const file = id && id !== DEFAULT_MAP_ID ? MAPS[id] : undefined
  if (id && id !== DEFAULT_MAP_ID && !file) console.warn(`[map] the server uses map "${id}" which this client does not have; keeping "${loadedMap.name}" (collisions will not match)`)
  if (!file) return defaultWorldP
  showMap(loadMap(file))
  void defaultWorldP.then(w => w.dispose())
  return createWorld(loadedMap, cfg.standHeight, cfg.crouchHeight, cfg.radius)
}).then(world => {
  worldRef = world
  const spawn = loadedMap.spawns.A[0] ?? { pos: [0, 2, 0] as [number,number,number], yaw: 0 }
  // Debug wireframe (F4)
  const { vertices, colors } = world.debugRender()
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
  geo.setAttribute('color',    new THREE.BufferAttribute(colors, 4))
  debugLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true }))
  debugLines.visible = false
  scene.add(debugLines)

  initGameState(spawn.pos, spawn.yaw)

  // Online: prediction holds the state; the loop only sends cmds + runs the prediction
  sessionP.then(session => {
    if (!session) return
    const pred = new Prediction(world, cfg, currentState())
    prediction = pred
    setNetHooks({
      current: () => pred.predicted,
      step: cmd => {
        if (cmd.buttons & Btn.Fire) cmd.fireRenderTime = interp.currentRenderTime   // 4.3: the server rewinds hitboxes to here
        session.transport.send({ t: MsgType.Inputs, cmds: [cmd] })
        return pred.step(cmd, moveSpeedMul(ws), adsMoveFor(ws), adsWanted(ws, cmd.buttons, cmd.seq * 1000 / TICK_RATE))   // speed of the weapon held before this cmd, like the server
      },
      visualOffset: () => pred.decayOffset(),
    })
  })

  // Bia + HUD
  const dummies = new URLSearchParams(location.search).has('dummies')
  const targets = dummies ? createTargets(scene) : []   // shooting dummies: only with ?dummies=1
  const boards = dummies ? createBoards(scene) : []   // shooting-range boards 10/20/40m; Shift+R clears bullet marks
  if (dummies) document.addEventListener('keydown', e => { if (e.code === 'KeyR' && e.shiftKey) hudRef?.clearBulletHoles() })
  const hud     = initHUD(scene)
  hudRef = hud
  if (isTouchControls()) hud.bottom.onSlotTap(d => pressNumberKey(d + 1))   // the weapon bar is the touch version of the number keys 1-4

  let eyeY   = cfg.eyeStand
  const scopeOverlay = createScope()
  let lastMs = performance.now()

  hud.setHealth(100)
  hud.bottom.setMoneyVisible(false)   // offline has no money; online shows it on joining a room (below)
  sessionP.then(session => { hud.bottom.setMoneyVisible(!!session) })

  startLoop(world, cfg, state => {
    const now  = performance.now()
    const dt   = (now - lastMs) / 1000
    const fps  = 1 / dt
    lastMs     = now

    const targetEye = state.crouching ? selfCfg.eyeCrouch : selfCfg.eyeStand
    eyeY += (targetEye - eyeY) * Math.min(1, 10 / 60)

    camera.position.set(state.pos[0], state.pos[1] + eyeY, state.pos[2])
    applyCameraRotation(camera)
    // Recoil is only added to the displayed camera, it does not touch the mouse yaw/pitch
    // (recView chases rec exponentially so the camera kicks smoothly instead of snapping; bullet direction still uses the real rec)
    const recK = 1 - Math.exp(-dt / RECOIL_VIEW_TAU)
    recView.pitch += (rec.pitch - recView.pitch) * recK
    recView.yaw += (rec.yaw - recView.yaw) * recK
    camera.rotation.y += recView.yaw
    camera.rotation.x += recView.pitch
    if (fallPunch > 1e-4) { fallPunch *= Math.exp(-dt / FALL_PUNCH_TAU); camera.rotation.x -= fallPunch } else fallPunch = 0
    smokeFx.update(dt, camera.position)
    explosionFx.update(dt)   // only the main camera shakes (the viewmodel has its own camera so it does not shake hard)
    camera.position.x += explosionFx.shake.x; camera.position.y += explosionFx.shake.y
    camera.rotation.z += explosionFx.shake.rot
    updateListener(camera.position.x, camera.position.y, camera.position.z, camera.rotation.y, camera.rotation.x)

    const def   = WEAPONS[ws.current]!
    const speed = Math.hypot(state.vel[0], state.vel[2])

    // ADS: adsT (movement state, same on client and server) drives the FOV, viewmodel and crosshair. The mouse wheel always switches weapon slots
    const ads = def.ads
    const adsT = ads && vm.currentWeapon === ws.current ? state.adsT : 0
    const wheel = consumeWheel()
    if (wheel !== 0) cycleSlot(Math.sign(wheel))
    const fovTarget = ads ? BASE_FOV * (1 + (ads.fovMult - 1) * adsT) : BASE_FOV
    if (Math.abs(camera.fov - fovTarget) > 0.01) {
      camera.fov = fovTarget
      camera.updateProjectionMatrix()
    }
    // The deeper the zoom, the slower the mouse (same rotation angle on screen)
    setSensScale(Math.tan(camera.fov * Math.PI / 360) / Math.tan(BASE_FOV * Math.PI / 360))
    vm.setAim(adsT, !!ads?.scope)
    const scoped = !!ads?.scope && adsT > 0.9
    scopeOverlay.setVisible(scoped)
    hud.setCrosshairVisible(!scoped && spectatingId === -2)
    hud.setCrosshairDynamic(audioSettings.dynamicCrosshair)
    hud.setCrosshairFade(adsT)   // fully scoped: the HUD crosshair fades out completely (looking through the sights)
    hud.setCrosshairFov(camera.fov)

    // The viewmodel follows the weapon held by the logic (ws.current), whether switched by key, wheel, purchase or respawn
    if (vm.targetWeapon !== ws.current && vm.switchWeapon(ws.current)) { cancelReload(); playDraw(ws.current) }
    if (ws.slot !== seenSlot) { prevSlot = seenSlot; seenSlot = ws.slot }
    for (let i = 0; i < SLOT_COUNT; i++) { const id = ws.slots[i]!; slotKeysBuf[i] = id >= 0 ? WEAPONS[id]!.key : null }
    {   // warning for nearby enemy/own grenades (teammates ignored)
      const myId = sessionRef?.yourId ?? -1, myT = sessionRef?.teams.get(myId)
      nadeWarn.update(dt, camera.position, yaw, grenades.list(), g => g.pos,
        g => dead || g.kind === 'smoke' || (g.ownerId !== myId && !!myT && sessionRef?.teams.get(g.ownerId) === myT))
    }
    slotCountsBuf[GRENADE_SLOT] = slotKeysBuf[GRENADE_SLOT] ? (ws.ammo[ws.slots[GRENADE_SLOT]!] ?? 0) : null   // count of the selected type
    hud.bottom.setSlots(slotKeysBuf, ws.slot, slotCountsBuf)
    shop.tick()

    vm.setMotion(speed, state.grounded)
    vm.setReload(ws.reloadEndMs > 0 && def.reloadMs > 0 ? 1 - (ws.reloadEndMs - simMs) / def.reloadMs : -1)
    {   // grenade: phase + pin-pull progress for the viewmodel
      const n = ws.nade
      const pull = n.phase === 'ready' ? 1 : n.phase === 'pulling' ? Math.min(1, Math.max(0, (simMs - n.pressSeq * 1000 / TICK_RATE) / GRENADE.pinPullMs)) : 0
      vm.setGrenade(n.phase === 'idle' ? 'idle' : n.phase === 'pulling' ? 'pulling' : 'ready', n.mode, pull, (ws.ammo[ws.current] ?? 0) > 0)
    }
    hud.setSpread(computeSpreadDeg(state, ws, def, selfCfg, simMs), dt * 1000, def.spread.pelletConeDeg ?? 0, def.spread.unscopedDeg !== undefined && adsT < 0.5)   // same function as when firing (current bloom)
    hud.setAmmo(def.name, ws.ammo[def.id]!, magSizeOf(def, ws.magMult), ws.reloadEndMs > 0, !!def.melee, !!def.consumable, !!economyFor(sessionRef?.config.settings.mode ?? 'tdm').infiniteReserve)
    {   // Zombie: big health bar + the E ability replace the weapon slots
      const me = snapStore?.me
      const zomb = !!me && ((snapStore!.flags & NetFlag.Zombie) !== 0)
      const inf = sessionRef?.config.settings.mode === 'infection'
      zombieHud.setSelf({ zombie: zomb, hp: snapStore?.hp ?? 0, hpMax: me?.hpMax ?? 1, leapCdMs: (state.leapCd ?? 0) * 1000, leapMaxMs: ZOMBIE.leap.cooldownMs, ...(inf ? { sniffCdMs: me?.sniffCd ?? 0, sniffMaxMs: INFECTION.sniff.cooldownMs } : null) })
      if (zomb && (state.leapCd ?? 0) > prevLeapCd + 1) playScream(null)   // E leap ability: roar
      prevLeapCd = state.leapCd ?? 0
      if (zomb !== zombieSelf) { zombieSelf = zomb; hud.bottom.setVisible(!zomb && hudShown) }
    }

    updateTargets(targets, dt)
    const myTeamNow = sessionRef?.teams.get(sessionRef.yourId) ?? 'A'
    vm.setBlockArms(sessionRef?.characterSet === 'robot')
    vm.setSkin(skinOfSet(sessionRef?.characterSet || DEFAULT_CHARACTER_SET) ?? 'copsTerrorists')
    if (myTeamNow !== vmTeam) { vmTeam = myTeamNow; vm.setTeam(myTeamNow) }
    poseEditor.tick(dt)
    vm.update(dt)
    hud.tick(dt * 1000)

    {   // Elimination: after dying, spectate a living teammate after 2 seconds (enemies cannot be spectated); with nobody left, a flying camera overhead
      const sess = sessionRef
      const specNow = !!sess && dead && matchHud.mode === 'elimination' && matchPhaseNow !== MatchPhase.Waiting && performance.now() - deadAt >= 2000
      if (specNow) {
        const myT = sess.teams.get(sess.yourId)
        specBuf.length = 0
        for (const o of lastSampled) if (o.id !== sess.yourId && sess.teams.get(o.id) === myT && (o.flags & NetFlag.Dead) === 0) specBuf.push(o)
        spectatingId = spectator.apply(camera, specBuf, dt, performance.now())
        deathScreen.hide()
        const tgt = snapStore?.players.find(p => p.id === spectatingId)
        specLabel.set(spectatingId >= 0 ? sess.names.get(spectatingId) ?? `#${spectatingId}` : null, tgt?.hp ?? 0)
      } else { spectatingId = -2; specLabel.set(undefined, 0) }   // always hide the label (text de-duplication exists): respawn sets spectatingId directly, so we cannot rely on it changing
      const showHud = spectatingId === -2
      if (showHud !== hudShown) { hudShown = showHud; hud.bottom.setVisible(showHud && !zombieSelf) }
      if (sess) {
        let na = 0, nb = 0
        for (const t of sess.teams.values()) { if (t === 'A') na++; else nb++ }
        matchHud.setTeamSizes(na, nb)
      }
      const now = clock.serverNow()
      const inBuyPhase = matchPhaseNow === MatchPhase.Freeze || matchPhaseNow === MatchPhase.Playing || matchPhaseNow === MatchPhase.RoundEnd
      shop.setBuyLeft(buyEndsAt !== null && inBuyPhase && !dead && now < buyEndsAt ? buyEndsAt - now : null)
    }
    sky.update(camera.position)
    renderer.clear()
    if (poseEditor.orbitOn) poseEditor.applyOrbit(camera, state.pos[0], state.pos[1], state.pos[2])   // F10: camera orbiting ourselves
    renderer.render(scene, camera)
    renderer.clearDepth()
    if (!poseEditor.orbitOn && spectatingId === -2) renderer.render(vm.scene, vm.cam)

    // Other players: drawn with a delay (INTERP_DELAY_MS + one-way latency) by interpolation; before joining a room the list is empty
    if (snapStore) ghosts.update(snapStore.players, snapStore.yourId)
    if (poseEditor.orbitOn) {
      // F10: also build our own 3rd-person model (normally not drawn) with the weapon held
      const others = snapStore ? interpolator.sample(clock.serverNow(), interpDelay.update(clock.oneWayMs)) : []
      selfDebug.id = playerId; selfDebug.pos = state.pos; selfDebug.yaw = state.yaw; selfDebug.pitch = state.pitch
      selfDebug.flags = (state.grounded ? NetFlag.Grounded : 0) | (state.crouching ? NetFlag.Crouching : 0) | (state.slideTimer > 0 ? NetFlag.Sliding : 0)
      selfDebug.weapon = ws.current
      selfDebug.adsT = state.adsT
      playersRenderer.update([...others.filter(o => o.id !== playerId), selfDebug], -1)
    } else if (snapStore) {
      lastSampled = interpolator.sample(clock.serverNow(), interpDelay.update(clock.oneWayMs))
      playersRenderer.update(lastSampled)
    }
    night.setZombieVision(zombieSelf)
    if ((defPhase === 'prep' || defPhase === 'intermission') && !defCuePlayed && defEndsAt - clock.serverNow() < 5000 && defEndsAt > 0) { defCuePlayed = true; playScream([27, 2, (Math.random() - 0.5) * 30], true) }   // a distant roar echoing from the side the zombies will come from
    if (night.night) startNightAmbient(); else stopNightAmbient()   // night ambience: wind + insects (no-op until audio is ready)
    if (snapStore && isZombieMode(sessionRef?.config.settings.mode ?? 'tdm')) {
      const fw = camera.getWorldDirection(camDir)
      updateZombieAudio(dt, lastSampled, [fw.x, fw.y, fw.z])
    }
    if (snapStore && isZombieMode(sessionRef?.config.settings.mode ?? 'tdm')) zoverlay.update(dt, lastSampled, playerId, camera)
    zombieWorldHud(state, dt)
    setFlashlightAllowed(night.night && !zombieSelf)
    {   // touch action buttons (plan 19): E is the zombie leap, or reviving a downed teammate in Defense; sniff is the Infection zombie's
      const mode = sessionRef?.config.settings.mode
      touchCtx.live = !dead && spectatingId === -2
      touchCtx.human = !zombieSelf
      touchCtx.ability = zombieSelf ? 'leap' : mode === 'defense' ? 'revive' : 'none'
      touchCtx.sniff = zombieSelf && mode === 'infection'
      touchCtx.flashlight = night.night && !zombieSelf
      touchCtx.drops = mode !== undefined && dropsEnabled(mode)
      { const ab = abilitiesOf(WEAPONS[ws.current]!); touchCtx.canAim = ab.aim; touchCtx.canReload = ab.reload; touchCtx.canDrop = ab.drop; touchCtx.canGrenade = (ws.slots[GRENADE_SLOT] ?? -1) >= 0 && (ws.slot !== GRENADE_SLOT || ws.nade.phase !== 'idle') }   // a throw in progress (the button itself switched us to the grenade) must keep the button enabled, or it would let go of your finger   // dim the buttons the held weapon cannot use (knife: no zoom, reload, drop)
      setTouchContext(touchCtx)
    }
    keyHints.setHidden(zombieSelf || isTouchControls())   // key hints ("Quick switch (Q)"...) mean nothing on a phone
    night.update(camera, flashlightOn() && !dead && spectatingId === -2, lastSampled)
    grenades.update(dt, interp.currentRenderTime > 0 ? interp.currentRenderTime : clock.serverNow(), netStats.rttMs)
    weaponDrops.update(dt, interp.currentRenderTime > 0 ? interp.currentRenderTime : clock.serverNow(), clock.serverNow())
    pickupPrompt(sessionRef && !dead && !zombieSelf && spectatingId === -2 ? pickupLabel(weaponDrops.nearest(currentState().pos, sessionRef.yourId)) : null)
    tracers.update(dt * 1000)
    blood.update(dt)
    debugShots.update(dt * 1000)
    deathScreen.tick()
    matchHud.tick(clock.serverNow())
    zombieHud.tick(clock.serverNow())
    scoreboard.show(tabHeld || scoreToggle || (snapStore !== null && matchHud.phase === MatchPhase.Ended && matchHud.mode !== 'defense'))   // Defense: has its own stats screen (hudZombie)
    hurtIndicator.tick(dt * 1000)
    clock.tick()
    updateDebug(state, fps)
  }, (state, cmd, nowMs) => {
    // Every simulation tick: weapon logic + footsteps
    simMs = nowMs
    const def    = WEAPONS[ws.current]!
    const speed  = Math.hypot(state.vel[0], state.vel[2])

    const ev = stepWeaponCmd(ws, cmd)
    if (ev === 'fired') {
      const pellets = computeShotDirs(shotDirs, rec, def, playerId, ws.shotSeq - 1, cmd.yaw, cmd.pitch, computeSpreadDeg(state, ws, def, selfCfg, nowMs, true))
      vm.onFire(def.melee)
      lastFireDir[0] = shotDirs[0]![0]; lastFireDir[1] = shotDirs[0]![1]; lastFireDir[2] = shotDirs[0]![2]   // for the blood hit point when HitConfirm arrives
      playShot(def.id, ws.ammo[def.id]!)

      eyeTmp[0] = state.pos[0]; eyeTmp[1] = state.pos[1] + eyeY; eyeTmp[2] = state.pos[2]
      lastFireOrigin[0] = eyeTmp[0]; lastFireOrigin[1] = eyeTmp[1]; lastFireOrigin[2] = eyeTmp[2]
      let hitHead = false, hitBody = false
      for (let k = 0; k < pellets; k++) {
        const result = fireHitscan(eyeTmp, shotDirs[k]!, def.range, world, cfg, targets)
        if (result?.kind === 'target') {
          flashTarget(targets[result.idx]!)
          hitCenter[0] = eyeTmp[0] + shotDirs[k]![0] * result.dist; hitCenter[1] = eyeTmp[1] + shotDirs[k]![1] * result.dist; hitCenter[2] = eyeTmp[2] + shotDirs[k]![2] * result.dist
          blood.spawn(hitCenter, shotDirs[k]!, result.part === 'head')
          if (result.part === 'head') hitHead = true; else hitBody = true
        } else if (!def.melee) {
          const wallDist = result?.kind === 'wall' ? result.dist : def.range
          const bh = boards.length ? rayBoards(eyeTmp, shotDirs[k]!, boards, wallDist) : null
          if (bh) hud.addBulletHole(bh.point, bh.normal)
          else if (result?.kind === 'wall') hud.addBulletHole(result.hitPos, result.normal)
        }
      }
      if (hitHead || hitBody) {   // one hitmarker + one sound per shot
        hud.showHitmarker(hitHead)
        playHit(hitHead ? 'head' : 'body')
      }
    } else if (ev === 'dry') {
      playDry(def.id)
      startReload(def.id, 0, def.reloadMs)   // out of ammo: click then auto-reload
    } else if (ev === 'reloadStart') {
      startReload(def.id, ws.ammo[def.id]!, def.reloadMs)
    }
    if (ev === 'switched' || ev === 'pull') {
      // A switch made by the logic (auto back to the old weapon after a throw, G): take the current slot as the wanted slot so the number keys/Q keep working
      if (ws.slot !== wantedWeapon()) setWantedWeapon(ws.slot)
    }
    if (ev === 'pull') playPin()   // pin pull: only we hear it
    if (ev === 'threw') {
      playThrowSwish()
      // Throw prediction: our own grenade flies immediately (without waiting for the server); the server confirms with throwSeq
      const t = throwInitial(state, ws.nade.mode, world, cfg)
      vm.onGrenadeThrow()
      grenades.spawnLocal(ws.throwSeq, playerId, sessionRef?.teams.get(playerId) ?? 'A', t.pos, t.vel, ws.nade.mode, WEAPONS[ws.current]!.key)
    }
    recoverRecoil(rec, def, ws, nowMs, DT)

    const stepEv = steps.update(
      state.grounded, state.vel[1], speed, state.slideTimer > 0, DT,
      FOOTSTEPS.stepDistM, FOOTSTEPS.landing.minFallSpeed, FOOTSTEPS.minSpeed,
    )
    if (stepEv === 'step') playFootstep(state.crouching)
    else if (stepEv === 'land') playLanding()
  })
})
