import { describe, it, expect, vi } from 'vitest'
import * as THREE from 'three'
import { DT, GRENADE, MsgType, stepGrenade, type GrenadeSpawnMsg, type GrenadeState } from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'
import { createGrenades } from './grenades'

// Floor at y = 0, no walls
const floor: CollisionWorld = {
  moveCharacter: (p) => ({ pos: p, grounded: true, hitCeiling: false }), canStand: () => true, castRay: () => null,
  castSphere: (o, d, max, r) => { if (d[1] >= -1e-9) return null; const t = (o[1] - r) / -d[1]; return t >= 0 && t <= max ? { dist: t, normal: [0, 1, 0] } : null },
  debugRender: () => ({ vertices: new Float32Array(0), colors: new Float32Array(0) }), dispose: () => {},
}
const spawnMsg = (over: Partial<GrenadeSpawnMsg> = {}): GrenadeSpawnMsg =>
  ({ t: MsgType.GrenadeSpawn, id: 5, ownerId: 1, mode: 'strong', pos: [0, 1.6, 0], vel: [10, 3, 0], spawnTick: 100, throwSeq: 1, ...over })
const make = (offline = false) => {
  const scene = new THREE.Scene()
  const onExplode = vi.fn(), onBounce = vi.fn()
  const g = createGrenades(scene, { world: () => floor, localFuse: () => offline, onExplode, onBounce })
  return { g, scene, onExplode, onBounce }
}
const ref = (pos: [number, number, number], vel: [number, number, number], steps: number): GrenadeState => {
  const s: GrenadeState = { id: 0, ownerId: 1, team: 'A', pos: [...pos], vel: [...vel], spawnTick: 0, resting: false }
  for (let i = 0; i < steps; i++) stepGrenade(s, floor, DT)
  return s
}
const TICK_MS = 1000 / 60

describe('grenades (client G.4)', () => {
  it('grenade of another player: fast-forwarded from spawnTick to render time, matches stepGrenade exactly', () => {
    const { g } = make()
    const origin = 1000   // serverTime of tick 0
    g.onSpawn(spawnMsg(), origin, 9, 'B')
    const renderMs = origin + 100 * TICK_MS + 30 * TICK_MS   // 30 ticks since the throw
    g.update(0.016, renderMs, 50)
    const want = ref([0, 1.6, 0], [10, 3, 0], 30)
    const v = g.list()[0]!
    // displayed position is within one step of the state after 30 ticks
    expect(Math.abs(v.pos.x - want.pos[0])).toBeLessThan(0.2); expect(Math.abs(v.pos.y - want.pos[1])).toBeLessThan(0.2)
    expect(v.id).toBe(5); expect(v.predicted).toBe(false)
  })

  it('predicted grenade: gets an id when the GrenadeSpawn with the same throwSeq arrives; if off by < 0.2 m the trajectory is kept', () => {
    const { g } = make()
    g.spawnLocal(3, 1, 'A', [0, 1.6, 0], [10, 3, 0], 'strong')
    g.update(0.1, 0, 50)
    const before = g.list()[0]!.pos.clone()
    g.onSpawn(spawnMsg({ id: 8, throwSeq: 3, pos: [0.05, 1.6, 0], vel: [10, 3, 0] }), 0, 1, 'A')
    g.update(0.016, 0, 50)
    expect(g.list()).toHaveLength(1)
    expect(g.list()[0]!.id).toBe(8)
    expect(g.list()[0]!.pos.distanceTo(before)).toBeLessThan(0.5)   // no jump
  })

  it('predicted grenade far from the server one: switches to the server trajectory (blended)', () => {
    const { g } = make()
    g.spawnLocal(3, 1, 'A', [0, 1.6, 0], [10, 3, 0], 'strong')
    g.update(0.1, 0, 50)
    g.onSpawn(spawnMsg({ id: 8, throwSeq: 3, pos: [0, 1.6, 2], vel: [0, 3, 10] }), 0, 1, 'A')   // server threw in a different direction
    g.update(0.001, 0, 50)
    const first = g.list()[0]!.pos.clone()
    for (let i = 0; i < 30; i++) g.update(0.016, 0, 50)
    const later = g.list()[0]!.pos
    expect(later.z).toBeGreaterThan(first.z + 1)   // now flying in the server direction (z+)
  })

  it('server does not confirm within 500 ms (+RTT): predicted grenade is removed', () => {
    let now = 0
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => now)
    const { g } = make()
    g.spawnLocal(3, 1, 'A', [0, 1.6, 0], [10, 3, 0], 'strong')
    now = 300; g.update(0.016, 0, 50); expect(g.list()).toHaveLength(1)
    now = 700; g.update(0.016, 0, 50); expect(g.list()).toHaveLength(0)
    // high RTT: longer deadline
    const h = make().g
    now = 0; h.spawnLocal(4, 1, 'A', [0, 1.6, 0], [10, 3, 0], 'strong')
    now = 700; h.update(0.016, 0, 400); expect(h.list()).toHaveLength(1)
    spy.mockRestore()
  })

  it('GrenadeExplode: explodes where the server says, removes the grenade even if local time has not reached it yet', () => {
    const { g, onExplode } = make()
    g.onSpawn(spawnMsg(), 0, 9, 'B')
    g.update(0.016, 100 * TICK_MS + 10, 50)
    g.onExplode({ t: MsgType.GrenadeExplode, id: 5, pos: [3, 0.1, 4], hits: [{ id: 2, damage: 40 }] })
    expect(g.list()).toHaveLength(0)
    expect(onExplode).toHaveBeenCalledWith([3, 0.1, 4], [{ id: 2, damage: 40 }], 'm67', 5)
    // grenade not in the list (joined the room late): the explosion effect still plays
    g.onExplode({ t: MsgType.GrenadeExplode, id: 99, pos: [1, 1, 1], hits: [] })
    expect(onExplode).toHaveBeenCalledTimes(2)
  })

  it('smoke: GrenadeSpawn/Explode carry kind; the smoke grenade fuse ends earlier than HE when running offline', () => {
    const { g, onExplode } = make(true)
    g.spawnLocal(1, 1, 'A', [0, 2, 0], [0, 0, 0], 'lob', 'smoke')
    expect(g.list()[0]!.kind).toBe('smoke')
    for (let i = 0; i < 60; i++) g.update(0.05, 0, 0)   // 3s > smoke fuse (1.8s)
    expect(onExplode).toHaveBeenCalledTimes(1)
    expect(onExplode.mock.calls[0]![2]).toBe('smoke')
    g.onExplode({ t: MsgType.GrenadeExplode, id: 7, pos: [1, 1, 1], hits: [], kind: 'smoke' })
    expect(onExplode.mock.calls[1]).toEqual([[1, 1, 1], [], 'smoke', 7])
  })

  it('offline: explodes by itself when the fuse runs out; bounce event fires on touching the floor', () => {
    const { g, onExplode, onBounce } = make(true)
    g.spawnLocal(1, 1, 'A', [0, 2, 0], [2, 0, 0], 'lob')
    for (let i = 0; i < 100; i++) g.update(0.016, 0, 0)
    expect(onBounce).toHaveBeenCalled()
    expect(onExplode).not.toHaveBeenCalled()
    for (let i = 0; i < 160; i++) g.update(0.016, 0, 0)   // total ~4.2 s > fuseMs
    expect(onExplode).toHaveBeenCalledTimes(1)
    expect(GRENADE.fuseMs).toBe(3000)
  })
})
