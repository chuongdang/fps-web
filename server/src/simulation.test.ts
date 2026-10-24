import { describe, it, expect } from 'vitest'
import { Btn, INPUT_GAP_WAIT_TICKS, INPUT_STARVE_GRACE_TICKS, MAX_INPUTS_PER_TICK, MAX_INPUT_QUEUE, MsgType, defaultMovement, loadMap, type AnyMsg, type InputCmd, type MapFile, type Transport } from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'
import { RoomManager } from './room'
import { enqueueCmds, stepPlayer, sendSnapshots } from './simulation'
import { TickLoop } from './tickLoop'

// Flat floor at y=0, no walls
const flatWorld: CollisionWorld = {
  moveCharacter(pos, d) {
    const y = Math.max(0, pos[1] + d[1])
    return { pos: [pos[0] + d[0], y, pos[2] + d[2]], grounded: y === 0, hitCeiling: false }
  },
  canStand: () => true,
  castRay: () => null, castSphere: () => null,
  debugRender: () => ({ vertices: new Float32Array(0), colors: new Float32Array(0) }),
  dispose: () => {},
}

const map = loadMap({ name: 't', mirrorX: true, boxes: [], ramps: [], spawnsA: [{ pos: [-25, 0, 0], yaw: 0 }] } as MapFile)
const cmd = (seq: number, buttons = 0, extra: Partial<InputCmd> = {}): InputCmd =>
  ({ seq, buttons, yaw: 0, pitch: 0, weapon: 3, ...extra })

function setup(unreliable = false) {
  const got: AnyMsg[] = []
  const t: Transport = { send: m => { got.push(m) }, onMessage: () => {}, onClose: () => {}, ...(unreliable ? { unreliableActive: () => true } : null) }
  const rm = new RoomManager(map, () => 0)
  const { room, player } = rm.join('r', 'A', t, 0, 'A')
  player.world = flatWorld
  player.weapon.slots = [6, 2, -1, 0]; player.weapon.slot = 3; player.weapon.current = 0   // AK47 in slot 3
  return { room, p: player, got }
}

describe('stepPlayer', () => {
  it('processes cmds in order, records lastProcessedSeq', () => {
    const { p } = setup()
    enqueueCmds(p, [cmd(0, Btn.Forward), cmd(1, Btn.Forward)])
    stepPlayer(p, defaultMovement)
    expect(p.lastProcessedSeq).toBe(1)    // both fit in one tick (MAX_INPUTS_PER_TICK = 3)
    expect(p.inputQueue.length).toBe(0)
  })

  it('at most MAX_INPUTS_PER_TICK cmds per tick', () => {
    const { p } = setup()
    enqueueCmds(p, [cmd(0), cmd(1), cmd(2), cmd(3), cmd(4)])
    stepPlayer(p, defaultMovement)
    expect(p.lastProcessedSeq).toBe(MAX_INPUTS_PER_TICK - 1)
    expect(p.inputQueue.length).toBe(5 - MAX_INPUTS_PER_TICK)
  })

  it('a cmd with a duplicate seq does not run twice', () => {
    // a: sends cmd 0 then sends it again twice; b: sends cmd 0 only. Both must end in the same state.
    const a = setup().p, b = setup().p
    enqueueCmds(a, [cmd(0, Btn.Forward)]); enqueueCmds(b, [cmd(0, Btn.Forward)])
    stepPlayer(a, defaultMovement); stepPlayer(b, defaultMovement)
    enqueueCmds(a, [cmd(0, Btn.Forward), cmd(0, Btn.Forward)])
    stepPlayer(a, defaultMovement); stepPlayer(b, defaultMovement)
    expect(a.lastProcessedSeq).toBe(0)
    expect(a.inputQueue.length).toBe(0)
    expect(a.state).toEqual(b.state)
  })

  it('drops the oldest cmd when the queue exceeds MAX_INPUT_QUEUE', () => {
    const { p } = setup()
    for (let i = 0; i < MAX_INPUT_QUEUE + 5; i++) enqueueCmds(p, [cmd(i)])   // one cmd per message, like the client
    expect(p.inputQueue.length).toBe(MAX_INPUT_QUEUE)
    expect(p.inputQueue[0]!.seq).toBe(5)
  })

  // A TCP stall holds the cmds back and delivers them in one burst: every one must still be simulated, so the server ends where the client predicted
  describe('a stalled connection', () => {
    const run = (stallStartTick: number, stallTicks: number, total = 240) => {
      const { p } = setup()
      const buttons = (seq: number) => Btn.Forward | (seq % 50 === 20 ? Btn.Jump : 0) | (seq % 70 < 35 ? Btn.Left : Btn.Right)
      const sent: InputCmd[] = []
      for (let tick = 0; tick < total; tick++) {
        const c = cmd(tick, buttons(tick), { yaw: tick * 0.01 })
        sent.push(c)
        const now = 5000 + tick * 1000 / 60   // simulated clock: cmds are rejected if their seq runs ahead of real time
        const stalled = tick >= stallStartTick && tick < stallStartTick + stallTicks
        if (tick === stallStartTick + stallTicks) for (const held of sent.slice(stallStartTick, tick)) enqueueCmds(p, [held], now)   // the stall ends: the held messages arrive at once
        if (!stalled) enqueueCmds(p, [c], now)
        if (stalled || tick > 0) stepPlayer(p, defaultMovement)
      }
      for (let i = 0; i < 12; i++) stepPlayer(p, defaultMovement)   // let the server catch up (few enough ticks that no idle step starts: that one is the starvation rule, tested below)
      return { p, sent }
    }
    const reference = (sent: InputCmd[]) => {
      const { p } = setup()
      for (const c of sent) { enqueueCmds(p, [c], 5000 + c.seq * 1000 / 60); stepPlayer(p, defaultMovement) }
      return p
    }

    it.each([[15, '250 ms'], [30, '500 ms']])('%i ticks (%s): no cmd is dropped, the server ends in the state the client predicted', (stallTicks) => {
      const { p, sent } = run(60, stallTicks)
      expect(p.lastProcessedSeq).toBe(sent[sent.length - 1]!.seq)
      expect(p.state.pos).toEqual(reference(sent).state.pos)
    })
  })

  it('invalid cmds are dropped', () => {
    const { p } = setup()
    enqueueCmds(p, [cmd(0, 0, { pitch: 2 }), cmd(1, 0, { yaw: NaN }), cmd(2, 1 << 15), 'x', null])
    enqueueCmds(p, 'not an array')
    expect(p.inputQueue.length).toBe(0)
  })

  it('empty queue: keeps running lastCmd but drops Jump, does not advance seq', () => {
    const { p } = setup()
    enqueueCmds(p, [cmd(0)])
    stepPlayer(p, defaultMovement)                 // touch the ground first
    expect(p.state.grounded).toBe(true)
    enqueueCmds(p, [cmd(1, Btn.Forward | Btn.Jump)])
    stepPlayer(p, defaultMovement)
    const vy1 = p.state.vel[1]
    expect(vy1).toBeGreaterThan(0)                 // already jumped
    for (let i = 0; i < INPUT_STARVE_GRACE_TICKS; i++) stepPlayer(p, defaultMovement)   // wait for cmd
    expect(p.state.vel[1]).toBe(vy1)
    stepPlayer(p, defaultMovement)                 // wait time over -> idle
    expect(p.lastProcessedSeq).toBe(1)
    expect(p.idleCmd.buttons & Btn.Jump).toBe(0)
    expect(p.idleCmd.buttons & Btn.Forward).toBe(Btn.Forward)
    expect(p.state.vel[1]).toBeLessThan(vy1)      // only gravity remains
  })

  it('briefly empty queue: no extra step, later cmds make up for it', () => {
    // a: cmds arrive steadily; b: cmd 1 arrives one tick late (queue empty for 1 tick) then cmds 1,2 arrive together
    const a = setup().p, b = setup().p
    for (const p of [a, b]) { enqueueCmds(p, [cmd(0, Btn.Forward)]); stepPlayer(p, defaultMovement) }
    enqueueCmds(a, [cmd(1, Btn.Forward)]); stepPlayer(a, defaultMovement)
    enqueueCmds(a, [cmd(2, Btn.Forward)]); stepPlayer(a, defaultMovement)
    stepPlayer(b, defaultMovement)                                  // empty, no step
    enqueueCmds(b, [cmd(1, Btn.Forward), cmd(2, Btn.Forward)]); stepPlayer(b, defaultMovement)
    expect(b.lastProcessedSeq).toBe(2)
    expect(b.state).toEqual(a.state)
  })

  it('a player who has not sent any cmd still runs idle (falls to the ground)', () => {
    const { p } = setup()
    p.state = { ...p.state, pos: [0, 5, 0] }
    stepPlayer(p, defaultMovement)
    expect(p.state.pos[1]).toBeLessThan(5)
  })

  it('does not run without a world', () => {
    const { p } = setup()
    p.world = null
    enqueueCmds(p, [cmd(0, Btn.Forward)])
    stepPlayer(p, defaultMovement)
    expect(p.lastProcessedSeq).toBe(-1)
  })
})

describe('sendSnapshots', () => {
  it('only sends every 3 ticks, ack per player', () => {
    const { room, p, got } = setup()
    p.lastProcessedSeq = 7
    sendSnapshots(room, 1, 10)
    sendSnapshots(room, 2, 10)
    expect(got.filter(m => m.t === MsgType.Snapshot).length).toBe(0)
    sendSnapshots(room, 3, 50)
    const snap = got.find(m => m.t === MsgType.Snapshot)
    expect(snap).toMatchObject({ tick: 3, serverTime: 50, ack: 7 })
    expect((snap as { players: unknown[] }).players.length).toBe(1)
  })
})

describe('TickLoop', () => {
  it('runs a full 60 ticks/second even when pump is called erratically', () => {
    let now = 1000
    let n = 0
    const loop = new TickLoop(() => now, () => { n++ })
    while (now < 1000 + 60_000) { now += 1 + (now % 7); loop.pump() }   // call interval 1-7ms
    expect(n).toBeGreaterThanOrEqual(3599)
    expect(n).toBeLessThanOrEqual(3600)
  })

  it('when too far behind, drops ticks instead of bursting to catch up', () => {
    let now = 0
    let n = 0
    const loop = new TickLoop(() => now, () => { n++ })
    now = 10_000
    loop.pump()
    expect(n).toBe(10)
    expect(loop.skipped).toBeGreaterThan(500)
  })
})

describe('guns on the server (4.1)', () => {
  // Send Fire continuously for `n` cmds, one cmd per tick, return the number of valid shots
  function holdFire(weapon: number, n: number, pulse = false) {
    const { p } = setup()
    for (let i = 0; i < n; i++) {
      const fire = pulse ? (i % 2 === 0 ? Btn.Fire : 0) : Btn.Fire
      enqueueCmds(p, [cmd(i, fire, { weapon })], i * 1000 / 60)
      stepPlayer(p, defaultMovement)
    }
    return p
  }

  it('AK47 trigger held: exactly 10 shots/second per fireIntervalMs, regardless of server tick', () => {
    const p = holdFire(3, 60)
    expect(p.shotsFired).toBe(10)
    expect(p.weapon.ammo[0]).toBe(30 - 10)
  })

  it('cmds arriving 2 per tick still compute fire rate by seq', () => {
    const { p } = setup()
    for (let i = 0; i < 60; i += 2) {
      enqueueCmds(p, [cmd(i, Btn.Fire), cmd(i + 1, Btn.Fire)], i * 1000 / 60)
      stepPlayer(p, defaultMovement)
    }
    expect(p.shotsFired).toBe(10)
  })

  it('COLT is semi-auto: must release the trigger to fire again', () => {
    // switching to COLT locks firing for 300ms; holding the trigger through the lock wastes that press, it does not auto-fire when the lock ends
    expect(holdFire(1, 60).shotsFired).toBe(0)
    // press every 2 ticks: after the 300ms lock ~0.7s remain, each shot >=160ms apart (10 ticks) -> ticks 18,28,38,48,58 = 5 shots
    expect(holdFire(1, 60, true).shotsFired).toBe(5)
  })

  it('empties the magazine then auto-reloads: ammo is full after reloadMs', () => {
    const { p } = setup()
    let seq = 0
    const run = (n: number, buttons: number) => {
      for (let i = 0; i < n; i++, seq++) { enqueueCmds(p, [cmd(seq, buttons)], seq * 1000 / 60); stepPlayer(p, defaultMovement) }
    }
    run(200, Btn.Fire)             // 30 rounds gone in ~3s, then click + auto-reload
    expect(p.weapon.ammo[0]).toBe(0)
    expect(p.shotsFired).toBe(30)
    run(160, 0)                     // 2.5s reload
    expect(p.weapon.ammo[0]).toBe(30)
  })

  it('switching guns via cmd.weapon', () => {
    const { p } = setup()
    enqueueCmds(p, [cmd(0, 0, { weapon: 1 })], 0)
    stepPlayer(p, defaultMovement)
    expect(p.weapon.current).toBe(2)   // slot 1 = Colt
    expect(p.weapon.slot).toBe(1)
  })

  it('skipped-ahead seq is dropped: no firing faster than real time', () => {
    const { p } = setup()
    enqueueCmds(p, [cmd(0)], 0)
    stepPlayer(p, defaultMovement)
    enqueueCmds(p, [cmd(6000, Btn.Fire)], 100)   // 100 seconds in 100ms real
    stepPlayer(p, defaultMovement)
    expect(p.lastProcessedSeq).toBe(0)
    expect(p.shotsFired).toBe(0)
  })

  it('bursty sends within the 1s tolerance are still accepted', () => {
    const { p } = setup()
    enqueueCmds(p, [cmd(0)], 0)
    enqueueCmds(p, [cmd(30)], 100)   // 500ms of seq, 100ms real: within the slack
    stepPlayer(p, defaultMovement)
    expect(p.inputQueue.length + (p.lastProcessedSeq >= 0 ? 1 : 0)).toBeGreaterThan(0)
    expect(p.inputQueue.some(c => c.seq === 30) || p.lastProcessedSeq === 30).toBe(true)
  })

  it("snapshot carries the receiver's own WeaponState", () => {
    const { room, p, got } = setup()
    enqueueCmds(p, [cmd(0, Btn.Fire)], 0)
    stepPlayer(p, defaultMovement)
    sendSnapshots(room, 0, 0)
    const snap = got.find(m => m.t === MsgType.Snapshot)
    if (!snap || snap.t !== MsgType.Snapshot) throw new Error('no snapshot')
    expect(snap.wpn?.ammo[0]).toBe(29)
  })
})

describe('fall damage', () => {
  // Drop a player from height h (m) to the floor at y=0, run until landing
  function drop(h: number, tweak?: (p: ReturnType<typeof setup>['p']) => void) {
    const s = setup()
    s.p.invulnUntil = 0
    s.p.state.pos[1] = h; s.p.state.grounded = false
    tweak?.(s.p)
    for (let i = 0; i < 600 && !s.p.state.grounded; i++) stepPlayer(s.p, defaultMovement, s.room)
    return s
  }

  it('a low fall (<= 4m) costs no hp and sends no Hurt', () => {
    const { p, got } = drop(4)
    expect(p.state.grounded).toBe(true)
    expect(p.hp).toBe(100)
    expect(got.some(m => m.t === MsgType.Hurt)).toBe(false)
  })

  it('an 8m fall costs moderate hp and sends a fall-type Hurt to the victim', () => {
    const { p, got } = drop(8)
    expect(p.hp).toBeLessThan(100); expect(p.hp).toBeGreaterThan(0)
    const hurt = got.filter(m => m.t === MsgType.Hurt)
    expect(hurt.length).toBe(1)
    expect(hurt[0]).toMatchObject({ fall: true, damage: 100 - p.hp })
  })

  it('damage is applied once per landing (standing still on the floor does not apply it again)', () => {
    const { p, room } = drop(8)
    const hp = p.hp
    for (let i = 0; i < 60; i++) stepPlayer(p, defaultMovement, room)
    expect(p.hp).toBe(hp)
  })

  it('a 12m fall kills: killerId is the player themselves', () => {
    const { p } = drop(12)
    expect(p.hp).toBeLessThanOrEqual(0)
    expect(p.killerId).toBe(p.id)
  })

  it('an invulnerable player (just respawned) loses no hp', () => {
    const { p } = drop(12, q => { q.invulnUntil = 1e9 })
    expect(p.hp).toBe(100)
  })

  it('zombies take no fall damage', () => {
    const { p } = drop(12, q => { q.zstats = { type: 'walker' } as never })
    expect(p.hp).toBe(100)
  })

  it('jumping in place on a flat floor costs no hp', () => {
    const { p, room } = drop(0)
    enqueueCmds(p, [cmd(0, Btn.Jump)])
    for (let i = 0; i < 120; i++) stepPlayer(p, defaultMovement, room)
    expect(p.hp).toBe(100)
  })
})

describe('cmds arriving out of order (an unreliable channel)', () => {
  const seqs = (p: ReturnType<typeof setup>['p']) => p.inputQueue.map(c => c.seq)
  const NOW = 5000

  it('the queue is kept sorted by seq, without duplicates, and without cmds already simulated', () => {
    const { p } = setup(true)
    enqueueCmds(p, [cmd(3), cmd(1)], NOW); enqueueCmds(p, [cmd(2), cmd(2), cmd(3)], NOW)
    expect(seqs(p)).toEqual([1, 2, 3])
    for (let i = 0; i < 3; i++) stepPlayer(p, defaultMovement)
    expect(p.lastProcessedSeq).toBe(3)
    enqueueCmds(p, [cmd(2), cmd(3), cmd(4)], NOW)   // the redundancy repeats 2 and 3
    expect(seqs(p)).toEqual([4])
  })

  it('a missing cmd is waited for: later ones are held until the late packet brings it, then all run in order', () => {
    const { p } = setup(true)
    enqueueCmds(p, [cmd(0), cmd(1)], NOW); stepPlayer(p, defaultMovement)
    enqueueCmds(p, [cmd(4), cmd(5), cmd(6), cmd(7)], NOW)   // the packet with 2 and 3 is late
    for (let i = 0; i < INPUT_GAP_WAIT_TICKS; i++) stepPlayer(p, defaultMovement)
    expect(p.lastProcessedSeq).toBe(1)                       // still waiting
    enqueueCmds(p, [cmd(2), cmd(3), cmd(4), cmd(5)], NOW)    // it arrives
    stepPlayer(p, defaultMovement); stepPlayer(p, defaultMovement)
    expect(p.lastProcessedSeq).toBe(7)
  })

  it('on a reliable transport there is no waiting: a gap is final, the next cmd runs at once', () => {
    const { p } = setup(false)
    enqueueCmds(p, [cmd(0), cmd(1)], NOW); stepPlayer(p, defaultMovement)
    enqueueCmds(p, [cmd(5)], NOW); stepPlayer(p, defaultMovement)
    expect(p.lastProcessedSeq).toBe(5)
  })

  it('a cmd that never comes is given up after INPUT_GAP_WAIT_TICKS, then the queue moves on', () => {
    const { p } = setup(true)
    enqueueCmds(p, [cmd(0), cmd(1)], NOW); stepPlayer(p, defaultMovement)
    enqueueCmds(p, [cmd(4), cmd(5)], NOW)
    for (let i = 0; i < INPUT_GAP_WAIT_TICKS; i++) { stepPlayer(p, defaultMovement); expect(p.lastProcessedSeq).toBe(1) }
    stepPlayer(p, defaultMovement)
    expect(p.lastProcessedSeq).toBe(5)
  })

  it('a stream of redundant packets with random delay (0-6 ticks), reordering and 5% loss ends exactly where an in-order stream does', () => {
    let seed = 99
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
    const buttons = (seq: number) => Btn.Forward | (seq % 45 === 7 ? Btn.Jump : 0) | (seq % 80 < 40 ? Btn.Left : Btn.Right)
    const make = (seq: number) => cmd(seq, buttons(seq), { yaw: seq * 0.013 })
    const TICKS = 400
    const { p } = setup(true)
    stepPlayer(p, defaultMovement)   // both players start grounded (the first step of a new player is an idle one)
    const inflight: { at: number; cmds: InputCmd[] }[] = []
    for (let tick = 0; tick < TICKS + 30; tick++) {   // (the last 30 ticks only deliver what is still in flight)
      if (tick < TICKS && rnd() >= 0.05) inflight.push({ at: tick + Math.floor(rnd() * 7), cmds: [Math.max(0, tick - 3), Math.max(0, tick - 2), Math.max(0, tick - 1), tick].filter((x, i, a) => a.indexOf(x) === i).map(make) })
      for (const m of inflight.filter(f => f.at === tick)) enqueueCmds(p, m.cmds, 5000 + tick * 1000 / 60)
      stepPlayer(p, defaultMovement)
    }
    const ref = setup(true).p
    stepPlayer(ref, defaultMovement)
    for (let seq = 0; seq < TICKS; seq++) { enqueueCmds(ref, [make(seq)], 5000 + seq * 1000 / 60); stepPlayer(ref, defaultMovement) }
    expect(p.lastProcessedSeq).toBe(TICKS - 1)
    expect(p.state.pos[0]).toBeCloseTo(ref.state.pos[0], 9); expect(p.state.pos[2]).toBeCloseTo(ref.state.pos[2], 9)
  })
})

describe('sendSnapshots: wpn and loadout only when they changed', () => {
  const snaps = (got: AnyMsg[]) => got.filter((m): m is Extract<AnyMsg, { t: typeof MsgType.Snapshot }> => m.t === MsgType.Snapshot)
  const SNAP_TICK = 0   // tick % SNAPSHOT_EVERY_TICKS === 0

  it('the first snapshot carries both, an unchanged one carries neither (money always)', () => {
    const { room, got } = setup()
    sendSnapshots(room, SNAP_TICK, 100); sendSnapshots(room, SNAP_TICK, 150)
    const [a, b] = snaps(got)
    expect(a!.wpn).toBeDefined(); expect(a!.loadout).toBeDefined()
    expect(b!.wpn).toBeUndefined(); expect(b!.loadout).toBeUndefined()
    expect(b!.money).toBeDefined()
  })

  it('a changed weapon state (a shot, a reload, ammo) is sent again, once', () => {
    const { room, p, got } = setup()
    sendSnapshots(room, SNAP_TICK, 100)
    p.weapon.ammo[0] = (p.weapon.ammo[0] ?? 0) - 1; p.weapon.nextFireMs += 100
    sendSnapshots(room, SNAP_TICK, 150); sendSnapshots(room, SNAP_TICK, 200)
    const s = snaps(got)
    expect(s[1]!.wpn).toBeDefined()
    expect(s[1]!.wpn!.ammo[0]).toBe(p.weapon.ammo[0])
    expect(s[1]!.loadout).toBeUndefined()
    expect(s[2]!.wpn).toBeUndefined()
  })

  it('a changed loadout (bought a weapon) is sent again; so is a changed magazine multiplier', () => {
    const { room, p, got } = setup()
    sendSnapshots(room, SNAP_TICK, 100)
    p.loadout.slots[1] = { key: 'colt', paid: 500 }
    sendSnapshots(room, SNAP_TICK, 150)
    p.weapon.magMult = 2
    sendSnapshots(room, SNAP_TICK, 200)
    const s = snaps(got)
    expect(s[1]!.loadout).toEqual(p.loadout.slots); expect(s[1]!.wpn).toBeUndefined()
    expect(s[2]!.wpn!.magMult).toBe(2); expect(s[2]!.loadout).toBeUndefined()
  })

  it('every player is tracked on its own: a player who joins later gets the full state even though the first one already holds it', () => {
    const rm = new RoomManager(map, () => 0)
    const gotA: AnyMsg[] = [], gotB: AnyMsg[] = []
    const tr = (got: AnyMsg[]): Transport => ({ send: m => { got.push(m) }, onMessage: () => {}, onClose: () => {} })
    const { room } = rm.join('r', 'A', tr(gotA), 0, 'A')
    sendSnapshots(room, SNAP_TICK, 100)
    rm.join('r', 'B', tr(gotB), 0, 'B')
    sendSnapshots(room, SNAP_TICK, 150)
    expect(snaps(gotA)[1]!.wpn).toBeUndefined()
    expect(snaps(gotB)).toHaveLength(1)
    expect(snaps(gotB)[0]!.wpn).toBeDefined(); expect(snaps(gotB)[0]!.loadout).toBeDefined()
  })
})
