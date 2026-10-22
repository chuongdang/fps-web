import type { RoomStatus } from '@fps/shared'
import { t } from '../i18n'

const clock = (seconds: number): string => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`

/** Text for the room status shown on a lobby card, in the current UI language. */
export function roomStatusText(s: RoomStatus): string {
  switch (s.code) {
    case 'timeLeft': return t('lobby.status.timeLeft', { clock: clock(s.seconds), a: s.scoreA, b: s.scoreB })
    case 'round': return t('lobby.status.round', { round: s.round, max: s.maxRounds, a: s.scoreA, b: s.scoreB })
    case 'infectionRound': return t('lobby.status.infectionRound', { round: s.round, max: s.maxRounds, humans: s.humans, zombies: s.zombies })
    case 'wave': return t('lobby.status.wave', { wave: s.wave, max: s.maxWaves, players: s.players })
    default: return t(`lobby.status.${s.code}`)   // waiting | preparing | ended
  }
}
