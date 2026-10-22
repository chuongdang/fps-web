import { describe, it, expect, beforeAll } from 'vitest'
import { MatchPhase, type ScoreboardRow } from '@fps/shared'
import { bannerText, formatClock, sortRows } from './hudMatch'
import { setLang } from './i18n'

beforeAll(() => setLang('en'))

const row = (id: number, team: 'A' | 'B', kills: number, deaths = 0): ScoreboardRow => ({ id, name: `p${id}`, team, kills, deaths, ping: 0 })

describe('hudMatch', () => {
  it('formatClock rounds up to whole seconds', () => {
    expect(formatClock(600_000)).toBe('10:00')
    expect(formatClock(59_001)).toBe('1:00')
    expect(formatClock(1)).toBe('0:01')
    expect(formatClock(-5)).toBe('0:00')
  })
  it('sortRows: filters by team, kills descending, ties broken by fewer deaths', () => {
    const rows = [row(1, 'A', 2, 5), row(2, 'B', 9), row(3, 'A', 7), row(4, 'A', 2, 1)]
    expect(sortRows(rows, 'A').map(r => r.id)).toEqual([3, 4, 1])
    expect(sortRows(rows, 'B').map(r => r.id)).toEqual([2])
  })
  it('bannerText only shows in ENDED: win / draw', () => {
    expect(bannerText(MatchPhase.Playing, 5, 1)).toBe('')
    expect(bannerText(MatchPhase.Ended, 5, 1)).toBe('COPS WIN')
    expect(bannerText(MatchPhase.Ended, 1, 5)).toBe('TERRORISTS WIN')
    expect(bannerText(MatchPhase.Ended, 3, 3)).toBe('DRAW')
  })
})

describe('Elimination HUD', () => {
  it('round-end banner + reason', async () => {
    const { roundBannerText, reasonText, clockColor } = await import('./hudMatch')
    expect(roundBannerText('A', 5)).toBe('COPS WIN ROUND 5')
    expect(roundBannerText('B', 12)).toBe('TERRORISTS WIN ROUND 12')
    expect(roundBannerText(null, 3)).toBe('ROUND DRAWN')
    expect(reasonText('elimination')).toBe('Everyone eliminated')
    expect(reasonText('time_alive')).toBe('Time up · more players alive')
    expect(reasonText('time_hp')).toBe('Time up · more health left')
    expect(clockColor(4, 3000)).toBe('#ffd23c')   // FREEZE yellow
    expect(clockColor(2, 9000)).toBe('#ff5555')   // LIVE < 10s red
    expect(clockColor(2, 30_000)).toBe('#fff')
  })
})
