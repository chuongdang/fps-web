// Compact binary encoding of the Snapshot message (the one message sent 20 times a second to every player).
// msgpack of a snapshot repeats every field name for every player and writes every number as a 64-bit float: ~180 bytes per player, so a
// 10-player snapshot did not fit in one TCP packet, and a lost packet then stalls the whole connection. This codec writes ~58 bytes per player.
//
// A snapshot frame starts with SNAPSHOT_MARKER (0xC1 is the one byte msgpack never uses, so decode() tells the two formats apart):
//   marker u8 | version u8 | flags u8 (bit0: msgpack "rest" follows) | tick u32 | serverTime f64 | ack i32 | count u16 | players... | [restLen u32 | rest]
// player: id u32 | pos f32x3 | vel f32x3 | yaw f32 | pitch f32 | flags u16 | slideTimer f32 | slideCooldown f32 | adsT f32 | hp f32 | weapon u8 | killStreak u8 | mask u16
//   mask: bits 0-8 = which optional fields follow (OPTIONAL below, as f64, ztype as u8 length + utf8), bit 13 = team B, bit 14 = extras: u16 length + msgpack of any
//   field this codec does not know (so a new NetPlayer field is never silently dropped; add it to OPTIONAL when it is worth the bytes).
// rest = msgpack of every snapshot field except t/tick/serverTime/ack/players (wpn, money, loadout...), only when there is one.
//
// float32 is enough for the physics fields: the client resets to the server state at every snapshot and replays its unacked cmds (error < 1e-5 m,
// below the 1e-4 m threshold the visual offset is zeroed at; tested in snapshotCodec.test.ts).
import { decode as mpDecode, encode as mpEncode } from '@msgpack/msgpack'
import type { NetPlayer, SnapshotMsg } from './protocol'

export const SNAPSHOT_MARKER = 0xc1
const VERSION = 1

const OPTIONAL = ['leapCd', 'hpMax', 'runSpeed', 'ztype', 'zscale', 'downLeft', 'reviveP', 'sniffLeft', 'sniffCd'] as const
const BIT_TEAM_B = 1 << 13
const BIT_EXTRAS = 1 << 14
const CORE_KEYS = new Set<string>(['id', 'pos', 'vel', 'yaw', 'pitch', 'flags', 'slideTimer', 'slideCooldown', 'adsT', 'hp', 'team', 'weapon', 'killStreak', ...OPTIONAL])
const ZTYPE_BIT = OPTIONAL.indexOf('ztype')

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

class Writer {
  buf = new Uint8Array(1024)
  dv = new DataView(this.buf.buffer)
  off = 0
  private need(n: number): void {
    if (this.off + n <= this.buf.length) return
    let size = this.buf.length * 2
    while (size < this.off + n) size *= 2
    const next = new Uint8Array(size)
    next.set(this.buf)
    this.buf = next; this.dv = new DataView(next.buffer)
  }
  u8(v: number): void { this.need(1); this.dv.setUint8(this.off, v); this.off += 1 }
  u16(v: number): void { this.need(2); this.dv.setUint16(this.off, v, true); this.off += 2 }
  u32(v: number): void { this.need(4); this.dv.setUint32(this.off, v, true); this.off += 4 }
  i32(v: number): void { this.need(4); this.dv.setInt32(this.off, v, true); this.off += 4 }
  f32(v: number): void { this.need(4); this.dv.setFloat32(this.off, v, true); this.off += 4 }
  f64(v: number): void { this.need(8); this.dv.setFloat64(this.off, v, true); this.off += 8 }
  bytes(b: Uint8Array): void { this.need(b.length); this.buf.set(b, this.off); this.off += b.length }
  result(): Uint8Array { return this.buf.slice(0, this.off) }
}

class Reader {
  dv: DataView
  off = 0
  constructor(public buf: Uint8Array) { this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength) }
  u8(): number { const v = this.dv.getUint8(this.off); this.off += 1; return v }
  u16(): number { const v = this.dv.getUint16(this.off, true); this.off += 2; return v }
  u32(): number { const v = this.dv.getUint32(this.off, true); this.off += 4; return v }
  i32(): number { const v = this.dv.getInt32(this.off, true); this.off += 4; return v }
  f32(): number { const v = this.dv.getFloat32(this.off, true); this.off += 4; return v }
  f64(): number { const v = this.dv.getFloat64(this.off, true); this.off += 8; return v }
  bytes(n: number): Uint8Array { const b = this.buf.subarray(this.off, this.off + n); this.off += n; return b }
}

function writePlayer(w: Writer, p: NetPlayer): void {
  w.u32(p.id)
  w.f32(p.pos[0]); w.f32(p.pos[1]); w.f32(p.pos[2])
  w.f32(p.vel[0]); w.f32(p.vel[1]); w.f32(p.vel[2])
  w.f32(p.yaw); w.f32(p.pitch)
  w.u16(p.flags)
  w.f32(p.slideTimer); w.f32(p.slideCooldown); w.f32(p.adsT ?? 0); w.f32(p.hp)
  w.u8(p.weapon); w.u8(Math.min(255, Math.max(0, p.killStreak ?? 0)))
  const rec = p as unknown as Record<string, unknown>
  let mask = p.team === 'B' ? BIT_TEAM_B : 0
  OPTIONAL.forEach((k, i) => { if (rec[k] !== undefined) mask |= 1 << i })
  let extras: Record<string, unknown> | null = null
  for (const k of Object.keys(rec)) if (!CORE_KEYS.has(k)) (extras ??= {})[k] = rec[k]
  if (extras) mask |= BIT_EXTRAS
  w.u16(mask)
  OPTIONAL.forEach((k, i) => {
    if (!(mask & (1 << i))) return
    if (i === ZTYPE_BIT) { const b = textEncoder.encode(String(rec[k])); w.u8(b.length); w.bytes(b) }
    else w.f64(rec[k] as number)
  })
  if (extras) { const b = mpEncode(extras); w.u16(b.length); w.bytes(b) }
}

function readPlayer(r: Reader): NetPlayer {
  const id = r.u32()
  const pos: [number, number, number] = [r.f32(), r.f32(), r.f32()]
  const vel: [number, number, number] = [r.f32(), r.f32(), r.f32()]
  const yaw = r.f32(), pitch = r.f32()
  const flags = r.u16()
  const slideTimer = r.f32(), slideCooldown = r.f32(), adsT = r.f32(), hp = r.f32()
  const weapon = r.u8(), killStreak = r.u8()
  const mask = r.u16()
  const p: NetPlayer = { id, pos, vel, yaw, pitch, flags, slideTimer, slideCooldown, adsT, hp, team: mask & BIT_TEAM_B ? 'B' : 'A', weapon, killStreak }
  const rec = p as unknown as Record<string, unknown>
  OPTIONAL.forEach((k, i) => {
    if (!(mask & (1 << i))) return
    rec[k] = i === ZTYPE_BIT ? textDecoder.decode(r.bytes(r.u8())) : r.f64()
  })
  if (mask & BIT_EXTRAS) Object.assign(rec, mpDecode(r.bytes(r.u16())) as Record<string, unknown>)
  return p
}

// Every client of a room gets the same `players` array in its snapshot: encode it once per snapshot, not once per client
const playersCache = new WeakMap<NetPlayer[], Uint8Array>()
function playersBytes(players: NetPlayer[]): Uint8Array {
  let b = playersCache.get(players)
  if (!b) {
    const w = new Writer()
    for (const p of players) writePlayer(w, p)
    b = w.result()
    playersCache.set(players, b)
  }
  return b
}

export function encodeSnapshotFrame(msg: SnapshotMsg): Uint8Array {
  const { t: _t, tick, serverTime, ack, players, ...restFields } = msg
  void _t
  const hasRest = Object.values(restFields).some(v => v !== undefined)
  const w = new Writer()
  w.u8(SNAPSHOT_MARKER); w.u8(VERSION); w.u8(hasRest ? 1 : 0)
  w.u32(tick); w.f64(serverTime); w.i32(ack); w.u16(players.length)
  w.bytes(playersBytes(players))
  if (hasRest) { const b = mpEncode(restFields); w.u32(b.length); w.bytes(b) }
  return w.result()
}

export function decodeSnapshotFrame(buf: Uint8Array): Omit<SnapshotMsg, 't'> {
  const r = new Reader(buf)
  if (r.u8() !== SNAPSHOT_MARKER) throw new Error('not a snapshot frame')
  const version = r.u8()
  if (version !== VERSION) throw new Error(`snapshot frame version ${version}, expected ${VERSION}`)
  const flags = r.u8()
  const tick = r.u32(), serverTime = r.f64(), ack = r.i32(), count = r.u16()
  const players: NetPlayer[] = []
  for (let i = 0; i < count; i++) players.push(readPlayer(r))
  const rest = flags & 1 ? mpDecode(r.bytes(r.u32())) as Record<string, unknown> : {}
  return { tick, serverTime, ack, players, ...rest } as Omit<SnapshotMsg, 't'>
}
