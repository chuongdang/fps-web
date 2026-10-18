import { describe, it, expect } from 'vitest'
import { VERSION } from './index'

describe('placeholder', () => {
  it('passes', () => {
    expect(1 + 1).toBe(2)
  })

  it('shared exports VERSION', () => {
    expect(typeof VERSION).toBe('string')
  })
})
