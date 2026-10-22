import { describe, expect, it } from 'vitest'
import { MsgType, loadMap, type AnyMsg, type MapFile, type Transport } from '@fps/shared'
import { handleConnection } from './connection'
import { RoomManager } from './room'

const map = loadMap({
  name: 'test', mirrorX: true, boxes: [], ramps: [],
  spawnsA: [{ pos: [-25, 1, 0], yaw: 0 }, { pos: [-24, 1, 2], yaw: 0 }],
} as MapFile)

function connect(version: string | undefined) {
  const got: AnyMsg[] = []
  let onMsg: (m: AnyMsg) => void = () => {}
  const t: Transport = { send: m => { got.push(m) }, onMessage: cb => { onMsg = cb }, onClose: () => {} }
  const rooms = new RoomManager(map, () => 0)
  handleConnection({ rooms, cfg: {} as never, tick: () => 0, now: () => 0, allowDebugCmds: false, version }, t)
  return { got, rooms, send: onMsg }
}

describe('client/server version check', () => {
  it('different or missing version -> JoinRejected(version), no room created, later messages ignored', () => {
    for (const v of ['1.2.0', undefined]) {
      const c = connect('1.3.0')
      c.send({ t: MsgType.Join, name: 'A', room: 'r', version: v })
      expect(c.got).toEqual([{ t: MsgType.JoinRejected, reason: 'version' }])
      expect(c.rooms.rooms.size).toBe(0)
      c.send({ t: MsgType.ListRooms, version: '1.3.0' })
      expect(c.got).toHaveLength(1)
    }
  })
  it('ListRooms with a wrong version is also rejected; a correct one returns the list', () => {
    const bad = connect('1.3.0'); bad.send({ t: MsgType.ListRooms })
    expect(bad.got[0]).toEqual({ t: MsgType.JoinRejected, reason: 'version' })
    const ok = connect('1.3.0'); ok.send({ t: MsgType.ListRooms, version: '1.3.0' })
    expect(ok.got[0]?.t).toBe(MsgType.RoomList)
  })
  it('a server without a version (offline) does not check', () => {
    const c = connect(undefined); c.send({ t: MsgType.ListRooms })
    expect(c.got[0]?.t).toBe(MsgType.RoomList)
  })
})
