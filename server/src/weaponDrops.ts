import {
  CATEGORY_SLOT, DT, MsgType, SWITCH_MS, TICK_RATE, VOID_Y, WEAPONS, WEAPON_DROP,
  defaultMovement, dropDistSq, dropsEnabled, forwardFromYaw, inPickupReach, isDroppable, loadoutWeaponIds, stepGrenade,
  type GrenadeState, type Vec3,
} from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'
import type { Player, Room } from './room'
import { anyWorld } from './grenades'

// Dropped guns (shared/weaponDrop.ts). A dropped gun is a grenade without a fuse: same deterministic physics, so the client simulates the flight itself
// from WeaponDropSpawn. The server owns who can pick it up: reach is checked against the server's own position of the gun and of the player.
export interface RoomWeaponDrop extends GrenadeState {
  weapon: number         // WEAPONS id
  ammo: number           // rounds left in the magazine
  paid: number           // money the dropper paid (given back to the same player if they pick it up again; anyone else gets 0, so no money is created)
  expireTick: number
  lockUntilTick: number  // the dropper cannot pick it up again before this tick
}

// Holding order after dropping the held gun: best gun first, knife last
const HOLD_ORDER: readonly number[] = [CATEGORY_SLOT.long, CATEGORY_SLOT.mid, CATEGORY_SLOT.pistol, CATEGORY_SLOT.knife]
const msPerTick = 1000 / TICK_RATE
const _fwd: Vec3 = [0, 0, 0]

function spawnMsg(d: RoomWeaponDrop, tick: number) {
  return { t: MsgType.WeaponDropSpawn, id: d.id, weapon: d.weapon, ammo: d.ammo, ownerId: d.ownerId, pos: [d.pos[0], d.pos[1], d.pos[2]] as Vec3, vel: [d.vel[0], d.vel[1], d.vel[2]] as Vec3, spawnTick: tick, resting: d.resting }
}

function broadcastRemove(room: Room, id: number, byId?: number): void {
  const msg = { t: MsgType.WeaponDropRemove, id, ...(byId !== undefined ? { byId } : {}) }
  for (const o of room.players.values()) o.transport.send(msg)
}

function canAct(room: Room, p: Player): boolean {
  return p.alive && p.role === 'human' && !p.downed && !p.npc && dropsEnabled(room.config.settings.mode)
}

function rateLimited(room: Room, p: Player): boolean {
  const now = room.serverNow
  while (p.dropTimes.length > 0 && p.dropTimes[0]! <= now - 1000) p.dropTimes.shift()
  if (p.dropTimes.length >= WEAPON_DROP.maxActionsPerSecond) return true
  p.dropTimes.push(now)
  return false
}

/** Start point + velocity of a gun leaving `p`'s hand: in front of the eye, tossed forward and up. A wall right in front: it starts at the eye so it cannot pass through. */
function dropInitial(p: Player, world: CollisionWorld): { pos: Vec3; vel: Vec3 } {
  const s = p.state
  const eyeY = s.pos[1] + (s.crouching ? defaultMovement.eyeCrouch : defaultMovement.eyeStand)
  const eye: Vec3 = [s.pos[0], eyeY - 0.2, s.pos[2]]
  forwardFromYaw(s.yaw, _fwd)
  const reach = 0.4
  const hit = world.castRay(eye, [_fwd[0], 0, _fwd[2]], reach)
  const pos: Vec3 = hit ? eye : [eye[0] + _fwd[0] * reach, eye[1], eye[2] + _fwd[2] * reach]
  const k = WEAPON_DROP.inheritVelocity
  return { pos, vel: [_fwd[0] * WEAPON_DROP.throwSpeed + s.vel[0] * k, WEAPON_DROP.throwUp + s.vel[1] * k, _fwd[2] * WEAPON_DROP.throwSpeed + s.vel[2] * k] }
}

function launch(room: Room, owner: Player, weapon: number, ammo: number, paid: number, pos: Vec3, vel: Vec3): void {
  const d: RoomWeaponDrop = {
    id: room.nextDropId++, ownerId: owner.id, team: owner.team,
    pos: [pos[0], pos[1], pos[2]], vel: [vel[0], vel[1], vel[2]],
    spawnTick: room.tick, resting: false,
    weapon, ammo, paid,
    expireTick: room.tick + Math.round(WEAPON_DROP.lifetimeMs / msPerTick),
    lockUntilTick: room.tick + Math.round(WEAPON_DROP.ownerLockMs / msPerTick),
  }
  room.drops.push(d)
  const msg = spawnMsg(d, d.spawnTick)
  for (const o of room.players.values()) o.transport.send(msg)
  while (room.drops.length > WEAPON_DROP.maxPerRoom) broadcastRemove(room, room.drops.shift()!.id)
}

function takeFromLoadout(p: Player, slot: number): void {
  p.loadout = { slots: p.loadout.slots.map((w, i) => (i === slot ? null : w)) }
  p.weapon.slots = loadoutWeaponIds(p.loadout)
}

/** Hold `slot` (the server changed it, like after a purchase): cancel the reload, short fire lock, and tell the client so its next cmd carries the slot. */
function holdSlot(room: Room, p: Player, slot: number): void {
  const ws = p.weapon
  ws.slot = slot
  ws.current = ws.slots[slot]!
  ws.reloadEndMs = 0
  ws.nextFireMs = Math.max(ws.nextFireMs, Math.max(0, p.lastProcessedSeq) * 1000 / TICK_RATE + SWITCH_MS)
  ws.triggerHeld = false
  p.recoil.pitch = 0; p.recoil.yaw = 0
  p.transport.send({ t: MsgType.HoldSlot, slot })
}

/** G: drop the held gun (not the knife or grenades) and hold the best remaining weapon. */
export function handleDrop(room: Room, p: Player): void {
  if (!canAct(room, p) || rateLimited(room, p)) return
  const ws = p.weapon
  if (ws.nade.phase !== 'idle') return
  const slot = ws.slot, id = ws.slots[slot] ?? -1
  if (id < 0 || id !== ws.current || !isDroppable(WEAPONS[id]!)) return
  const world = anyWorld(room, p)
  if (!world) return
  const { pos, vel } = dropInitial(p, world)
  launch(room, p, id, ws.ammo[id] ?? 0, p.loadout.slots[slot]?.paid ?? 0, pos, vel)
  takeFromLoadout(p, slot)
  const next = HOLD_ORDER.find(s => (ws.slots[s] ?? -1) >= 0)
  if (next !== undefined) holdSlot(room, p, next)
}

/** E: pick up the nearest gun in reach. A gun already in that slot is dropped (swap), as in Counter-Strike. */
export function handlePickup(room: Room, p: Player): void {
  if (!canAct(room, p) || rateLimited(room, p)) return
  const ws = p.weapon
  if (ws.nade.phase !== 'idle') return
  let best = -1, bestD = Infinity
  for (let i = 0; i < room.drops.length; i++) {
    const d = room.drops[i]!
    if (d.ownerId === p.id && room.tick < d.lockUntilTick) continue
    if (!inPickupReach(p.state.pos, d.pos)) continue
    const dist = dropDistSq(p.state.pos, d.pos)
    if (dist < bestD) { bestD = dist; best = i }
  }
  if (best < 0) return
  const d = room.drops[best]!
  const slot = CATEGORY_SLOT[WEAPONS[d.weapon]!.category]
  const old = ws.slots[slot] ?? -1
  let oldDrop: { id: number; ammo: number; paid: number } | null = null
  if (old >= 0) {
    if (!anyWorld(room, p)) return   // cannot toss the old gun: do nothing rather than delete it
    oldDrop = { id: old, ammo: ws.ammo[old] ?? 0, paid: p.loadout.slots[slot]?.paid ?? 0 }
  }
  room.drops.splice(best, 1)
  broadcastRemove(room, d.id, p.id)
  if (oldDrop) {
    const { pos, vel } = dropInitial(p, anyWorld(room, p)!)
    launch(room, p, oldDrop.id, oldDrop.ammo, oldDrop.paid, pos, vel)
  }
  const slots = p.loadout.slots.slice()
  slots[slot] = { key: WEAPONS[d.weapon]!.key, paid: d.ownerId === p.id ? d.paid : 0 }
  p.loadout = { slots }
  ws.slots = loadoutWeaponIds(p.loadout)
  ws.ammo[d.weapon] = d.ammo
  holdSlot(room, p, slot)
}

/** A player just died (call before their loadout is reset): the held gun, or the best one they carry, falls to the ground where they died. */
export function dropWeaponOnDeath(room: Room, p: Player): void {
  if (p.role !== 'human' || !dropsEnabled(room.config.settings.mode)) return
  const ws = p.weapon
  const held = ws.slots[ws.slot] ?? -1
  const slot = held >= 0 && isDroppable(WEAPONS[held]!) ? ws.slot : HOLD_ORDER.find(s => (ws.slots[s] ?? -1) >= 0 && isDroppable(WEAPONS[ws.slots[s]!]!))
  if (slot === undefined) return
  const id = ws.slots[slot]!
  const s = p.state
  launch(room, p, id, ws.ammo[id] ?? 0, p.loadout.slots[slot]?.paid ?? 0, [s.pos[0], s.pos[1] + 0.9, s.pos[2]], [s.vel[0] * 0.5, WEAPON_DROP.throwUp, s.vel[2] * 0.5])
  takeFromLoadout(p, slot)
}

/** Every tick: advance the guns in flight, remove expired ones and ones that fell off the map. */
export function stepWeaponDrops(room: Room): void {
  if (room.drops.length === 0) return
  const world = anyWorld(room)
  for (let i = room.drops.length - 1; i >= 0; i--) {
    const d = room.drops[i]!
    if (world && !d.resting && room.tick > d.spawnTick) stepGrenade(d, world, DT)   // dropped this tick: its first step is next tick (the client fast-forwards the same way)
    if (room.tick >= d.expireTick || d.pos[1] < VOID_Y) {
      room.drops.splice(i, 1)
      broadcastRemove(room, d.id)
    }
  }
}

/** New round / new match: nothing stays on the floor. */
export function clearWeaponDrops(room: Room): void {
  if (room.drops.length === 0) return
  room.drops.length = 0
  broadcastRemove(room, -1)
}

/** A player joined: show them the guns already lying around (state as of now, flagged resting if it has stopped). */
export function sendDropsTo(room: Room, p: Player): void {
  for (const d of room.drops) p.transport.send(spawnMsg(d, room.tick))
}
