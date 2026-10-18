import { describe, it, expect } from 'vitest'
import { encode, decode, MsgType } from './protocol'

describe('encode / decode', () => {
  it('round-trip InputMsg', () => {
    const msg = { t: MsgType.Input }
    const buf = encode(msg)
    const result = decode(buf)
    expect(result).toEqual(msg)
  })

  it('round-trip SnapshotMsg', () => {
    const msg = { t: MsgType.Snapshot }
    const buf = encode(msg)
    expect(decode(buf)).toEqual(msg)
  })

  it('encode trả về Uint8Array', () => {
    const buf = encode({ t: MsgType.Join })
    expect(buf).toBeInstanceOf(Uint8Array)
  })

  it('decode object có thêm field', () => {
    // Kiểm tra msgpack giữ nguyên giá trị số nguyên và string
    const msg = { t: MsgType.Input, seq: 42, name: 'player1' } as unknown as Parameters<typeof encode>[0]
    const result = decode(encode(msg)) as unknown as Record<string, unknown>
    expect(result['t']).toBe(MsgType.Input)
    expect(result['seq']).toBe(42)
    expect(result['name']).toBe('player1')
  })
})
