// Match HUD (5.2/5.3): team scores + clock, countdown, end banner, hold-Tab scoreboard. Plain DOM, only writes when the text changes.
import { MatchPhase, TEAMS, winnerOf, type GameMode, type MatchEndMsg, type MatchStateMsg, type RoomConfig, type RoundEndMsg, type RoundEndReason, type ScoreboardRow, type TeamId } from '@fps/shared'
import { t } from './i18n'
import { IS_TOUCH } from './touch/mode'
import { hudIcon } from './hudIcons'

export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Scoreboard order: kills descending, ties broken by fewer deaths first
export function sortRows(rows: readonly ScoreboardRow[], team: TeamId): ScoreboardRow[] {
  return rows.filter(r => r.team === team).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.id - b.id)
}

export function bannerText(phase: MatchPhase, scoreA: number, scoreB: number): string {
  if (phase !== MatchPhase.Ended) return ''
  const w = winnerOf(scoreA, scoreB)
  return w ? t('match.teamWins', { team: t(`team.${w}.name`).toUpperCase() }) : t('match.draw')
}

/** Sub-line explaining why a round ended */
export function reasonText(reason: RoundEndReason): string {
  return t(`match.reason.${reason}`)
}

/** Round-end title (Elimination) */
export function roundBannerText(winner: TeamId | null, round: number): string {
  return winner ? t('match.roundWin', { team: t(`team.${winner}.name`).toUpperCase(), round }) : t('match.roundDraw')
}

/** Clock colour: FREEZE yellow; LIVE under 10 seconds red */
export function clockColor(phase: MatchPhase, leftMs: number): string {
  if (phase === MatchPhase.Freeze) return '#ffd23c'
  if (phase === MatchPhase.Playing && leftMs <= 10_000) return '#ff5555'
  return '#fff'
}

function el(css: string): HTMLDivElement {
  const e = document.createElement('div')
  e.style.cssText = css
  document.body.appendChild(e)
  return e
}

function setText(e: HTMLElement, text: string): void { if (e.textContent !== text) e.textContent = text }

export interface MatchSounds { start(): void; win(): void; lose(): void; tick(): void }

export function createMatchHud(sounds?: MatchSounds) {
  const top = el('position:fixed;top:8px;left:50%;transform:translateX(-50%);color:#fff;font:bold ' + (IS_TOUCH ? 15 : 20) + 'px monospace;' +
    'text-align:center;pointer-events:none;z-index:20;background:rgba(0,0,0,0.5);padding:4px 14px;display:none;white-space:nowrap')
  const row = document.createElement('div')
  row.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:12px'
  const dotsA = document.createElement('span'), dotsB = document.createElement('span')
  const scoreA = document.createElement('span'), scoreB = document.createElement('span'), clockEl = document.createElement('span')
  scoreA.style.color = '#6fa0ff'; scoreB.style.color = TEAMS.B.uiColor
  clockEl.style.cssText = `min-width:${IS_TOUCH ? 60 : 84}px;font-size:${IS_TOUCH ? 13 : 18}px`
  row.append(dotsA, scoreA, clockEl, scoreB, dotsB)
  if (IS_TOUCH) {   // keep clear of the two icon buttons (left) and the leave button (right): a long clock text ("Waiting for more players…") is cut with "…"
    top.style.maxWidth = 'calc(100vw - 236px)'; top.style.boxSizing = 'border-box'
    for (const c of [dotsA, scoreA, scoreB, dotsB]) c.style.flex = 'none'
    clockEl.style.cssText += ';min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
  }
  const subTop = document.createElement('div')
  subTop.style.cssText = `font-size:${IS_TOUCH ? 11 : 13}px;opacity:.85`
  top.append(row, subTop)
  const big = el(`position:fixed;top:30%;left:0;right:0;text-align:center;color:#fff;font:bold ${IS_TOUCH ? 56 : 96}px monospace;` +
    'text-shadow:0 0 12px #000;pointer-events:none;z-index:21')
  const sub = el(`position:fixed;top:calc(30% + ${IS_TOUCH ? 64 : 110}px);left:0;right:0;text-align:center;color:#fff;font:bold ${IS_TOUCH ? 18 : 28}px monospace;` +
    'text-shadow:0 0 8px #000;pointer-events:none;z-index:21')
  let st: MatchStateMsg | null = null
  let config: RoomConfig | null = null
  let sizeA = 0, sizeB = 0
  let lastEnd: RoundEndMsg | null = null
  let roundMoney = 0                 // money I got at the end of the round (MoneyEvent round_*)
  let matchEnd: MatchEndMsg | null = null
  let mvpName = ''
  let online = false
  let unlimited = false              // offline: Team Deathmatch with no kill or time limit
  let lastTickSec = -1
  let dotsKey = ''

  function dots(team: TeamId, alive: number, total: number, el: HTMLElement): string {
    const k = `${team}${alive}/${total}`
    el.style.cssText = `color:${team === 'A' ? '#6fa0ff' : TEAMS.B.uiColor};display:inline-flex;gap:3px;align-items:center`
    el.replaceChildren(...Array.from({ length: total }, (_, i) => {
      const d = hudIcon('dot', '14px'); d.style.opacity = i < alive ? '1' : '.25'; return d
    }))
    return k
  }

  function render(serverNow: number): void {
    if (!online || !st || st.mode === 'infection' || st.mode === 'defense') { top.style.display = 'none'; setText(big, ''); setText(sub, ''); return }   // zombie modes have their own HUD (hudZombie.ts)
    top.style.display = 'block'
    const elim = st.mode === 'elimination'
    const left = st.phaseEndsAt - serverNow
    setText(scoreA, `${t('team.A.name')} ${st.scoreA}`)
    setText(scoreB, `${st.scoreB} ${t('team.B.name')}`)
    clockEl.style.color = clockColor(st.phase, left)
    if (elim) {
      const k = `${st.aliveA}/${sizeA}|${st.aliveB}/${sizeB}`
      if (k !== dotsKey) { dotsKey = k; dots('A', st.aliveA, sizeA, dotsA); dots('B', st.aliveB, sizeB, dotsB) }
    } else if (dotsKey !== '') { dotsKey = ''; dotsA.replaceChildren(); dotsB.replaceChildren() }

    let clock = '', bigT = '', subT = '', topSub = ''
    const maxR = st.maxRounds
    switch (st.phase) {
      case MatchPhase.Waiting: clock = t('match.waiting'); break
      case MatchPhase.Countdown: clock = t('match.getReady'); bigT = String(Math.max(0, Math.ceil(left / 1000))); subT = st.sideSwapped ? t('match.sidesSwapped') : ''; break
      case MatchPhase.Playing: clock = unlimited ? '∞' : formatClock(left); break
      case MatchPhase.Freeze: clock = formatClock(left); bigT = t('match.roundBig', { round: st.round }); subT = t('match.buyHint'); break
      case MatchPhase.RoundEnd:
        clock = '0:00'
        if (lastEnd) { bigT = roundBannerText(lastEnd.winner, lastEnd.round); subT = reasonText(lastEnd.reason) + (roundMoney > 0 ? `   +$${roundMoney}` : '') }
        break
      case MatchPhase.Halftime: clock = t('match.break'); bigT = t('match.halftime'); subT = `${t('team.A.name')} ${st.scoreA} — ${st.scoreB} ${t('team.B.name')}`; break
      case MatchPhase.Ended:
        clock = elim ? t('match.newMatchIn', { time: formatClock(left) }) : t('match.matchOver')
        if (elim && matchEnd) {
          bigT = matchEnd.winner ? t('match.matchWin', { team: t(`team.${matchEnd.winner}.name`).toUpperCase() }) : t('match.draw')
          subT = `${matchEnd.scoreA} — ${matchEnd.scoreB}${mvpName ? `   ${t('match.mvp', { name: mvpName })}` : ''}`
        } else bigT = bannerText(st.phase, st.scoreA, st.scoreB)
        break
    }
    if (elim && st.phase !== MatchPhase.Waiting) topSub = t('match.roundOf', { n: Math.min(st.round, maxR), max: maxR })
    else if (!elim && config?.settings.mode === 'tdm') topSub = unlimited ? t('match.unlimited') : t('match.killTarget', { n: config.settings.killLimit })
    setText(clockEl, clock); setText(big, bigT); setText(sub, subT); setText(subTop, topSub)

    if (elim && st.phase === MatchPhase.Playing && left > 0 && left <= 10_000) {
      const sec = Math.ceil(left / 1000)
      if (sec !== lastTickSec) { lastTickSec = sec; sounds?.tick() }
    } else lastTickSec = -1
  }

  return {
    setMatch(m: MatchStateMsg): void {
      if (st && m.mode === 'elimination' && st.phase !== MatchPhase.Playing && m.phase === MatchPhase.Playing) sounds?.start()
      if (m.phase === MatchPhase.Freeze) { lastEnd = null; roundMoney = 0 }
      if (m.phase !== MatchPhase.Ended) matchEnd = null
      st = m; online = true
    },
    setConfig(c: RoomConfig): void { config = c },
    setUnlimited(v: boolean): void { unlimited = v },
    setTeamSizes(a: number, b: number): void { sizeA = a; sizeB = b },
    onRoundEnd(m: RoundEndMsg, myTeam: TeamId | undefined): void {
      lastEnd = m; roundMoney = 0
      if (!sounds) return
      if (m.winner === null || myTeam === undefined) return
      if (m.winner === myTeam) sounds.win(); else sounds.lose()
    },
    onMoney(delta: number, reason: string): void { if (reason === 'round_win' || reason === 'round_loss' || reason === 'round_draw') roundMoney = delta },
    onMatchEnd(m: MatchEndMsg, mvp: string): void { matchEnd = m; mvpName = mvp },
    tick: render,
    get phase(): MatchPhase { return st?.phase ?? MatchPhase.Waiting },
    get mode(): GameMode | null { return st?.mode ?? null },
    get buyEndsAt(): number | null { return st?.buyEndsAt ?? null },
    get round(): number { return st?.round ?? 0 },
    clear(): void { online = false; st = null; lastEnd = null; matchEnd = null; render(0) },
  }
}

export function createScoreboard() {
  const root = el('position:fixed;inset:0;display:none;align-items:center;justify-content:center;' +
    'z-index:30;pointer-events:none;font:14px monospace;color:#fff')
  const box = document.createElement('div')
  box.style.cssText = 'display:flex;gap:16px;background:rgba(0,0,0,0.7);padding:16px 20px'
  root.appendChild(box)
  let rows: ScoreboardRow[] = []
  let myId = -1
  let visible = false
  let dirty = true

  function table(team: TeamId): HTMLElement {
    const tbl = document.createElement('table')
    tbl.style.cssText = 'border-collapse:collapse;min-width:260px'
    const head = document.createElement('caption')
    head.textContent = t(`team.${team}.name`)
    head.style.cssText = `font-weight:bold;font-size:18px;text-align:left;padding-bottom:4px;color:${TEAMS[team].uiColor === '#2f6fd6' ? '#6fa0ff' : TEAMS[team].uiColor}`
    tbl.appendChild(head)
    const hr = tbl.insertRow()
    for (const [i, h] of [t('match.sb.name'), '$', 'K', 'D', 'Ping'].entries()) {
      const c = hr.insertCell(); c.textContent = h
      c.style.cssText = 'opacity:.6;padding:2px 8px;text-align:' + (i === 0 ? 'left' : 'right')
    }
    for (const r of sortRows(rows, team)) {
      const tr = tbl.insertRow()
      if (r.id === myId) tr.style.background = 'rgba(255,255,255,0.22)'
      const cells: [string, string][] = [[r.name, 'left'], [r.money === undefined ? '—' : `$${r.money}`, 'right'], [String(r.kills), 'right'], [String(r.deaths), 'right'], [String(r.ping), 'right']]
      for (const [txt, al] of cells) { const c = tr.insertCell(); c.textContent = txt; c.style.cssText = `padding:2px 8px;text-align:${al}` }
    }
    return tbl
  }

  // Infection: one table ordered by personal score (score, infections, zombie kills, current role)
  function infectionTable(): HTMLElement {
    const tbl = document.createElement('table')
    tbl.style.cssText = 'border-collapse:collapse;min-width:460px'
    const head = document.createElement('caption')
    head.textContent = t('mode.infection')
    head.style.cssText = 'font-weight:bold;font-size:18px;text-align:left;padding-bottom:4px;color:#7ed957'
    tbl.appendChild(head)
    const hr = tbl.insertRow()
    for (const [i, h] of [t('match.sb.name'), t('match.sb.score'), t('match.sb.infections'), t('match.sb.zombieKills'), t('match.sb.role'), 'Ping'].entries()) {
      const c = hr.insertCell(); c.textContent = h
      c.style.cssText = 'opacity:.6;padding:2px 8px;text-align:' + (i === 0 ? 'left' : 'right')
    }
    for (const r of rows.slice().sort((a, b) => (b.pts ?? 0) - (a.pts ?? 0) || a.id - b.id)) {
      const tr = tbl.insertRow()
      if (r.id === myId) tr.style.background = 'rgba(255,255,255,0.22)'
      const cells: [string | Node, string][] = [[r.name, 'left'], [String(r.pts ?? 0), 'right'], [String(r.inf ?? 0), 'right'], [String(r.zk ?? 0), 'right'], [hudIcon(r.role === 'zombie' ? 'zombie' : 'human'), 'right'], [String(r.ping), 'right']]
      for (const [txt, al] of cells) { const c = tr.insertCell(); if (typeof txt === 'string') c.textContent = txt; else c.appendChild(txt); c.style.cssText = `padding:2px 8px;text-align:${al}` }
    }
    return tbl
  }

  // Defense: one shared team table (zombie kills, damage, revives)
  function defenseTable(): HTMLElement {
    const tbl = document.createElement('table')
    tbl.style.cssText = 'border-collapse:collapse;min-width:420px'
    const head = document.createElement('caption')
    head.textContent = t('mode.defense')
    head.style.cssText = 'font-weight:bold;font-size:18px;text-align:left;padding-bottom:4px;color:#6fa0ff'
    tbl.appendChild(head)
    const hr = tbl.insertRow()
    for (const [i, h] of [t('match.sb.name'), '$', t('match.sb.zombieKillsFull'), t('match.sb.damage'), t('match.sb.revives'), 'Ping'].entries()) {
      const c = hr.insertCell(); c.textContent = h
      c.style.cssText = 'opacity:.6;padding:2px 8px;text-align:' + (i === 0 ? 'left' : 'right')
    }
    for (const r of rows.slice().sort((a, b) => (b.zk ?? 0) - (a.zk ?? 0) || a.id - b.id)) {
      const tr = tbl.insertRow()
      if (r.id === myId) tr.style.background = 'rgba(255,255,255,0.22)'
      const cells: [string, string][] = [[r.name, 'left'], [r.money === undefined ? '—' : `$${r.money}`, 'right'], [String(r.zk ?? 0), 'right'], [String(r.dmg ?? 0), 'right'], [String(r.rev ?? 0), 'right'], [String(r.ping), 'right']]
      for (const [txt, al] of cells) { const c = tr.insertCell(); c.textContent = txt; c.style.cssText = `padding:2px 8px;text-align:${al}` }
    }
    return tbl
  }

  function rebuild(): void {
    if (rows.some(r => r.dmg !== undefined)) { box.replaceChildren(defenseTable()); dirty = false; return }
    if (rows.some(r => r.pts !== undefined)) { box.replaceChildren(infectionTable()); dirty = false; return }
    box.replaceChildren(table('A'), table('B'))
    dirty = false
  }

  return {
    setRows(r: ScoreboardRow[], me: number): void { rows = r; myId = me; dirty = true; if (visible) rebuild() },
    show(v: boolean): void {
      if (v === visible) return
      visible = v
      root.style.display = v ? 'flex' : 'none'
      if (v && dirty) rebuild()
    },
  }
}
