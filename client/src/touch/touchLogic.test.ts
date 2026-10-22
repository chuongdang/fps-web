import { describe, it, expect } from 'vitest'
import { Btn } from '@fps/shared'
import { moveBits, clampToRadius } from './joystick'
import { lookStep, PITCH_LIMIT } from './look'
import { joystickRadius } from './layout'
import { TOUCH } from './config'

const R = 60
const polar = (deg: number, len: number): [number, number] => {   // 0° = straight up (forward), clockwise on screen
  const a = deg * Math.PI / 180
  return [Math.sin(a) * len, -Math.cos(a) * len]
}

describe('moveBits (virtual stick -> digital move buttons)', () => {
  it('does nothing inside the dead zone', () => {
    expect(moveBits(0, 0, R)).toBe(0)
    expect(moveBits(0, -R * TOUCH.deadZone * 0.9, R)).toBe(0)
  })
  it('the four straight directions press exactly one button', () => {
    expect(moveBits(...polar(0, R), R)).toBe(Btn.Forward)
    expect(moveBits(...polar(180, R), R)).toBe(Btn.Back)
    expect(moveBits(...polar(270, R), R)).toBe(Btn.Left)
    expect(moveBits(...polar(90, R), R)).toBe(Btn.Right)
  })
  it('the four diagonals press two buttons', () => {
    expect(moveBits(...polar(45, R), R)).toBe(Btn.Forward | Btn.Right)
    expect(moveBits(...polar(315, R), R)).toBe(Btn.Forward | Btn.Left)
    expect(moveBits(...polar(135, R), R)).toBe(Btn.Back | Btn.Right)
    expect(moveBits(...polar(225, R), R)).toBe(Btn.Back | Btn.Left)
  })
  it('a thumb that drifts a little off straight ahead still only walks forward (sector edge at 22.5°)', () => {
    expect(moveBits(...polar(15, R), R)).toBe(Btn.Forward)
    expect(moveBits(...polar(-15, R), R)).toBe(Btn.Forward)
    expect(moveBits(...polar(30, R), R)).toBe(Btn.Forward | Btn.Right)
  })
  it('never presses opposite buttons together', () => {
    for (let d = 0; d < 360; d += 5) {
      const b = moveBits(...polar(d, R), R)
      expect((b & Btn.Forward) !== 0 && (b & Btn.Back) !== 0).toBe(false)
      expect((b & Btn.Left) !== 0 && (b & Btn.Right) !== 0).toBe(false)
    }
  })
  it('pulling the thumb far past the circle still gives the same direction', () => {
    expect(moveBits(...polar(45, R * 5), R)).toBe(Btn.Forward | Btn.Right)
  })
})

describe('clampToRadius (knob position)', () => {
  const out = { x: 0, y: 0 }
  it('keeps the thumb position inside the circle and leaves close positions alone', () => {
    clampToRadius(30, 40, R, out)
    expect(out).toEqual({ x: 30, y: 40 })
    clampToRadius(300, 400, R, out)
    expect(Math.hypot(out.x, out.y)).toBeCloseTo(R)
    expect(out.x / out.y).toBeCloseTo(0.75)   // same direction
  })
})

describe('lookStep (drag to look)', () => {
  const out = { yaw: 0, pitch: 0 }
  it('dragging right turns right, like the mouse (yaw decreases), dragging up looks up', () => {
    lookStep(0, 0, 100, 0, TOUCH.lookSens, 1, out)
    expect(out.yaw).toBeCloseTo(-100 * TOUCH.lookSens)
    lookStep(0, 0, 0, -40, TOUCH.lookSens, 1, out)
    expect(out.pitch).toBeCloseTo(40 * TOUCH.lookSens)
  })
  it('zoomed in (sensScale < 1) turns the camera less for the same drag', () => {
    lookStep(0, 0, 100, 0, TOUCH.lookSens, 0.25, out)
    expect(out.yaw).toBeCloseTo(-100 * TOUCH.lookSens * 0.25)
  })
  it('pitch is clamped just below straight up / down', () => {
    lookStep(0, 1.5, 0, -1e6, TOUCH.lookSens, 1, out)
    expect(out.pitch).toBe(PITCH_LIMIT)
    lookStep(0, -1.5, 0, 1e6, TOUCH.lookSens, 1, out)
    expect(out.pitch).toBe(-PITCH_LIMIT)
  })
  it('the yaw is not clamped (it wraps around freely)', () => {
    lookStep(10, 0, 1e5, 0, TOUCH.lookSens, 1, out)
    expect(out.yaw).toBeLessThan(-100)
  })
})

describe('stick size', () => {
  it('follows the shorter screen side and stays within the min / max', () => {
    expect(joystickRadius(844, 390)).toBeCloseTo(390 * TOUCH.joystickRadiusFrac)
    expect(joystickRadius(300, 200)).toBe(TOUCH.joystickRadiusMin)
    expect(joystickRadius(2000, 1500)).toBe(TOUCH.joystickRadiusMax)
  })
  it('the same on a phone held either way (shorter side)', () => {
    expect(joystickRadius(390, 844)).toBe(joystickRadius(844, 390))
  })
})
