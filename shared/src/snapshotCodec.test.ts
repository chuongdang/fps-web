import { describe, it, expect } from 'vitest'
import { encode as mpEncode } from '@msgpack/msgpack'
import { encode, decode, MsgType, NetFlag, stateToNet, type NetPlayer, type SnapshotMsg } from './protocol'
import { SNAPSHOT_MARKER } from './snapshotCodec'
import { Btn, defaultMovement, stepMovement, type InputCmd, type PlayerState } from './movement'
import { makeWeaponState } from './weapons'
import { DT } from './constants'
import type { CollisionWorld } from './physics/world'

// deterministic pseudo random numbers
let seed = 12345
const rnd = (a = 0, b = 1) => { seed = (seed * 1664525 + 1013904223) >>> 0; return a + (seed / 2 ** 32) * (b - a) }

function player(id: number, extra: Partial<NetPlayer> = {}): NetPlayer {
  const s: PlayerState = { pos: [rnd(-66, 66), rnd(0, 15), rnd(-56, 56)], vel: [rnd(-7, 7), rnd(-3, 3), rnd(-7, 7)], yaw: rnd(-3.14, 3.14), pitch: rnd(-1.5, 1.5),
    grounded: id % 2 === 0, crouching: id % 3 === 0, slideTimer: id % 5 === 0 ? rnd(0, 0.6) : 0, slideCooldown: rnd(0, 1), adsT: rnd(0, 1) }
  return { ...stateToNet(id, s, rnd(1, 100), id % 2 ? NetFlag.Invuln : 0, id % 2 ? 'A' : 'B', id % 4, id % 7), ...extra }
}
const snap = (players: NetPlayer[], rest: Partial<SnapshotMsg> = {}): SnapshotMsg => ({ t: MsgType.Snapshot, tick: 123456, serverTime: 2057600.123456, ack: 98765, players, ...rest })
const roundTrip = (m: SnapshotMsg) => decode(encode(m)) as SnapshotMsg

function close(a: NetPlayer, b: NetPlayer): void {
  expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort())
  for (const k of ['pos', 'vel'] as const) a[k].forEach((v, i) => expect(b[k][i]).toBeCloseTo(v, 4))
  for (const k of ['yaw', 'pitch', 'slideTimer', 'slideCooldown', 'adsT', 'hp'] as const) expect(b[k]).toBeCloseTo(a[k], 4)
  for (const k of ['id', 'flags', 'team', 'weapon', 'killStreak'] as const) expect(b[k]).toBe(a[k])
}

describe('snapshot codec', () => {
  it('round trips 10 players: the same fields, numbers within float32 precision', () => {
    const players = Array.from({ length: 10 }, (_, i) => player(i + 1))
    const out = roundTrip(snap(players))
    expect(out.t).toBe(MsgType.Snapshot)
    expect([out.tick, out.serverTime, out.ack]).toEqual([123456, 2057600.123456, 98765])
    expect(out.players).toHaveLength(10)
    players.forEach((p, i) => close(p, out.players[i]!))
  })

  it('zombie / Defense fields (optional) keep their exact values', () => {
    const z = player(7, { flags: NetFlag.Zombie | NetFlag.Downed | NetFlag.Hero, leapCd: 1.234, hpMax: 4000, runSpeed: 4.6, ztype: 'mother', zscale: 2.2, downLeft: 12345.6, reviveP: 0.33, sniffLeft: 800, sniffCd: 9000 })
    const out = roundTrip(snap([player(1), z, player(2)]))
    expect(out.players[1]).toMatchObject({ leapCd: 1.234, hpMax: 4000, runSpeed: 4.6, ztype: 'mother', zscale: 2.2, downLeft: 12345.6, reviveP: 0.33, sniffLeft: 800, sniffCd: 9000 })
    expect(out.players[1]!.flags).toBe(NetFlag.Zombie | NetFlag.Downed | NetFlag.Hero)
    expect('hpMax' in out.players[0]!).toBe(false)
  })

  it('a NetPlayer field the codec does not know is carried, not dropped', () => {
    const p = { ...player(3), futureThing: { a: 1, b: [2, 3] }, other: 'x' } as NetPlayer
    const out = roundTrip(snap([p]))
    expect((out.players[0] as unknown as Record<string, unknown>).futureThing).toEqual({ a: 1, b: [2, 3] })
    expect((out.players[0] as unknown as Record<string, unknown>).other).toBe('x')
  })

  it('wpn / money / loadout (and any other snapshot field) go through; absent ones stay absent', () => {
    const wpn = makeWeaponState()
    const loadout = [{ key: 'ak47', paid: 2500 }, null, { key: 'm67', paid: 300, count: 2 }]
    const full = roundTrip(snap([player(1)], { wpn, money: 4200, loadout }))
    expect(full.wpn).toEqual(JSON.parse(JSON.stringify(wpn)))
    expect(full.money).toBe(4200)
    expect(full.loadout).toEqual(loadout)
    const bare = roundTrip(snap([player(1)]))
    expect('wpn' in bare).toBe(false); expect('money' in bare).toBe(false); expect('loadout' in bare).toBe(false)
    expect(roundTrip(snap([player(1)], { money: 0 })).money).toBe(0)
  })

  it('edge values: ack -1, no players, flags up to bit 9, kill streak clamps at 255', () => {
    expect(roundTrip(snap([], { ack: -1 }))).toMatchObject({ ack: -1, players: [] })
    const p = player(1, { flags: 0x3ff, killStreak: 400 })
    const out = roundTrip(snap([p]))
    expect(out.players[0]!.flags).toBe(0x3ff)
    expect(out.players[0]!.killStreak).toBe(255)
  })

  it('is at least 3x smaller than msgpack, and 10 / 16 players fit in one packet (< 1.4 KB payload)', () => {
    for (const n of [2, 6, 10, 16]) {
      const m = snap(Array.from({ length: n }, (_, i) => player(i + 1)))
      const bin = encode(m).length, mp = mpEncode(m).length
      expect(bin, `${n} players`).toBeLessThan(mp / 3)
      expect(bin, `${n} players`).toBeLessThan(40 + n * 60)
      if (n <= 16) expect(bin).toBeLessThan(1400)
    }
  })

  it('starts with the marker; a msgpack snapshot from an older sender still decodes', () => {
    expect(encode(snap([player(1)]))[0]).toBe(SNAPSHOT_MARKER)
    const old = snap([player(1)], { money: 5 })
    const out = decode(mpEncode(old)) as SnapshotMsg
    expect(out.players[0]).toEqual(old.players[0])
    expect(out.money).toBe(5)
  })

  it('other messages are untouched', () => {
    const ping = { t: MsgType.Ping, clientTime: 5 } as const
    expect(decode(encode(ping))).toEqual(ping)
    const b = encode(ping)
    expect(decode(b.buffer.slice(b.byteOffset, b.byteOffset + b.length) as ArrayBuffer)).toEqual(ping)   // ArrayBuffer input (browser WebSocket)
  })

  it('decodes from an ArrayBuffer and from a Uint8Array view with an offset', () => {
    const bytes = encode(snap([player(1), player(2)]))
    const padded = new Uint8Array(bytes.length + 7); padded.set(bytes, 7)
    expect((decode(padded.subarray(7)) as SnapshotMsg).players).toHaveLength(2)
    expect((decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer) as SnapshotMsg).players).toHaveLength(2)
  })

  it('a truncated frame throws instead of returning garbage (the transport drops it)', () => {
    const bytes = encode(snap([player(1), player(2), player(3)]))
    expect(() => decode(bytes.subarray(0, bytes.length - 20))).toThrow()
    expect(() => decode(bytes.subarray(0, 10))).toThrow()
  })

  it('the players of one snapshot are encoded once for all clients (same array = same bytes), other fields still differ per client', () => {
    const players = Array.from({ length: 5 }, (_, i) => player(i + 1))
    const a = encode(snap(players, { ack: 1, money: 10 })), b = encode(snap(players, { ack: 2, money: 20 }))
    expect(a.length).toBe(b.length)
    expect((decode(a) as SnapshotMsg).ack).toBe(1); expect((decode(b) as SnapshotMsg).ack).toBe(2)
    expect((decode(b) as SnapshotMsg).money).toBe(20)
  })
})

// The client resets to the server state at every snapshot and replays its unacked cmds on top: float32 rounding of that state must not make the
// replay drift away from what the server computes (prediction.ts zeroes visual offsets below 1e-4 m)
describe('float32 snapshot state vs exact state', () => {
  const flat: CollisionWorld = {
    moveCharacter(pos, d) { const y = Math.max(0, pos[1] + d[1]); return { pos: [pos[0] + d[0], y, pos[2] + d[2]], grounded: y === 0, hitCeiling: false } },
    canStand: () => true, castRay: () => null, castSphere: () => null,
    debugRender: () => ({ vertices: new Float32Array(0), colors: new Float32Array(0) }), dispose: () => {},
  }
  it('120 replayed cmds from a rounded state end within 1e-4 m of the exact run', () => {
    for (let trial = 0; trial < 20; trial++) {
      const exact: PlayerState = { pos: [rnd(-66, 66), 0, rnd(-56, 56)], vel: [rnd(-6, 6), 0, rnd(-6, 6)], yaw: rnd(-3, 3), pitch: 0, grounded: true, crouching: false, slideTimer: 0, slideCooldown: rnd(0, 1), adsT: 0 }
      const wire = (decode(encode(snap([stateToNet(1, exact)]))) as SnapshotMsg).players[0]!
      let a = exact
      let b: PlayerState = { ...exact, pos: [...wire.pos] as PlayerState['pos'], vel: [...wire.vel] as PlayerState['vel'], yaw: wire.yaw, slideCooldown: wire.slideCooldown }
      for (let i = 0; i < 120; i++) {
        const cmd: InputCmd = { seq: i, buttons: Btn.Forward | (i % 40 === 5 ? Btn.Jump : 0) | (i % 60 < 30 ? Btn.Left : Btn.Right), yaw: a.yaw + i * 0.01, pitch: 0, weapon: 0 }
        a = stepMovement(a, cmd, flat, defaultMovement, DT)
        b = stepMovement(b, cmd, flat, defaultMovement, DT)
      }
      expect(Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2])).toBeLessThan(1e-4)
    }
  })
})
