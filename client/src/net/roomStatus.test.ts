import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getLang, setLang } from '../i18n'
import { roomStatusText } from './roomStatus'

describe('roomStatusText', () => {
  const prev = getLang()
  afterAll(() => setLang(prev))

  describe('English', () => {
    beforeAll(() => setLang('en'))
    it('simple states', () => {
      expect(roomStatusText({ code: 'waiting' })).toBe('Waiting')
      expect(roomStatusText({ code: 'preparing' })).toBe('Preparing')
      expect(roomStatusText({ code: 'ended' })).toBe('Ended')
    })
    it('states with numbers', () => {
      expect(roomStatusText({ code: 'timeLeft', seconds: 372, scoreA: 23, scoreB: 18 })).toBe('06:12 left · 23–18')
      expect(roomStatusText({ code: 'round', round: 5, maxRounds: 19, scoreA: 3, scoreB: 2 })).toBe('Round 5/19 · 3–2')
      expect(roomStatusText({ code: 'infectionRound', round: 2, maxRounds: 8, humans: 5, zombies: 3 })).toBe('Round 2/8 · 5 humans – 3 zombies')
      expect(roomStatusText({ code: 'wave', wave: 3, maxWaves: 10, players: 4 })).toBe('Wave 3/10 · 4 players')
    })
  })

  describe('Vietnamese', () => {
    beforeAll(() => setLang('vi'))
    it('uses the original Vietnamese wording', () => {
      expect(roomStatusText({ code: 'waiting' })).toBe('Đang chờ')
      expect(roomStatusText({ code: 'timeLeft', seconds: 372, scoreA: 23, scoreB: 18 })).toBe('Còn 06:12 · 23–18')
      expect(roomStatusText({ code: 'round', round: 5, maxRounds: 19, scoreA: 3, scoreB: 2 })).toBe('Ván 5/19 · 3–2')
      expect(roomStatusText({ code: 'infectionRound', round: 2, maxRounds: 8, humans: 5, zombies: 3 })).toBe('Ván 2/8 · 5 người – 3 zombie')
      expect(roomStatusText({ code: 'wave', wave: 3, maxWaves: 10, players: 4 })).toBe('Đợt 3/10 · 4 người')
    })
  })
})
