import { describe, it, expect } from 'vitest'
import { locoTargets, makeSlotWeights, SLOTS, slotClip } from './locomotion'
import { poses } from './poses'

const cfg = poses.character.anim
const base = { vx: 0, vz: 0, yaw: 0, grounded: true, crouching: false, sliding: false }
const sum = (w: Record<string, number>) => SLOTS.reduce((a, s) => a + w[s]!, 0)

describe('locoTargets', () => {
  it('standing still -> idle, total weight 1', () => {
    const w = makeSlotWeights(); locoTargets(base, cfg, w)
    expect(w.idle).toBe(1); expect(sum(w)).toBeCloseTo(1)
  })
  it('yaw 0: moving toward −Z is forward, +Z is backward, +X is right, −X is left', () => {
    const w = makeSlotWeights()
    locoTargets({ ...base, vz: -2 }, cfg, w); expect(w.walkF).toBeCloseTo(1)
    locoTargets({ ...base, vz: 2 }, cfg, w); expect(w.walkB).toBeCloseTo(1)
    locoTargets({ ...base, vx: 2 }, cfg, w); expect(w.walkR).toBeCloseTo(1)
    locoTargets({ ...base, vx: -2 }, cfg, w); expect(w.walkL).toBeCloseTo(1)
  })
  it('direction follows yaw: turning left 90° (yaw = π/2) makes forward point to −X', () => {
    const w = makeSlotWeights(); locoTargets({ ...base, yaw: Math.PI / 2, vx: -2 }, cfg, w)
    expect(w.walkF).toBeCloseTo(1)
  })
  it('diagonal movement splits evenly between two directions, total = 1', () => {
    const w = makeSlotWeights(); locoTargets({ ...base, vx: 1.5, vz: -1.5 }, cfg, w)
    expect(w.walkF).toBeCloseTo(w.walkR); expect(sum(w)).toBeCloseTo(1)
  })
  it('running fast forward uses run', () => {
    const w = makeSlotWeights(); locoTargets({ ...base, vz: -8 }, cfg, w)
    expect(w.run).toBeCloseTo(1); expect(sum(w)).toBeCloseTo(1)
  })
  it('running fast backward does not use run', () => {
    const w = makeSlotWeights(); locoTargets({ ...base, vz: 8 }, cfg, w)
    expect(w.run).toBe(0); expect(w.walkB).toBeCloseTo(1)
  })
  it('airborne / sliding / crouching', () => {
    const w = makeSlotWeights()
    locoTargets({ ...base, grounded: false, vz: -5 }, cfg, w); expect(w.jump).toBe(1)
    locoTargets({ ...base, sliding: true, vz: -9 }, cfg, w); expect(w.slide).toBe(1)
    locoTargets({ ...base, crouching: true }, cfg, w); expect(w.crouchIdle).toBe(1)
    locoTargets({ ...base, crouching: true, vz: -3 }, cfg, w); expect(w.crouchWalk).toBe(1)
  })
  it('pistol uses the pistol set for idle/walk/run, borrows rifle for backward/strafe', () => {
    expect(slotClip('idle', true)).toBe('pistol_idle')
    expect(slotClip('walkB', true)).toBe('rifle_walk_b')
    expect(slotClip('run', false)).toBe('rifle_run_f')
  })
})
