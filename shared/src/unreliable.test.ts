import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MsgType, type AnyMsg } from './protocol'
import type { Transport } from './transport'
import { withUnreliable, type DatagramChannel } from './unreliable'

function fakeTransport() {
  const sent: AnyMsg[] = []
  let onMsg: (m: AnyMsg) => void = () => {}
  let onCls: () => void = () => {}
  const t: Transport = { send: m => { sent.push(m) }, onMessage: c => { onMsg = c }, onClose: c => { onCls = c } }
  return { t, sent, emit: (m: AnyMsg) => onMsg(m), close: () => onCls() }
}
function fakeChannel() {
  const f = fakeTransport()
  let open = true, buffered = 0
  const ch: DatagramChannel = { ...f.t, isOpen: () => open, bufferedAmount: () => buffered }
  return { ch, sent: f.sent, emit: f.emit, close: () => f.close(), setOpen: (v: boolean) => { open = v }, setBuffered: (n: number) => { buffered = n } }
}
const cmd = (seq: number) => ({ seq, buttons: 1, yaw: 0, pitch: 0, weapon: 0 })
const inputs = (...seqs: number[]): AnyMsg => ({ t: MsgType.Inputs, cmds: seqs.map(cmd) })
const snapshot: AnyMsg = { t: MsgType.Snapshot, tick: 1, serverTime: 1, ack: 0, players: [] }
const hit: AnyMsg = { t: MsgType.HitConfirm, targetId: 2, headshot: false, damage: 10 } as AnyMsg

describe('withUnreliable', () => {
  let clock = 0
  const now = () => clock
  beforeEach(() => { vi.useFakeTimers(); clock = 1000 })
  afterEach(() => { vi.useRealTimers() })
  const advance = (ms: number) => { clock += ms; vi.advanceTimersByTime(ms) }

  function setup(role: 'client' | 'server' = 'server', extra: Parameters<typeof withUnreliable>[1] extends infer O ? Partial<O> : never = {}) {
    const base = fakeTransport(), c = fakeChannel()
    const u = withUnreliable(base.t, { role, now, ...extra })
    u.setChannel(c.ch)
    return { base, c, u }
  }

  it('snapshots, inputs and pings use the channel; everything else the base', () => {
    const { base, c, u } = setup('server')
    u.send(snapshot); u.send({ t: MsgType.Pong, clientTime: 1, serverTime: 2 }); u.send(hit)
    expect(c.sent.map(m => m.t)).toEqual([MsgType.Snapshot])     // a Pong goes back the way its Ping came: no Ping yet, so the base
    expect(base.sent.map(m => m.t)).toEqual([MsgType.Pong, MsgType.HitConfirm])
    expect(u.unreliableActive!()).toBe(true)
    const cl = setup('client')
    cl.u.send({ t: MsgType.Ping, clientTime: 5 }); cl.u.send(inputs(1)); cl.u.send({ t: MsgType.Buy, key: 'ak47' })
    expect(cl.c.sent.map(m => m.t)).toEqual([MsgType.Ping, MsgType.Inputs])
    expect(cl.base.sent.map(m => m.t)).toEqual([MsgType.Buy])
  })

  it('without a channel everything goes over the base, and it is not active', () => {
    const base = fakeTransport()
    const u = withUnreliable(base.t, { role: 'server', now })
    u.send(snapshot); u.send(inputs(1))
    expect(base.sent).toHaveLength(2)
    expect(u.unreliableActive!()).toBe(false)
  })

  it('a Pong goes back the way its Ping came', () => {
    const { base, c, u } = setup('server')
    u.onMessage(() => {})
    c.emit({ t: MsgType.Ping, clientTime: 1 })
    u.send({ t: MsgType.Pong, clientTime: 1, serverTime: 5 })
    base.emit({ t: MsgType.Ping, clientTime: 2 })
    u.send({ t: MsgType.Pong, clientTime: 2, serverTime: 6 })
    expect(c.sent.map(m => m.t)).toEqual([MsgType.Pong]); expect((c.sent[0] as { clientTime: number }).clientTime).toBe(1)
    expect(base.sent.map(m => m.t)).toEqual([MsgType.Pong]); expect((base.sent[0] as { clientTime: number }).clientTime).toBe(2)
  })

  it('the client repeats the previous cmds in every Inputs packet (4 in all), without duplicates', () => {
    const { c, u } = setup('client')
    for (let seq = 1; seq <= 6; seq++) u.send(inputs(seq))
    const seqs = c.sent.map(m => (m as { cmds: { seq: number }[] }).cmds.map(x => x.seq))
    expect(seqs[0]).toEqual([1]); expect(seqs[1]).toEqual([1, 2]); expect(seqs[3]).toEqual([1, 2, 3, 4])
    expect(seqs[5]).toEqual([3, 4, 5, 6])
    u.send(inputs(7, 8))
    expect((c.sent[6] as { cmds: { seq: number }[] }).cmds.map(x => x.seq)).toEqual([5, 6, 7, 8])
  })

  it('the server never changes the packets it sends', () => {
    const { c, u } = setup('server')
    u.send(inputs(1)); u.send(inputs(2))
    expect((c.sent[1] as { cmds: unknown[] }).cmds).toHaveLength(1)
  })

  it('on the reliable path the client sends each cmd once (no repeats), and keeps the history for when it switches', () => {
    const { base, c, u } = setup('client')
    c.setOpen(false)
    u.send(inputs(1)); u.send(inputs(2))
    expect(base.sent).toHaveLength(2); expect((base.sent[1] as { cmds: unknown[] }).cmds).toHaveLength(1)
    c.setOpen(true)
    u.send(inputs(3))
    expect((c.sent[0] as { cmds: { seq: number }[] }).cmds.map(x => x.seq)).toEqual([1, 2, 3])
  })

  it('a channel that stays silent for healthMs is given up: hot messages fall back to the base, keepalives go on, and it comes back when it speaks again', () => {
    const { base, c, u } = setup('server')
    u.send(snapshot); expect(c.sent.filter(m => m.t === MsgType.Snapshot)).toHaveLength(1)
    advance(1001)
    expect(u.unreliableActive!()).toBe(false)
    u.send(snapshot)
    expect(base.sent.filter(m => m.t === MsgType.Snapshot)).toHaveLength(1)
    expect(c.sent.filter(m => (m as { ka?: boolean }).ka).length).toBeGreaterThanOrEqual(3)   // keepalives still flow every 250 ms
    expect(u.stats.fallbacks).toBe(1)
    c.emit({ t: MsgType.Ping, clientTime: 0, ka: true })   // the other end is alive again
    expect(u.unreliableActive!()).toBe(true)
    u.send(snapshot)
    expect(c.sent.filter(m => m.t === MsgType.Snapshot)).toHaveLength(2)
  })

  it('keepalives are not delivered to the listeners but anything else from the channel is', () => {
    const { c, u } = setup('client')
    const got: AnyMsg[] = []
    u.onMessage(m => got.push(m))
    c.emit({ t: MsgType.Pong, clientTime: 0, serverTime: 0, ka: true })
    c.emit(snapshot)
    expect(got).toEqual([snapshot])
    expect(u.stats.recvUnreliable).toBe(1)
  })

  it('messages from the base and from the channel reach the same listeners; signalling is consumed first', () => {
    const base = fakeTransport(), c = fakeChannel()
    const seen: AnyMsg[] = []
    const u = withUnreliable(base.t, { role: 'client', now, signaling: m => { if (m.t === MsgType.RtcAnswer) { seen.push(m); return true } return false } })
    u.setChannel(c.ch)
    const got: AnyMsg[] = []
    u.onMessage(m => got.push(m))
    base.emit({ t: MsgType.RtcAnswer, sdp: 'x' }); base.emit(hit); c.emit(snapshot)
    expect(seen).toHaveLength(1)
    expect(got.map(m => m.t)).toEqual([MsgType.HitConfirm, MsgType.Snapshot])
  })

  it('a congested channel (bufferedAmount too high) is skipped, one that drains is used again', () => {
    const { base, c, u } = setup('server')
    c.setBuffered(100_000)
    u.send(snapshot)
    expect(base.sent).toHaveLength(1); expect(c.sent.filter(m => m.t === MsgType.Snapshot)).toHaveLength(0)
    c.setBuffered(0)
    u.send(snapshot)
    expect(c.sent.filter(m => m.t === MsgType.Snapshot)).toHaveLength(1)
  })

  it('a closed channel is dropped; setChannel(null) and dispose stop the keepalive timer', () => {
    const { base, c, u } = setup('server')
    c.close()
    expect(u.channel).toBeNull()
    u.send(snapshot)
    expect(base.sent).toHaveLength(1)
    const before = c.sent.length
    advance(2000)
    expect(c.sent.length).toBe(before)   // no keepalives to a closed channel
    const x = setup('client'); x.u.dispose(); advance(1000)
    expect(x.c.sent.filter(m => (m as { ka?: boolean }).ka)).toHaveLength(0)
  })

  it('base close is forwarded', () => {
    const { base, u } = setup('server')
    const closed = vi.fn(); u.onClose(closed)
    base.close()
    expect(closed).toHaveBeenCalled()
  })
})
