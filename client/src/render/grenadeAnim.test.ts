import { describe, it, expect } from 'vitest'
import { poses } from './poses'
import { GrenadeAnim, pathSegment } from './grenadeAnim'

const cfg = () => poses.weapons.m67!.first.grenade!
const run = (a: GrenadeAnim, ms: number, step = 8) => { for (let t = 0; t < ms; t += step) a.update(step) }

describe('GrenadeAnim (G.5)', () => {
  it('idle: grenade at idlePos, left hand at leftRest, pin still on the grenade', () => {
    const a = new GrenadeAnim(cfg); const o = a.update(16)
    expect(o.pos).toEqual(cfg().idlePos); expect(o.leftS).toBe(-1); expect(o.pin).toBe('onGrenade'); expect(o.show).toBe(true)
  })

  it('pull pin: left hand follows the path, pin moves to the left hand at t=0.75, grenade goes from idlePos to readyPos', () => {
    const a = new GrenadeAnim(cfg)
    a.setLogic('pulling', 'strong', 0.3, true); let o = a.update(16)
    expect(a.phase).toBe('pull'); expect(o.leftS).toBeCloseTo(0.3); expect(o.pin).toBe('onGrenade')
    a.setLogic('pulling', 'strong', 0.8, true); o = a.update(16); expect(o.pin).toBe('onLeftHand')
    a.setLogic('pulling', 'strong', 1, true); a.update(16)
    a.setLogic('ready', 'strong', 1, true); o = a.update(16)
    expect(a.phase).toBe('ready'); expect(o.pin).toBe('onLeftHand')
    expect(o.pos[0]).toBeCloseTo(cfg().readyPos.strong[0], 6); expect(o.pos[2]).toBeCloseTo(cfg().readyPos.strong[2], 6)
  })

  it('low-throw mode uses readyPos.lob', () => {
    const a = new GrenadeAnim(cfg)
    a.setLogic('ready', 'lob', 1, true); a.update(16)
    const o = a.update(16)
    expect(o.pos[1]).toBeCloseTo(cfg().readyPos.lob[1], 1)
  })

  it('throw: the held grenade hides at once, swings to throwPos, then lowers; if any are left, a new one is brought up', () => {
    const a = new GrenadeAnim(cfg)
    a.setLogic('ready', 'strong', 1, true); a.update(16)
    a.onThrow(); a.setLogic('idle', 'strong', 0, true)
    let o = a.update(16); expect(o.show).toBe(false); expect(a.phase).toBe('windup')
    run(a, cfg().windupMs + 8); expect(a.phase).toBe('throw')
    let last = a.out.pos[2]
    for (let i = 0; i < 200 && a.phase === 'throw'; i++) { last = a.update(2).pos[2] }
    expect(last).toBeLessThan(cfg().readyPos.strong[2] - 0.3)   // swung forward
    run(a, cfg().recoverMs + 16)
    expect(a.phase).toBe('raise')
    o = a.update(16); expect(o.show).toBe(true); expect(o.pin).toBe('onGrenade'); expect(o.pos[1]).toBeLessThan(cfg().idlePos[1] - 0.3)
    run(a, cfg().recoverMs + 16); expect(a.phase).toBe('idle')
    expect(a.update(16).pos).toEqual(cfg().idlePos)
  })

  it('last grenade: after recover no new one is brought up (stays hidden)', () => {
    const a = new GrenadeAnim(cfg)
    a.setLogic('ready', 'strong', 1, false); a.update(16)
    a.onThrow(); a.setLogic('idle', 'strong', 0, false)
    run(a, cfg().windupMs + cfg().throwMs + cfg().recoverMs + 100)
    expect(a.phase).toBe('idle'); expect(a.out.show).toBe(false)
  })

  it('early release (cancel): smoothly returns to idle, pin does not leave the grenade', () => {
    const a = new GrenadeAnim(cfg)
    a.setLogic('pulling', 'strong', 0.5, true); run(a, 100)
    a.setLogic('idle', 'strong', 0, true)
    const o = a.update(16); expect(a.phase).toBe('cancel')
    run(a, 200); expect(a.phase).toBe('idle'); expect(a.out.pin).toBe('onGrenade'); expect(a.out.pos).toEqual(cfg().idlePos)
    void o
  })

  it('pressed again while a new grenade is being brought up: logic phase is accepted when done', () => {
    const a = new GrenadeAnim(cfg)
    a.setLogic('ready', 'strong', 1, true); a.update(16); a.onThrow(); a.setLogic('idle', 'strong', 0, true)
    run(a, cfg().windupMs + cfg().throwMs + cfg().recoverMs + 16); expect(a.phase).toBe('raise')
    a.setLogic('pulling', 'strong', 0.2, true)
    run(a, cfg().recoverMs + 40)
    expect(a.phase).toBe('pull')
  })

  it('pathSegment: interpolates between two keys by s', () => {
    const k = cfg().pullLeftHandPath
    expect(pathSegment(k, 0).a.t).toBe(0)
    expect(pathSegment(k, 0.6).a.to).toBe('pin_pull'); expect(pathSegment(k, 0.6).b.offset).toBeDefined()
    expect(pathSegment(k, 1).u).toBe(1)
  })
})
