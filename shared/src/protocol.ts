import { encode as mpEncode, decode as mpDecode } from '@msgpack/msgpack'

// Phân loại message — sẽ được điền dần theo từng phase
export const MsgType = {
  Input: 1,
  Snapshot: 2,
  Join: 3,
  Leave: 4,
} as const

export type MsgTypeValue = (typeof MsgType)[keyof typeof MsgType]

// Placeholder types — sẽ mở rộng ở phase 3+
export interface InputMsg {
  t: typeof MsgType.Input
}

export interface SnapshotMsg {
  t: typeof MsgType.Snapshot
}

export interface JoinMsg {
  t: typeof MsgType.Join
}

export interface LeaveMsg {
  t: typeof MsgType.Leave
}

export type AnyMsg = InputMsg | SnapshotMsg | JoinMsg | LeaveMsg

export function encode(msg: AnyMsg): Uint8Array {
  return mpEncode(msg)
}

export function decode(buf: Uint8Array | ArrayBuffer): AnyMsg {
  return mpDecode(buf) as AnyMsg
}
