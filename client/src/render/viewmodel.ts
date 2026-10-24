import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { TeamId } from "@fps/shared";
import { BlockArm } from "./blockArm";
import { FpArms } from "./fpArms";
import type { SkinId } from "./characterRig";
import { GrenadeAnim, pathSegment, type LogicPhase } from "./grenadeAnim";
import { GRENADE_ID, SMOKE_ID, isGrenadeId } from "@fps/shared";
import { tintSmoke } from "./nadeTint";
import { poses, weaponPose, armsOf, getAnchor, scanModelAnchors, onPosesChange, colorOf, type Vec3 } from "./poses";

// ── Constants ────────────────────────────────────────────────────────────────────
const GUN_DEFAULT_POS = new THREE.Vector3(0.28, -0.3, -0.45);
const GUN_HIDDEN_Y = -0.55;
const ANIM_HALF = 0.15; // 0.15 s each way

// ── Viewmodel effects (purely visual) ────────────────────────────────────────
const KICK_BACK = 0.04; // gun recoils 4cm
const KICK_PITCH = (3 * Math.PI) / 180; // muzzle tilts up 3°
const KICK_TAU = 0.03; // recovery time constant (~80ms to near 0)
// Knife slash (melee only): the whole hold (knife + hand) swings about the right ELBOW (taken from the arm when the slash starts), so the hand sweeps an arc at a
// nearly constant distance from the shoulder and the arm never has to stretch or flip: wind up (hand up and out, blade tilted back), sweep diagonally across to the
// left and down, follow through, recover. Keys: [t 0..1, x, y, z (m, camera space: a small lunge), pitch, yaw, roll (deg, camera axes, rotation about the elbow)].
// pitch + = hand up, yaw + = hand to the left. Interpolated with a Catmull-Rom spline so the hand does not stop at every key.
const SWING_S = 0.34; // total slash time, shorter than the knife's fireIntervalMs so it is finished before the next one
const SWING_KEYS: readonly (readonly number[])[] = [
  [0, 0, 0, 0, 0, 0, 0],
  [0.28, 0, 0, 0.02, 9, -7, -10],
  [0.46, 0, 0, -0.03, 2, 3, 2],
  [0.64, 0, 0, -0.06, -8, 18, 12],
  [0.82, 0, 0, -0.02, -3, 7, 4],
  [1, 0, 0, 0, 0, 0, 0],
];
const BOB_FREQ = 1.3; // rad per metre travelled
const BOB_AMP_X = 0.012;
const BOB_AMP_Y = 0.008;
const BOB_REF_SPEED = 8.5; // running speed: maximum amplitude
const RELOAD_DROP = 0.15; // lower by 15cm
const RELOAD_TILT = (35 * Math.PI) / 180; // tilt down 35°
const RELOAD_DOWN_END = 0.4; // lowered by 40% of the reload time
const RELOAD_UP_START = 0.8; // starts raising at 80%
// Muzzle position (gunGroup space) when the model has no 'muzzle' node - the glb compression step removed the empty
// of the colt/rouleau. Measured from the bbox + the vertex nearest the barrel tip of the compressed glb itself (by gun id).
export const MUZZLE_FALLBACK: THREE.Vector3[] = [
  new THREE.Vector3(0, 0.096, -0.63), // AK47 (matches the muzzle node)
  new THREE.Vector3(0, 0.111, -0.628), // M16 (matches the muzzle node)
  new THREE.Vector3(0, 0.093, -0.244), // COLT
  new THREE.Vector3(0, 0.078, -0.287), // ROULEAU
  new THREE.Vector3(0, 0.0495, -0.927), // SNIPER (matches the muzzle node)
  new THREE.Vector3(0, 0.06, -0.705), // SHOTGUN (the glb has no muzzle node: barrel tip measured from the geometry)
  new THREE.Vector3(0, 0, -0.3), // KNIFE (no muzzle flash, only here to fill the array)
  new THREE.Vector3(0, 0.07, -0.35), // SMG (muzzle from the glb bbox)
];
const FLASH_SIZE = 0.14;

// ── Aiming (ADS) ─────────────────────────────────────────────────────────────────
const ADS_DIST = 0.45; // front sight is this many metres from the eye: farther = smaller gun/sight
const ADS_BOB = 0.15; // remaining gun bob while aiming (relative to normal)
// Extra gun lowering while aiming (m) so the sight frame/carry handle does not block the view (the front sight sits slightly below the centre).
// The M16 has a tall front sight + carry handle so it needs more lowering than the AK.
const ADS_DROP: Record<number, number> = { 0: 0.03 ,1: 0.1 };
const SIGHT_SLAB = 0.1; // front sight zone: 10% of the gun length measured from the muzzle
const SIGHT_HALF_W = 0.008; // only consider vertices near the centre axis (x≈0) to ignore side details

// Adjust glb models not yet normalised to the grip (the original knife_1.glb is small, ~19cm). scale/pos/rot apply to the model root.
export const MODEL_ADJUST: Record<number, { scale?: number; pos?: [number, number, number]; rotX?: number; rotY?: number; rotZ?: number }> = {
  6: { scale: 2.2, pos: [-0.02, 0.12, 0.05], rotX: 0.45 },   // dao
};
export function adjustModel(id: number, model: THREE.Object3D): void {
  const a = MODEL_ADJUST[id];
  if (!a) return;
  if (a.scale) model.scale.multiplyScalar(a.scale);
  if (a.pos) model.position.add(new THREE.Vector3(...a.pos));
  if (a.rotX) model.rotation.x += a.rotX;
  if (a.rotY) model.rotation.y += a.rotY;
  if (a.rotZ) model.rotation.z += a.rotZ;
}

export function makeFlashTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,230,1)");
  grad.addColorStop(0.35, "rgba(255,190,80,0.9)");
  grad.addColorStop(1, "rgba(255,120,20,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  // a few rays so randomly rotated sprites look different
  g.strokeStyle = "rgba(255,220,120,0.9)";
  g.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + 0.3;
    g.beginPath();
    g.moveTo(32, 32);
    g.lineTo(32 + Math.cos(a) * 31, 32 + Math.sin(a) * 31);
    g.stroke();
  }
  return new THREE.CanvasTexture(c);
}

function smooth(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

// ── Model loading parameters ────────────────────────────────────────────────────────
// Scale + rotation are already baked into the GunRoot node in the GLB -> just load, do not re-apply
const WEAPON_FILES = [
  "/models/ak47.glb",
  "/models/m16.glb",
  "/models/colt.glb",
  "/models/rouleau.glb",
  "/models/sniper.glb",
  "/models/shotgun.glb",
  "/models/knife_1.glb",
  "/models/submachine.glb",
  "/models/grenades/m67.glb",   // id 8: grenade (nodes body/spoon/pin + empties hand_r/pin_pull)
] as const;

// ── Placeholder box (used until the model has loaded) ───────────────────────────
function buildPlaceholder(id: number): THREE.Object3D {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x3c3c3c });
  if (id === 0) {
    // AK47
    g.add(
      Object.assign(
        new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.42), mat),
      ),
    );
    const barrel = new THREE.Mesh(
      new THREE.BoxGeometry(0.024, 0.022, 0.18),
      new THREE.MeshLambertMaterial({ color: 0x222 }),
    );
    barrel.position.set(0, 0.005, -0.3);
    g.add(barrel);
  } else if (id === 1) {
    // M16
    g.add(
      Object.assign(
        new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.038, 0.38), mat),
      ),
    );
    const barrel = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.02, 0.2),
      new THREE.MeshLambertMaterial({ color: 0x222 }),
    );
    barrel.position.set(0, 0.003, -0.29);
    g.add(barrel);
  } else if (id === 2) {
    // COLT
    g.add(
      Object.assign(
        new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.038, 0.38), mat),
      ),
    );
    const barrel = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.02, 0.2),
      new THREE.MeshLambertMaterial({ color: 0x222 }),
    );
    barrel.position.set(0, 0.003, -0.29);
    g.add(barrel);
  } else if (id === 3) {
    // ROULEAU
    g.add(
      Object.assign(
        new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.038, 0.38), mat),
      ),
    );
    const barrel = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.02, 0.2),
      new THREE.MeshLambertMaterial({ color: 0x222 }),
    );
    barrel.position.set(0, 0.003, -0.29);
    g.add(barrel);
  }
  return g;
}

// ── Load GLB (scale/rotation already in the GunRoot node, only disable shadows) ──────
function prepareModel(scene: THREE.Group): THREE.Group {
  scene.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = false;
      child.receiveShadow = false;
    }
  });
  return scene;
}

// Front sight vertex (gunGroup space): the highest point, near the centre axis, within the muzzle section. Used to place the gun so that
// the front sight lands exactly at the screen centre when aiming. Runs once per model at load time.
function measureSight(model: THREE.Object3D): THREE.Vector3 | null {
  model.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  let zMin = Infinity, zMax = -Infinity;
  const meshes: THREE.Mesh[] = [];
  model.traverse((o) => { if (o instanceof THREE.Mesh) meshes.push(o); });
  for (const m of meshes) {
    const p = m.geometry.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      if (v.z < zMin) zMin = v.z;
      if (v.z > zMax) zMax = v.z;
    }
  }
  if (!(zMax > zMin)) return null;
  const zLimit = zMin + (zMax - zMin) * SIGHT_SLAB;
  let best: THREE.Vector3 | null = null;
  for (const m of meshes) {
    const p = m.geometry.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      if (v.z <= zLimit && Math.abs(v.x) <= SIGHT_HALF_W && (!best || v.y > best.y)) best = best ? best.copy(v) : v.clone();
    }
  }
  return best;
}

// ── ViewmodelHandle ────────────────────────────────────────────────────────────
export interface ViewmodelHandle {
  scene: THREE.Scene;
  cam: THREE.PerspectiveCamera;
  readonly currentWeapon: number;
  /** The gun currently shown or about to be shown (differs from currentWeapon during the weapon-switch animation) */
  readonly targetWeapon: number;
  updateAspect(aspect: number): void;
  switchWeapon(id: number): boolean;
  /** Set the gun immediately, no animation (at startup) */
  snapTo(id: number): void;
  update(dt: number): void;
  /** Call on every shot: gun recoil + muzzle flash (melee: a slash, no muzzle flash) */
  onFire(melee?: boolean): void;
  /** Horizontal speed (m/s) + whether on the ground, for gun bob */
  setMotion(speed: number, grounded: boolean): void;
  /** Reload progress 0..1, or -1 when not reloading */
  setReload(progress: number): void;
  /** Aim level 0..1 (movement's adsT: already smoothed by inMs/outMs). Only has an effect while holding a gun in the idle state */
  setAim(adsT: number, scoped: boolean): void;
  /** 0 (hip) ... 1 (fully aimed) */
  readonly aimAmount: number;
  /** Sleeve colour by team */
  setTeam(team: TeamId): void;
  /** Skinned-arm skin for the room's character set (loaded on demand) */
  setSkin(skin: SkinId): void;
  /** true: use block arms instead of skinned arms (robot character set) */
  setBlockArms(v: boolean): void;
  /** Grenade: logic state each frame (phase, mode, pin-pull progress 0..1, whether a grenade remains after the throw) */
  setGrenade(phase: LogicPhase, mode: 'strong' | 'lob', pullFrac: number, hasMore: boolean): void;
  /** The grenade just left the hand (throw logic): swing the arm, the grenade in hand disappears */
  onGrenadeThrow(): void;
  /** Grenade animation phase (debug) */
  readonly grenadePhase: string;
  /** Hide both the gun and the hands (debug camera F10, death) */
  setHidden(hidden: boolean): void;
  /** For the F9 panel: hands + gun + IK solve state of the last frame */
  readonly debug: ViewmodelDebug;
}

export interface ViewmodelDebug {
  gunGroup: THREE.Group;
  armR: BlockArm;
  armL: BlockArm;
  shoulderR: THREE.Vector3;
  shoulderL: THREE.Vector3;
  /** IK targets in camera space (valid* = that hand was solved last frame) */
  targetR: THREE.Vector3;
  targetL: THREE.Vector3;
  validR: boolean;
  validL: boolean;
  /** Frozen reload progress (0..1), -1 = not forced */
  freezeReload: number;
  /** Tint the hand red when it cannot reach the gun */
  showReach: boolean;
  /** Aim point (front sight) of the held gun, in gunGroup space (multiply by gunGroup.matrix for camera space); null if not measured yet */
  sight: THREE.Vector3 | null;
}

export function createViewmodel(aspect: number): ViewmodelHandle {
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(60, aspect, 0.01, 20);

  cam.fov = poses.first.fov;
  cam.updateProjectionMatrix();
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x4a4036, 0.9));
  const dl = new THREE.DirectionalLight(0xffffff, 1.0);
  dl.position.set(1, 2, 1);
  scene.add(dl);

  const gunGroup = new THREE.Group();
  gunGroup.position.copy(GUN_DEFAULT_POS);
  scene.add(gunGroup);

  // ── Two block arms ─────────────────────────────────────────────────
  // Shoulders stay fixed in camera space; effects (bob, recoil, lowering, reload) apply only to the gun, and the IK hands follow the two anchor points.
  let sleeve = colorOf(poses.style.sleeveColor.A);
  const skin = colorOf(poses.style.skinColor);
  const armR = new BlockArm(() => poses.style.first, sleeve, skin);
  const armL = new BlockArm(() => poses.style.first, sleeve, skin);
  scene.add(armR.root, armL.root);
  // Hands from the character model (C.6): once available they replace the block arms; the block arms still solve IK (hidden) for the F9 panel and as a fallback when the glb fails to load
  const fp = new FpArms();
  scene.add(fp.root);
  fp.setSkin('copsTerrorists');   // default set; main.ts switches it to the room's character set
  let blockArms = false;   // blocky character set (robot): the viewmodel arms are block arms too
  const fpActive = () => fp.ready && !blockArms;
  const shoulderR = new THREE.Vector3(), shoulderL = new THREE.Vector3();
  const poleR = new THREE.Vector3(), poleL = new THREE.Vector3();
  const targetR = new THREE.Vector3(), targetL = new THREE.Vector3();
  const _a = new THREE.Vector3(), _b = new THREE.Vector3();
  let hidden = false;
  const _off = new THREE.Vector3();
  const DEG = Math.PI / 180;
  // The magazine follows the left hand between magDetachT..magAttachT (only when the model has a mesh named 'mag'; the current glbs have none)
  let magHeld: { mesh: THREE.Object3D; parent: THREE.Object3D; weapon: number; pos: THREE.Vector3; quat: THREE.Quaternion; scale: THREE.Vector3 } | null = null;
  function restoreMag(): void {
    if (!magHeld) return;
    const h = magHeld;
    h.parent.add(h.mesh);
    h.mesh.position.copy(h.pos); h.mesh.quaternion.copy(h.quat); h.mesh.scale.copy(h.scale);
    magHeld = null;
  }
  function updateMag(rp: number): void {
    const rl = poses.reloadLeftHand;
    const want = rp >= rl.magDetachT && rp < rl.magAttachT && dbg.validL;
    if (magHeld && (!want || magHeld.weapon !== currentWeapon)) restoreMag();
    if (!want || magHeld) return;
    const mesh = currentMesh.getObjectByName("mag");
    if (!mesh || !mesh.parent) return;
    magHeld = { mesh, parent: mesh.parent, weapon: currentWeapon, pos: mesh.position.clone(), quat: mesh.quaternion.clone(), scale: mesh.scale.clone() };
    (fpActive() ? fp.leftHand()! : armL.handMesh).attach(mesh);
  }
  const dbg: ViewmodelDebug = { gunGroup, armR, armL, shoulderR, shoulderL, targetR, targetL, validR: false, validL: false, freezeReload: -1, showReach: false, sight: null };
  onPosesChange(() => { cam.fov = poses.first.fov; cam.updateProjectionMatrix(); });

  // State
  let currentWeapon = 0;
  let currentMesh: THREE.Object3D = buildPlaceholder(0);
  gunGroup.add(currentMesh);

  // Cache of loaded models
  const loaded = new Map<number, THREE.Group>();
  const sights = new Map<number, THREE.Vector3>();

  // Load both models in parallel
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder); // required for EXT_meshopt_compression
  for (let id = 0; id < WEAPON_FILES.length; id++) {
    const file = WEAPON_FILES[id]!;
    const wid = id;
    loader
      .loadAsync(file)
      .then((gltf) => {
        const model = prepareModel(gltf.scene);
        adjustModel(wid, model);
        scanModelAnchors(wid, model);
        loaded.set(wid, model);
        const sight = measureSight(model);
        if (sight) sights.set(wid, sight);
        if (wid === currentWeapon && phase === "idle") {
          gunGroup.remove(currentMesh);
          currentMesh = model;
          gunGroup.add(currentMesh);
        }
      })
      .catch((err) => console.warn(`viewmodel: cannot load ${file}`, err));
  }

  // ── Muzzle flash ─────────────────────────────────────────────────────────
  const flash = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeFlashTexture(),
      transparent: true,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  flash.scale.set(FLASH_SIZE, FLASH_SIZE, 1);
  flash.renderOrder = 10;
  flash.visible = false;
  gunGroup.add(flash);
  let flashShown = false;
  const _tmp = new THREE.Vector3();

  // Animation
  type Phase = "idle" | "down" | "up";
  let phase: Phase = "idle";
  let animT = 0;
  let pendingId = -1;
  let switchOffY = 0; // Y offset from the weapon-switch animation

  let kick = 0; // 1 right after firing, recovers to 0
  let swingT = -1; // knife slash: seconds since it started, -1 = not swinging
  const swing = [0, 0, 0, 0, 0, 0]; // current slash offset: x, y, z (m), pitch, yaw, roll (deg)
  const swingPivot = new THREE.Vector3(0.3, -0.3, -0.2); // the right elbow (camera space) when the slash started; the fallback is a typical hold
  const _swingQ = new THREE.Quaternion(), _swingE = new THREE.Euler();
  let bobPhase = 0;
  let bobAmp = 0;
  let moveSpeed = 0;
  let moveGrounded = false;
  let reloadProgress = -1;
  let aimWant = 0;   // adsT from movement
  let aimScoped = false;
  let aimT = 0;

  // ── Grenade (G.5) ──────────────────────────────────────────────────────────
  const nadeAnim = new GrenadeAnim(() => weaponPose(GRENADE_ID).first.grenade!);
  const nadeLeft = new THREE.Vector3();          // smoothed left hand (rest <-> pin ring)
  let nadeLeftInit = false;
  let pinState: "onGrenade" | "onLeftHand" | "hidden" = "onGrenade";
  let pinHome: { parent: THREE.Object3D; pos: THREE.Vector3; quat: THREE.Quaternion; scale: THREE.Vector3 } | null = null;
  function setPin(state: "onGrenade" | "onLeftHand" | "hidden"): void {
    if (state === pinState) return;
    const pin = currentMesh.getObjectByName("pin");
    if (!pin) { pinState = state; return; }
    if (state === "onLeftHand") {
      if (!pinHome) pinHome = { parent: pin.parent!, pos: pin.position.clone(), quat: pin.quaternion.clone(), scale: pin.scale.clone() };
      (fpActive() ? fp.leftHand()! : armL.handMesh).attach(pin);   // attach keeps the world position: the pin follows the left hand
      pin.visible = true;
    } else {
      if (pinHome) { pinHome.parent.add(pin); pin.position.copy(pinHome.pos); pin.quaternion.copy(pinHome.quat); pin.scale.copy(pinHome.scale); }
      pin.visible = state === "onGrenade";
    }
    pinState = state;
  }
  function nadeEnter(): void { nadeAnim.reset(); pinHome = null; pinState = "onGrenade"; nadeLeftInit = false; currentMesh.visible = true; }
  function nadeLeave(): void { setPin("onGrenade"); currentMesh.visible = true; }   // switched to another gun: put the pin back on the grenade, show the grenade again

  // Gun grip position at the hip: poses.json (first.gunPos), falling back to the old default if missing
  const _base = new THREE.Vector3();
  function basePos(id: number): THREE.Vector3 {
    const g = weaponPose(id).first.gunPos;
    return g ? _base.set(g[0], g[1], g[2]) : _base.copy(GUN_DEFAULT_POS);
  }

  let smokeMesh: THREE.Object3D | null = null;   // smoke grenade = a copy of the M67 tinted grey (built once the M67 has loaded)
  function getMesh(id: number): THREE.Object3D {
    if (id === SMOKE_ID) {
      const he = loaded.get(GRENADE_ID);
      if (he && !smokeMesh) { smokeMesh = he.clone(true); tintSmoke(smokeMesh); }
      return smokeMesh ?? buildPlaceholder(id);
    }
    return loaded.get(id) ?? buildPlaceholder(id);
  }

  function switchWeapon(id: number): boolean {
    if (id === currentWeapon && phase === "idle") return false;
    if (phase !== "idle") return false;
    pendingId = id;
    phase = "down";
    swingT = -1;   // switching away cancels a knife slash
    animT = 0;
    return true;
  }

  function snapTo(id: number) {
    currentWeapon = id;
    pendingId = id;
    phase = "idle";
    switchOffY = 0;
    swingT = -1;
    gunGroup.remove(currentMesh);
    currentMesh = getMesh(id);
    gunGroup.add(currentMesh);
    if (isGrenadeId(id)) nadeEnter();
  }

  function onFire(melee = false) {
    if (melee) {   // knife: a slash instead of the gun recoil
      swingT = 0;
      if (!(fpActive() && fp.elbowR(swingPivot))) swingPivot.copy(armR.elbowPos);
      return;
    }
    kick = 1;
    // Muzzle position in gunGroup coordinates
    const m = currentMesh.getObjectByName("muzzle");
    if (m) {
      gunGroup.updateMatrixWorld(true);
      m.getWorldPosition(_tmp);
      gunGroup.worldToLocal(_tmp);
      flash.position.copy(_tmp);
    } else {
      flash.position.copy(MUZZLE_FALLBACK[currentWeapon] ?? MUZZLE_FALLBACK[0]!);
    }
    flash.material.rotation = Math.random() * Math.PI * 2;
    flash.visible = true;
    flashShown = false;
  }

  function setMotion(speed: number, grounded: boolean) {
    moveSpeed = speed;
    moveGrounded = grounded;
  }

  function setReload(progress: number) {
    reloadProgress = progress;
  }

  function setAim(adsT: number, scoped: boolean) {
    aimWant = adsT;
    aimScoped = scoped;
  }

  function update(dt: number) {
    // Weapon switch
    if (phase === "down") {
      animT += dt;
      const t = Math.min(animT / ANIM_HALF, 1);
      switchOffY = (GUN_HIDDEN_Y - basePos(currentWeapon).y) * t;
      if (animT >= ANIM_HALF) {
        gunGroup.remove(currentMesh);
        if (isGrenadeId(currentWeapon)) nadeLeave();
        currentWeapon = pendingId;
        currentMesh = getMesh(currentWeapon);
        gunGroup.add(currentMesh);
        if (isGrenadeId(currentWeapon)) nadeEnter();
        phase = "up";
        animT = 0;
      }
    } else if (phase === "up") {
      animT += dt;
      const t = Math.min(animT / ANIM_HALF, 1);
      switchOffY = (GUN_HIDDEN_Y - basePos(currentWeapon).y) * (1 - t);
      if (animT >= ANIM_HALF) {
        switchOffY = 0;
        phase = "idle";
      }
    }

    // Recoil: decays exponentially
    kick *= Math.exp(-dt / KICK_TAU);
    if (kick < 1e-3) kick = 0;
    swing.fill(0);
    if (swingT >= 0) {
      swingT += dt;
      const u = swingT / SWING_S;
      if (u >= 1) swingT = -1;
      else {
        let i = 0;
        while (i < SWING_KEYS.length - 2 && u >= SWING_KEYS[i + 1]![0]!) i++;
        const k0 = SWING_KEYS[i]!, k1 = SWING_KEYS[i + 1]!;
        const km = SWING_KEYS[Math.max(i - 1, 0)]!, kn = SWING_KEYS[Math.min(i + 2, SWING_KEYS.length - 1)]!;
        const w = (u - k0[0]!) / (k1[0]! - k0[0]!), w2 = w * w, w3 = w2 * w;
        for (let c = 1; c < 7; c++) {   // Catmull-Rom
          const p0 = km[c]!, p1 = k0[c]!, p2 = k1[c]!, p3 = kn[c]!;
          swing[c - 1] = 0.5 * (2 * p1 + (p2 - p0) * w + (2 * p0 - 5 * p1 + 4 * p2 - p3) * w2 + (3 * p1 - p0 - 3 * p2 + p3) * w3);
        }
      }
    }

    // Figure-8 bob: x follows sin(φ), y follows sin(2φ); amplitude ∝ speed
    const wantAmp = moveGrounded ? Math.min(1, moveSpeed / BOB_REF_SPEED) : 0;
    bobAmp += (wantAmp - bobAmp) * Math.min(1, dt * 10);
    if (moveGrounded) bobPhase += moveSpeed * dt * BOB_FREQ;

    // Reload. One-handed gun / stock hug: lower + tilt down (0..40%), hold, raise (80..100%). Two-handed gun: tilts per
    // poses.json (gunTiltDeg) and the left hand follows reloadLeftHand.keys
    const pose = weaponPose(currentWeapon).first;
    const rl = poses.reloadLeftHand;
    const rp = dbg.freezeReload >= 0 ? dbg.freezeReload : reloadProgress;
    const two = pose.hold === "twoHand";
    let r = 0;
    if (rp >= 0 && !two) {
      r = rp < RELOAD_UP_START ? smooth(rp / RELOAD_DOWN_END) : 1 - smooth((rp - RELOAD_UP_START) / (1 - RELOAD_UP_START));
    }
    let tiltRoll = 0, tiltPitch = 0;
    if (rp >= 0 && two) {
      const g = rl.gunTiltDeg;
      const w = smooth((rp - g.inT) / 0.15) * (1 - smooth((rp - (g.outT - 0.15)) / 0.15));
      tiltRoll = g.roll * w * DEG; tiltPitch = g.pitch * w * DEG;
    }

    // Aim: pull the gun to the centre, gun body facing straight on, front sight on the screen centre
    aimT = phase === "idle" ? aimWant : 0;   // adsT is already smoothed (inMs/outMs), do not smooth again
    const a = smooth(aimT);
    const base = basePos(currentWeapon);
    const bx = base.x, by = base.y, bz = base.z;
    const sight = sights.get(currentWeapon);
    dbg.sight = sight ?? null;
    const adsX = sight ? -sight.x : 0;
    const adsY = sight ? -sight.y - (ADS_DROP[currentWeapon] ?? 0) : by + 0.2;
    const adsZ = sight ? -(pose.adsEyeDist ?? ADS_DIST) - sight.z : bz;
    const bob = 1 - a * (1 - ADS_BOB);   // walking bob reduced by 85% while aiming
    const kickMul = 1 - 0.5 * a;          // visual recoil (gun kick back/up) reduced by 50% while aiming
    const nadeCfg = isGrenadeId(currentWeapon) ? pose.grenade : undefined;
    const nadeOut = nadeCfg ? nadeAnim.update(dt * 1000) : null;
    if (nadeOut && nadeCfg) {
      // Grenade: position/rotation follow the pin-pull -> throw animation (grenadeAnim); weapon switch still uses switchOffY
      gunGroup.visible = !hidden;
      gunGroup.position.set(nadeOut.pos[0], nadeOut.pos[1] + switchOffY, nadeOut.pos[2]);
      gunGroup.rotation.set(nadeOut.rotDeg[0] * DEG, nadeOut.rotDeg[1] * DEG, nadeOut.rotDeg[2] * DEG);
      gunGroup.scale.setScalar(pose.scale);
      currentMesh.visible = nadeOut.show;
      setPin(nadeOut.pin);
    } else {
      gunGroup.visible = !(aimScoped && aimT > 0.6) && !hidden;
      gunGroup.position.set(
        bx + (adsX - bx) * a + Math.sin(bobPhase) * BOB_AMP_X * bobAmp * bob + swing[0]!,
        by + (adsY - by) * a + switchOffY + Math.sin(bobPhase * 2) * BOB_AMP_Y * bobAmp * bob - RELOAD_DROP * r + swing[1]!,
        bz + (adsZ - bz) * a + KICK_BACK * kick * kickMul + swing[2]!,
      );
      const hip = 1 - a;   // the poses.json gun angle fades out while aiming (gun body straight)
      gunGroup.rotation.set(
        pose.gunRotDeg[0] * DEG * hip + (pose.adsRotDeg?.[0] ?? 0) * DEG * a + KICK_PITCH * kick * kickMul - RELOAD_TILT * r + tiltPitch,
        pose.gunRotDeg[1] * DEG * hip + (pose.adsRotDeg?.[1] ?? 0) * DEG * a,
        pose.gunRotDeg[2] * DEG * hip + (pose.adsRotDeg?.[2] ?? 0) * DEG * a + tiltRoll,
      );
      gunGroup.scale.setScalar(pose.scale);
      if (swingT >= 0) {   // knife slash: turn the whole hold (the hand anchor is part of it) about the elbow, in camera axes
        _swingQ.setFromEuler(_swingE.set(swing[3]! * DEG, swing[4]! * DEG, swing[5]! * DEG));
        gunGroup.position.sub(swingPivot).applyQuaternion(_swingQ).add(swingPivot);
        gunGroup.quaternion.premultiply(_swingQ);
      }
    }

    // Hands: solve IK AFTER all effects are applied to the gun (this order avoids the hand lagging the gun by one frame)
    gunGroup.updateMatrix();
    const M = gunGroup.matrix;
    const f = poses.first;
    shoulderR.set(f.shoulderR[0], f.shoulderR[1], f.shoulderR[2]);
    shoulderL.set(f.shoulderL[0], f.shoulderL[1], f.shoulderL[2]);
    poleR.set(shoulderR.x + f.poleR[0], shoulderR.y + f.poleR[1], shoulderR.z + f.poleR[2]);
    poleL.set(shoulderL.x + f.poleL[0], shoulderL.y + f.poleL[1], shoulderL.z + f.poleL[2]);
    const showArms = gunGroup.visible;
    const useFp = fpActive();
    armR.setVisible(showArms && !useFp);
    getAnchor(currentWeapon, "hand_r", targetR).applyMatrix4(M);
    armR.solve(shoulderR, targetR, poleR);
    dbg.validR = true;
    const leftOn = showArms && pose.hold !== "oneHand";
    armL.setVisible(leftOn && !useFp);
    dbg.validL = leftOn;
    let nadeRotR: Vec3 | undefined, nadeRotL: Vec3 | undefined;
    if (leftOn && nadeOut && nadeCfg) {
      // Left hand: 'rest' (off-screen) or the pin-pull path to the pin ring (grenade space) + offset (camera space); smoothed so it does not jerk when the target changes
      const keyPoint = (k: { to: "rest" | "pin_pull"; offset?: Vec3 }, out: THREE.Vector3) => {
        if (k.to === "rest") out.set(nadeCfg.leftRest[0], nadeCfg.leftRest[1], nadeCfg.leftRest[2]);
        else getAnchor(currentWeapon, "pin_pull", out).applyMatrix4(M);
        if (k.offset) out.add(_off.set(k.offset[0], k.offset[1], k.offset[2]));
      };
      if (nadeOut.leftS < 0) targetL.set(nadeCfg.leftRest[0], nadeCfg.leftRest[1], nadeCfg.leftRest[2]);
      else {
        const seg = pathSegment(nadeCfg.pullLeftHandPath, nadeOut.leftS);
        keyPoint(seg.a, _a); keyPoint(seg.b, _b);
        targetL.lerpVectors(_a, _b, seg.u);
      }
      if (!nadeLeftInit) { nadeLeft.copy(targetL); nadeLeftInit = true; }
      nadeLeft.lerp(targetL, 1 - Math.exp(-dt / 0.05));
      targetL.copy(nadeLeft);
      armL.solve(shoulderL, targetL, poleL);
      nadeRotR = nadeCfg.handRotDegR; nadeRotL = nadeCfg.handRotDegL;
    } else if (leftOn) {
      const keys = rl.keys;
      if (rp >= 0 && keys.length >= 2) {
        let i = 0;
        while (i < keys.length - 2 && rp >= keys[i + 1]!.t) i++;
        const k0 = keys[i]!, k1 = keys[i + 1]!;
        const u = smooth(k1.t > k0.t ? (rp - k0.t) / (k1.t - k0.t) : 1);
        getAnchor(currentWeapon, k0.to, _a).applyMatrix4(M);
        getAnchor(currentWeapon, k1.to, _b).applyMatrix4(M);
        if (k0.offset) _a.add(_off.set(k0.offset[0], k0.offset[1], k0.offset[2]));
        if (k1.offset) _b.add(_off.set(k1.offset[0], k1.offset[1], k1.offset[2]));
        targetL.lerpVectors(_a, _b, u);
      } else {
        getAnchor(currentWeapon, "hand_l", targetL).applyMatrix4(M);
      }
      armL.solve(shoulderL, targetL, poleL);
    }
    if (!useFp) fp.setVisible(false)
    else {
      fp.setVisible(showArms)
      fp.setLeftVisible(leftOn)
      fp.place()
      fp.solve(targetR, leftOn ? targetL : null, gunGroup.quaternion, nadeRotR, nadeRotL, armsOf(currentWeapon, 'first'))
    }
    updateMag(rp);
    armR.setReachedColor(dbg.showReach);
    armL.setReachedColor(dbg.showReach);

    // The flash shows for exactly 1 rendered frame
    if (flash.visible) {
      if (flashShown) flash.visible = false;
      else flashShown = true;
    }
  }

  function updateAspect(a: number) {
    cam.aspect = a;
    cam.updateProjectionMatrix();
  }

  const handle: ViewmodelHandle = {
    scene,
    cam,
    get currentWeapon() {
      return currentWeapon;
    },
    get targetWeapon() {
      return phase === "idle" ? currentWeapon : pendingId;
    },
    updateAspect,
    switchWeapon,
    snapTo,
    update,
    onFire,
    setMotion,
    setReload,
    setAim,
    get aimAmount() {
      return aimT;
    },
    setTeam(team: TeamId) {
      sleeve = colorOf(poses.style.sleeveColor[team]);
      armR.setColors(sleeve, skin);
      armL.setColors(sleeve, skin);
      fp.setTeam(team);
    },
    setGrenade(phase, mode, pullFrac, hasMore) { nadeAnim.setLogic(phase, mode, pullFrac, hasMore); },
    onGrenadeThrow() { nadeAnim.onThrow(); },
    get grenadePhase() { return nadeAnim.phase; },
    setSkin(skin: SkinId) { fp.setSkin(skin); },
    setBlockArms(v: boolean) { blockArms = v; },
    setHidden(h: boolean) { hidden = h; },
    debug: dbg,
  };
  if (import.meta.env?.DEV) (globalThis as { __vm?: ViewmodelHandle }).__vm = handle;   // debug: check scripts run from the browser
  return handle;
}
