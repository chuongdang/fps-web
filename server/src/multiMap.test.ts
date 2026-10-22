import { describe, it, expect } from 'vitest'
import { MsgType, loadMap, type AnyMsg, type MapFile, type Transport } from '@fps/shared'
import { RoomManager } from './room'
import { createGameServer } from './gameServer'

// Two maps that differ in everything the server hands to a room: name, spawns, floor size
const arena: MapFile = {
  name: 'Arena', mirrorX: true,
  boxes: [{ pos: [0, -0.5, 0], size: [40, 1, 40], texture: 'floor', noMirror: true }],
  ramps: [], spawnsA: [{ pos: [-15, 1, 0], yaw: 0 }],
}
const canyon: MapFile = {
  name: 'Canyon', mirrorX: false,
  boxes: [{ pos: [0, -0.5, 0], size: [80, 1, 80], texture: 'floor' }],
  ramps: [], spawnsA: [{ pos: [30, 1, 30], yaw: 0 }],
}

function fake() {
  const got: AnyMsg[] = []
  const t: Transport = { send: m => { got.push(m) }, onMessage: () => {}, onClose: () => {} }
  return { t, got }
}

describe('several maps', () => {
  it('Welcome names the map of the room that was joined', () => {
    const rm = new RoomManager(loadMap(arena), () => 0, undefined, 'arena')
    rm.registerMap('canyon', 'Canyon', loadMap(canyon))
    const a = fake(), b = fake(), c = fake()
    rm.join('r1', 'A', a.t)
    rm.join('r2', 'B', b.t, 0, 'auto', undefined, 'canyon')
    rm.join('r2', 'C', c.t)   // a later joiner has no mapId of its own: it gets the room's map
    expect(a.got[0]).toMatchObject({ t: MsgType.Welcome, mapId: 'arena', mapName: 'Arena' })
    expect(b.got[0]).toMatchObject({ t: MsgType.Welcome, mapId: 'canyon', mapName: 'Canyon' })
    expect(c.got[0]).toMatchObject({ t: MsgType.Welcome, mapId: 'canyon', mapName: 'Canyon' })
  })

  it('an unknown map id falls back to the default map', () => {
    const rm = new RoomManager(loadMap(arena), () => 0, undefined, 'arena')
    const a = fake()
    rm.join('r1', 'A', a.t, 0, 'auto', undefined, 'nope')
    expect(a.got[0]).toMatchObject({ t: MsgType.Welcome, mapId: 'arena' })
  })

  it('players spawn on the spawns of their own room map', () => {
    const rm = new RoomManager(loadMap(arena), () => 0, undefined, 'arena')
    rm.registerMap('canyon', 'Canyon', loadMap(canyon))
    const inArena = rm.join('r1', 'A', fake().t, 0, 'A').player
    const inCanyon = rm.join('r2', 'B', fake().t, 0, 'A', undefined, 'canyon').player
    expect(inArena.state.pos[0]).toBeCloseTo(-15)
    expect(inCanyon.state.pos[0]).toBeCloseTo(30)
    expect(inCanyon.state.pos[2]).toBeCloseTo(30)
  })

  it('the room list offers every map', () => {
    const rm = new RoomManager(loadMap(arena), () => 0, undefined, 'arena')
    rm.registerMap('canyon', 'Canyon', loadMap(canyon))
    expect(rm.mapList()).toEqual([{ id: 'arena', name: 'Arena' }, { id: 'canyon', name: 'Canyon' }])
  })

  it('the game server builds a nav grid for every map, not only the default one', async () => {
    const game = createGameServer({ maps: { deathmatch: arena, canyon }, allowDebugCmds: false })
    await game.ready
    try {
      expect([...game.rooms.navs.keys()].sort()).toEqual(['canyon', 'deathmatch'])
      expect(game.rooms.navs.get('canyon')!.count).toBeGreaterThan(game.rooms.navs.get('deathmatch')!.count)   // 80x80 floor vs 40x40
    } finally { game.close() }
  }, 20_000)
})
