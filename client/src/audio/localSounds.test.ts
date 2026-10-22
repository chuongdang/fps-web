import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { LOCAL_SOUNDS } from './localSounds'

const dir = join(__dirname, '../../public/sounds/local')

// The local folder is not in git: only checked when this machine has it (catches filename typos in the mapping table)
describe.runIf(existsSync(join(dir, 'weapons')))('LOCAL_SOUNDS', () => {
  it('every mapped file exists', () => {
    const have = new Set([...readdirSync(join(dir, 'weapons')).map(f => `weapons/${f}`), ...readdirSync(join(dir, 'player')).map(f => `player/${f}`)])
    const missing = Object.entries(LOCAL_SOUNDS).filter(([, f]) => !have.has(`${f}.wav`)).map(([k, f]) => `${k} → ${f}`)
    expect(missing).toEqual([])
  })
})
