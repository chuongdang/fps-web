import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withNetsim, type Transport } from './transport'
import { MsgType, type AnyMsg } from './protocol'

function fakeInner() {
  const sent: AnyMsg[] = []
  let cb: (m: AnyMsg) => void = () => {}
  const t: Transport = {
    send: m => { sent.push(m) },
    onMessage: c => { cb = c },
    onClose: () => {},
  }
  return { t, sent, emit: (m: AnyMsg) => cb(m) }
}
const ping = (n: number): AnyMsg => ({ t: MsgType.Ping, clientTime: n })

describe('withNetsim', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('each direction is delayed by latencyMs', () => {
    const { t, sent, emit } = fakeInner()
    const ns = withNetsim(t, { latencyMs: 80, jitterMs: 0, now: () => Date.now() })
    const got: AnyMsg[] = []
    ns.onMessage(m => got.push(m))
    ns.send(ping(1))
    emit(ping(2))
    vi.advanceTimersByTime(79)
    expect(sent.length).toBe(0)
    expect(got.length).toBe(0)
    vi.advanceTimersByTime(1)
    expect(sent.length).toBe(1)
    expect(got.length).toBe(1)
  })

  it('large jitter still keeps the order', () => {
    const { t, sent, emit } = fakeInner()
    // random alternates 0 and 1 → delay alternates smallest/largest
    let i = 0
    const random = () => (i++ % 2 === 0 ? 1 : 0)
    const ns = withNetsim(t, { latencyMs: 50, jitterMs: 40, now: () => Date.now(), random })
    const got: number[] = []
    ns.onMessage(m => got.push((m as { clientTime: number }).clientTime))
    for (let n = 0; n < 50; n++) {
      ns.send(ping(n))
      emit(ping(n))
      vi.advanceTimersByTime(5)
    }
    vi.advanceTimersByTime(1000)
    const out = sent.map(m => (m as { clientTime: number }).clientTime)
    const seq = Array.from({ length: 50 }, (_, k) => k)
    expect(out).toEqual(seq)
    expect(got).toEqual(seq)
  })

  it('a stall holds everything back and releases it together, in order, at the end of the freeze', () => {
    const { t, sent, emit } = fakeInner()
    const ns = withNetsim(t, { latencyMs: 0, jitterMs: 0, stallEveryMs: 1000, stallMs: 200, now: () => Date.now() })
    const got: number[] = []
    ns.onMessage(m => got.push((m as { clientTime: number }).clientTime))
    vi.advanceTimersByTime(900)
    ns.send(ping(1)); emit(ping(1))                       // before the freeze: normal
    vi.advanceTimersByTime(0)
    expect(sent.length).toBe(1); expect(got).toEqual([1])
    vi.advanceTimersByTime(100)                            // t = 1000: the freeze starts
    for (let n = 2; n <= 5; n++) { ns.send(ping(n)); emit(ping(n)); vi.advanceTimersByTime(40) }   // sent at 1000..1120
    expect(sent.length).toBe(1); expect(got).toEqual([1])  // nothing got through yet (t = 1160)
    vi.advanceTimersByTime(39)
    expect(sent.length).toBe(1)                            // t = 1199
    vi.advanceTimersByTime(1)                              // t = 1200: the freeze ends, everything arrives at once
    expect(sent.map(m => (m as { clientTime: number }).clientTime)).toEqual([1, 2, 3, 4, 5])
    expect(got).toEqual([1, 2, 3, 4, 5])
    ns.send(ping(6)); vi.advanceTimersByTime(0)            // after the freeze: normal again
    expect(sent.length).toBe(6)
  })

  it('stall options off: nothing changes', () => {
    const { t, sent } = fakeInner()
    const ns = withNetsim(t, { latencyMs: 0, jitterMs: 0, stallEveryMs: 0, stallMs: 300, now: () => Date.now() })
    vi.advanceTimersByTime(5000)
    ns.send(ping(1)); vi.advanceTimersByTime(0)
    expect(sent.length).toBe(1)
  })

  it('lossPct drops messages in both directions: 100 drops all, 0 none, 30 about a third', () => {
    const count = (lossPct: number, n: number) => {
      const { t, sent, emit } = fakeInner()
      let seed = 7
      const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
      const ns = withNetsim(t, { latencyMs: 0, jitterMs: 0, lossPct, now: () => Date.now(), random })
      let got = 0
      ns.onMessage(() => { got++ })
      for (let i = 0; i < n; i++) { ns.send(ping(i)); emit(ping(i)); vi.advanceTimersByTime(0) }
      return { out: sent.length, in: got }
    }
    expect(count(100, 50)).toEqual({ out: 0, in: 0 })
    expect(count(0, 50)).toEqual({ out: 50, in: 50 })
    const r = count(30, 2000)
    expect(r.out / 2000).toBeGreaterThan(0.65); expect(r.out / 2000).toBeLessThan(0.75)
    expect(r.in / 2000).toBeGreaterThan(0.65); expect(r.in / 2000).toBeLessThan(0.75)
  })

  it('unordered: jitter may let a later message overtake an earlier one (UDP), ordered never does', () => {
    const run = (unordered: boolean) => {
      const { t, emit } = fakeInner()
      let i = 0
      const random = () => (i++ % 2 === 0 ? 1 : 0)   // delays alternate 60 ms / 0 ms (latency 30, jitter 30)
      const ns = withNetsim(t, { latencyMs: 30, jitterMs: 30, unordered, now: () => Date.now(), random })
      const got: number[] = []
      ns.onMessage(m => got.push((m as { clientTime: number }).clientTime))
      i = 0
      for (let n = 0; n < 6; n++) { emit(ping(n)); vi.advanceTimersByTime(10) }
      vi.advanceTimersByTime(500)
      return got
    }
    expect(run(false)).toEqual([0, 1, 2, 3, 4, 5])
    const u = run(true)
    expect([...u].sort()).toEqual([0, 1, 2, 3, 4, 5])   // nothing lost
    expect(u).not.toEqual([0, 1, 2, 3, 4, 5])           // but overtaken
  })
})

