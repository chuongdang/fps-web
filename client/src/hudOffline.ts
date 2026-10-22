// Offline bot panel (plan 15, B.7): + medium bot ([), + hard bot (]), clear bots (\), bot list. Plain DOM.
import { type BotDifficulty, type OfflineBotInfo, type OfflineStateMsg, type TeamId } from '@fps/shared'
import { getRightColumn } from './hudButtons'
import { t } from './i18n'
import { IS_TOUCH, TOUCH_HUD_SIDE } from './touch/mode'
import { stripKeyHint } from './touch/hint'
import { hudIcon } from './hudIcons'

const BTN = 'pointer-events:auto;cursor:pointer;padding:5px 10px;background:rgba(0,0,0,.55);color:#fff;border:1px solid rgba(255,255,255,.45);border-radius:6px;font:12px monospace'
// Touch: finger-sized (>= 44px) and no key hints in the labels ("+ Medium bot ([)" -> "+ Medium bot")
const BTN_TOUCH = 'pointer-events:auto;padding:12px 14px;min-height:44px;background:rgba(0,0,0,.65);color:#fff;border:1px solid rgba(255,255,255,.5);border-radius:8px;font:14px monospace'
const noKeyHint = (label: string): string => (IS_TOUCH ? stripKeyHint(label) : label)

export interface OfflinePanelDeps {
  addBot(difficulty: BotDifficulty, ally: boolean): void
  removeBot(id: number): void
  clearBots(): void
}

export function createOfflinePanel(deps: OfflinePanelDeps) {
  const box = document.createElement('div')
  const onLeft = IS_TOUCH && TOUCH_HUD_SIDE === 'left'   // the touch column is on the side opposite the action buttons (left for a right-handed player)
  const side = onLeft ? 'flex-start' : 'flex-end'
  box.style.cssText = `display:flex;flex-direction:column;align-items:${side};gap:6px;color:#fff;font:12px monospace;` +
    'background:rgba(0,0,0,.35);padding:8px;border-radius:8px;max-width:360px;pointer-events:none'
  let ally = false   // touch: there is no Shift key, so this toggle stands in for Shift+click ("the new bot joins my team")
  const mkBtn = (text: string, on: (e: MouseEvent) => void): HTMLButtonElement => {
    const b = document.createElement('button'); b.textContent = noKeyHint(text); b.style.cssText = IS_TOUCH ? BTN_TOUCH : BTN
    b.addEventListener('click', e => { on(e); b.blur() })
    return b
  }
  const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:6px' + (IS_TOUCH ? `;flex-wrap:wrap;justify-content:${side}` : '')
  row.append(
    mkBtn(t('match.off.addMedium'), e => deps.addBot('medium', e.shiftKey || ally)),
    mkBtn(t('match.off.addHard'), e => deps.addBot('hard', e.shiftKey || ally)),
    mkBtn(t('match.off.clear'), () => deps.clearBots()),
  )
  const list = document.createElement('div'); list.style.cssText = `line-height:1.7;pointer-events:none;text-align:${onLeft ? 'left' : 'right'}`
  const body = document.createElement('div'); body.style.cssText = `display:flex;flex-direction:column;align-items:${side};gap:6px`
  body.append(row, list)
  box.append(body)
  if (IS_TOUCH) {   // collapsed behind one small button: the full panel would cover the playfield
    const ALLY_OFF = t('match.off.allyOff'), ALLY_ON = t('match.off.allyOn')
    const allyBtn = mkBtn(ALLY_OFF, () => { ally = !ally; allyBtn.textContent = ally ? ALLY_ON : ALLY_OFF })
    allyBtn.textContent = ALLY_OFF
    row.prepend(allyBtn)
    body.style.display = 'none'
    const head = mkBtn(t('match.off.title'), () => { body.style.display = body.style.display === 'none' ? 'flex' : 'none' })
    head.textContent = t('match.off.title')
    box.prepend(head)
    box.style.background = 'transparent'; box.style.padding = '0'
  }
  getRightColumn().appendChild(box)

  let myTeam: TeamId = 'A'

  function drawBots(bots: readonly OfflineBotInfo[]): void {
    list.replaceChildren()
    const head = document.createElement('span'); head.textContent = bots.length ? t('match.off.bots') : t('match.off.none')
    list.appendChild(head)
    bots.forEach((b, i) => {
      if (i > 0) list.appendChild(document.createTextNode(' · '))
      const name = b.name.replace(/^\[BOT\]\s*/, '').replace(/\s+\S+$/, '')   // drop the trailing difficulty tag; it is re-added localised below
      const s = document.createElement('span')
      s.textContent = `${name} (${t(`match.off.tag.${b.difficulty}`)}) `
      s.style.color = b.team === myTeam ? '#8fe08f' : '#ff9a9a'
      const x = document.createElement('span'); x.appendChild(hudIcon('close', IS_TOUCH ? '18px' : '.8em')); x.style.cssText = 'cursor:pointer;pointer-events:auto;opacity:.85' + (IS_TOUCH ? ';padding:10px' : '')   // phone: a finger-sized target
      x.addEventListener('click', () => deps.removeBot(b.id))
      list.append(s, x)
    })
  }

  let lastBots: readonly OfflineBotInfo[] = []
  return {
    setMyTeam(team: TeamId): void { if (team !== myTeam) { myTeam = team; drawBots(lastBots) } },
    setState(m: OfflineStateMsg): void {
      lastBots = m.bots
      drawBots(m.bots)
    },
  }
}
