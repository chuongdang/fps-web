import { isZombieMode, MsgType, CHARACTER_SETS, DEFAULT_CHARACTER_SET, DEFAULT_SETTINGS, GAME_MODES, SETTINGS_LIMITS, MAX_PLAYERS_LIMITS, type GameMode, type JoinRejectReason, type MapInfo, type RoomConfig, type RoomInfo, type RoomOptions, type TeamId, type Transport } from '@fps/shared'
import { connectWebSocket, maybeNetsim } from './transport'
import { getCharacterSet } from '../render/characters'
import { createLocalTransport, startOfflineWorker } from './localTransport'
import { APP_VERSION } from '../version'
import { showCredits } from './credits'
import { t } from '../i18n'
import { roomStatusText } from './roomStatus'
import { createLangSelector } from '../i18n/selector'
import { IS_TOUCH } from '../touch/mode'
import { createQualitySelector } from '../touch/qualitySelect'
import { createControlsSettings } from '../touch/controlsSettings'
import { hudIcon } from '../hudIcons'

export interface Session {
  transport: Transport
  yourId: number
  names: Map<number, string>   // id → name (killfeed); also kept for players who left
  teams: Map<number, TeamId>   // id → team (TeamAssigned)
  characterSet: string         // the room's character set (Welcome)
  config: RoomConfig           // game mode + room settings (Welcome)
  roomName: string
  mapId: string                // id of the room's map (assets/maps/index.ts); '' from an old server
  mapName: string
  offline?: boolean            // offline room running in a Web Worker (plan 15): has bots, unlimited money
  worker?: Worker
}

const STORE_KEY = 'fps.lobby'
const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`   // Vite proxy /ws → backend :8081

function loadSaved(): { name: string; team: string; characters: string } {
  try {
    const o = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}')
    return { name: String(o.name ?? ''), team: String(o.team ?? 'auto'), characters: String(o.characters ?? DEFAULT_CHARACTER_SET) }
  } catch { return { name: '', team: 'auto', characters: DEFAULT_CHARACTER_SET } }
}

// Map the server's JoinRejected reason code to player-facing text (built when needed, so it follows the page language)
function rejectText(reason: JoinRejectReason): string {
  switch (reason) {
    case 'version': return t('lobby.reject.version')
    case 'full': return t('lobby.reject.full')
    case 'exists': return t('lobby.reject.exists')
    case 'missing': return t('lobby.reject.missing')
    case 'bad': return t('lobby.reject.bad')
    default: return t('lobby.reject.unknown')
  }
}

// Network event feed in the top-right corner: "X joined", "X left"
function createEventFeed() {
  const el = document.createElement('div')
  el.style.cssText =
    'position:fixed;top:52px;right:8px;color:#fff;font:13px/1.5 monospace;' +
    'text-align:right;pointer-events:none;z-index:20'
  document.body.appendChild(el)
  return (text: string) => {
    console.log(`[net] ${text}`)
    const line = document.createElement('div')
    line.textContent = text
    line.style.cssText = 'background:rgba(0,0,0,0.5);padding:2px 6px;margin-bottom:2px'
    el.appendChild(line)
    setTimeout(() => line.remove(), 5000)
  }
}


interface JoinOpts { name: string; room: string; team: TeamId | 'auto'; characterSet?: string; create?: boolean; mapId?: string; options?: RoomOptions }

function joinRoom(transport: Transport, o: JoinOpts): Promise<Session> {
  return new Promise<Session>((resolve, reject) => {
    const names = new Map<number, string>()
    const teams = new Map<number, TeamId>()
    const log = createEventFeed()
    let welcomed = false
    let dead = false   // already rejected: this handler does nothing any more (the next Join uses a new handler)
    transport.onMessage(msg => {
      if (dead) return
      if (msg.t === MsgType.Welcome && !welcomed) {
        welcomed = true
        for (const p of msg.players) names.set(p.id, p.name)
        names.set(msg.yourId, o.name)   // our own name (end-of-match scoreboard)
        log(t('lobby.feed.joined', { room: o.room, id: msg.yourId }))
        resolve({ transport, yourId: msg.yourId, names, teams, characterSet: msg.characterSet, config: msg.config, roomName: o.room, mapId: msg.mapId, mapName: msg.mapName })
      } else if (msg.t === MsgType.JoinRejected && !welcomed) {
        dead = true
        reject(new Error(rejectText(msg.reason)))
      } else if (msg.t === MsgType.TeamAssigned) {
        teams.set(msg.id, msg.team)
      } else if (msg.t === MsgType.PlayerJoined) {
        names.set(msg.id, msg.name)
        log(t('lobby.feed.playerJoined', { name: msg.name, id: msg.id }))
      } else if (msg.t === MsgType.PlayerLeft) {
        teams.delete(msg.id)
        log(t('lobby.feed.playerLeft', { name: names.get(msg.id) ?? '#' + msg.id }))
      }
    })
    transport.onClose(() => {
      if (!welcomed) reject(new Error(t('lobby.err.closed')))
      else log(t('lobby.feed.connectionLost'))
    })
    transport.send({ t: MsgType.Join, name: o.name, room: o.room, team: o.team, characterSet: o.characterSet, create: o.create, mapId: o.mapId, options: o.options, version: APP_VERSION })
  })
}

/** Set before reloading the page so the lobby skips the name step */
export const BACK_KEY = 'fps.backToLobby'

// Language selector: small, fixed in the top-right corner of the lobby screens
const LANG_CSS = 'position:fixed;top:10px;right:10px;z-index:101'
// Phone: 44px tall targets, and inputs at 16px (iOS Safari zooms the page when a smaller field is focused)
const BTN = 'padding:8px 14px;background:#2a3550;color:#fff;border:1px solid #556;border-radius:6px;cursor:pointer;font:inherit' + (IS_TOUCH ? ';min-height:44px' : '')
const INPUT = 'padding:7px 8px;background:#111;color:#fff;border:1px solid #556;border-radius:6px;font:inherit' + (IS_TOUCH ? ';font-size:16px;min-height:44px;box-sizing:border-box' : '')
// the extra phone-only control, left of the language selector
const QUALITY_CSS = 'position:fixed;top:10px;right:110px;z-index:101'
const CONTROLS_CSS = 'position:fixed;top:10px;left:10px;z-index:101'   // top-left, away from the two selectors
const langControls = (): HTMLElement[] => IS_TOUCH ? [createControlsSettings(CONTROLS_CSS), createQualitySelector(QUALITY_CSS), createLangSelector(LANG_CSS)] : [createLangSelector(LANG_CSS)]

function mk<K extends keyof HTMLElementTagNameMap>(tag: K, css = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (css) e.style.cssText = css
  if (text) e.textContent = text
  return e
}

function teamSelect(value: string): HTMLSelectElement {
  const sel = mk('select', INPUT)
  sel.add(new Option(t('lobby.team.auto'), 'auto'))
  sel.add(new Option(t('lobby.team.pick', { team: t('team.A.name') }), 'A'))
  sel.add(new Option(t('lobby.team.pick', { team: t('team.B.name') }), 'B'))
  sel.value = value === 'A' || value === 'B' ? value : 'auto'
  return sel
}

// Entry screen: (1) enter a name → (2) room list + create room. Resolves null if the player chose to play offline.
export function showLobby(): Promise<Session | null> {
  const saved = loadSaved()
  const el = mk('div', 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,' + (IS_TOUCH ? '0.94' : '0.85') + ');z-index:100;font:15px monospace;color:#fff;overflow:auto' + (IS_TOUCH ? ';overscroll-behavior:contain;-webkit-overflow-scrolling:touch' : '') )
  // Typing must not trigger the game's hotkeys
  el.addEventListener('keydown', e => e.stopPropagation())
  document.body.appendChild(el)

  return new Promise(resolve => {
    const done = (s: Session) => { el.remove(); resolve(s) }
    // Offline = a room running the real server code in a Web Worker (with bots). If the worker fails, fall back to the old client-only offline mode.
    let starting = false
    let offlineMode: GameMode = (() => { const m = new URLSearchParams(location.search).get('offlineMode'); return m === 'infection' || m === 'defense' ? m : 'tdm' })()
    // Pick the mode for the offline room: Team Deathmatch (default), Infection, Defense
    const offlineModeSelect = (): HTMLSelectElement => {
      const sel = mk('select', INPUT)
      sel.add(new Option(t('lobby.offlineMode', { mode: t('mode.tdm') }), 'tdm'))
      sel.add(new Option(t('lobby.offlineMode', { mode: t('mode.infection') }), 'infection'))
      sel.add(new Option(t('lobby.offlineMode', { mode: t('mode.defense') }), 'defense'))
      sel.value = offlineMode
      sel.addEventListener('change', () => { offlineMode = sel.value as GameMode })
      return sel
    }
    const offline = (status?: HTMLElement) => {
      if (starting) return
      starting = true
      if (status) status.textContent = t('lobby.offline.starting')
      let worker: Worker | null = null
      startOfflineWorker().then(w => {
        worker = w
        return joinRoom(createLocalTransport(w), { name: saved.name || t('lobby.defaultName'), room: 'offline', team: 'A', create: true, ...(offlineMode === 'tdm' ? {} : { options: { mode: offlineMode, maxPlayers: 10 } }) })
      }).then(s => done({ ...s, offline: true, worker: worker! }), err => {
        console.warn('[offline] worker failed to start, using client-only offline mode', err)
        worker?.terminate()
        el.remove(); resolve(null)
      })
    }

    // ── Step 1: name ─────────────────────────────────────────────────────────
    function nameStep(): void {
      el.replaceChildren()
      const form = mk('form', 'display:flex;flex-direction:column;gap:10px;width:280px')
      const title = mk('div', 'font-size:26px;text-align:center', 'FPS Web')
      const nameIn = mk('input', INPUT); nameIn.name = 'name'; nameIn.placeholder = t('lobby.name.placeholder'); nameIn.maxLength = 16; nameIn.autocomplete = 'off'
      nameIn.value = saved.name
      const go = mk('button', BTN, t('lobby.continue')); go.type = 'submit'
      const off = mk('button', BTN, t('lobby.offline')); off.type = 'button'; off.setAttribute('data-offline', '')
      const err = mk('div', 'color:#f66;min-height:1.2em')
      off.addEventListener('click', () => { saved.name = nameIn.value.trim() || saved.name; offline(err) })
      form.append(title, nameIn, go, offlineModeSelect(), off, err)
      form.addEventListener('submit', e => {
        e.preventDefault()
        const name = nameIn.value.trim()
        if (!name) { err.textContent = t('lobby.err.nameRequired'); return }
        saved.name = name
        err.textContent = t('lobby.connecting')
        connectWebSocket(WS_URL).then(raw => {
          const transport = maybeNetsim(raw)
          const direct = new URLSearchParams(location.search).get('room')
          if (direct) {   // ?room=xxx: join directly (dev / two-tab testing), skipping the list
            joinRoom(transport, { name, room: direct, team: saved.team as TeamId | 'auto' }).then(done, e2 => { err.textContent = String(e2.message) })
          } else listStep(transport)
        }, () => { err.textContent = t('lobby.err.noServer') })
      })
      el.appendChild(form)
      // Bottom of the main menu: version + Credits
      const foot = mk('div', 'position:fixed;bottom:10px;left:0;right:0;text-align:center;font-size:12px;opacity:.7')
      const credit = mk('button', 'background:none;border:none;color:#9bf;cursor:pointer;font:inherit;text-decoration:underline', t('lobby.credits.title'))
      credit.type = 'button'; credit.addEventListener('click', showCredits)
      foot.append(`v${APP_VERSION} · `, credit)
      el.appendChild(foot)
      el.append(...langControls())
      if (!IS_TOUCH) nameIn.focus()   // on a phone, focusing opens the keyboard over the whole landscape screen before the player has read anything
      // Returning from "Back to lobby": if we already have a name, go straight to the room list
      let back = false
      try { back = sessionStorage.getItem(BACK_KEY) === '1'; sessionStorage.removeItem(BACK_KEY) } catch { /* ignore */ }
      if (back && saved.name) form.requestSubmit()
    }

    // ── Step 2: room list + create room ──────────────────────────────────────
    function listStep(transport: Transport): void {
      el.replaceChildren()
      el.style.alignItems = 'flex-start'
      const wrap = mk('div', `width:min(1000px,94vw);padding:${IS_TOUCH ? 48 : 28}px 0 28px;display:flex;flex-direction:column;gap:14px`)   // phone: room for the selectors fixed in the corner
      const top = mk('div', 'display:flex;align-items:center;justify-content:space-between;gap:8px' + (IS_TOUCH ? ';flex-wrap:wrap' : ''))
      top.append(mk('div', 'font-size:22px', t('lobby.rooms.title', { name: saved.name })))
      const off = mk('button', BTN, t('lobby.offline')); off.type = 'button'; off.setAttribute('data-offline', ''); off.addEventListener('click', () => { clearInterval(poll); offline(err) })
      top.append(offlineModeSelect(), off)
      const grid = mk('div', `display:grid;grid-template-columns:${IS_TOUCH ? 'repeat(auto-fill,minmax(230px,1fr))' : 'repeat(3,1fr)'};gap:14px`)
      const empty = mk('div', 'opacity:.7;padding:16px 0', t('lobby.rooms.empty'))
      const err = mk('div', 'color:#f66;min-height:1.2em')
      const createBox = mk('div', 'display:flex;flex-direction:column;gap:10px;padding:14px;background:rgba(255,255,255,0.07);border-radius:8px')
      wrap.append(top, grid, err, createBox)
      el.appendChild(wrap)
      el.append(...langControls())

      let rooms: RoomInfo[] = [], maps: MapInfo[] = []
      const teamChoice = new Map<string, string>()   // team choice per card, kept across redraws
      let busy = false

      const fail = (e: unknown) => { busy = false; err.textContent = String((e as Error).message ?? e) }
      const enter = (opts: JoinOpts) => {
        if (busy) return
        busy = true; err.textContent = t('lobby.joining')
        try { localStorage.setItem(STORE_KEY, JSON.stringify({ name: saved.name, team: opts.team, characters: DEFAULT_CHARACTER_SET })) } catch { /* ignore */ }
        joinRoom(transport, opts).then(s => { clearInterval(poll); done(s) }, fail)
      }

      function drawRooms(): void {
        grid.replaceChildren()
        if (rooms.length === 0) { grid.appendChild(empty); return }
        for (const r of rooms) {
          const mapName = maps.find(m => m.id === r.mapId)?.name ?? r.mapId
          const card = mk('div', `position:relative;height:170px;border-radius:10px;overflow:hidden;border:1px solid #556;background:#223 linear-gradient(rgba(0,0,0,.35),rgba(0,0,0,.75)),url('/maps/${r.mapId}.png') center/cover;background-blend-mode:normal`)
          card.style.backgroundImage = `linear-gradient(rgba(0,0,0,.3),rgba(0,0,0,.8)), url('/maps/${r.mapId}.png')`
          card.style.backgroundSize = 'cover'; card.style.backgroundPosition = 'center'
          const name = mk('div', 'position:absolute;left:12px;top:10px;font-size:18px;font-weight:bold;text-shadow:0 0 4px #000;max-width:65%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', r.id)
          const cnt = mk('div', 'position:absolute;right:10px;top:10px;padding:2px 8px;background:rgba(0,0,0,.6);border-radius:12px;font-weight:bold')
          cnt.append(hudIcon('human'), ` ${r.players}/${r.maxPlayers}`)
          const info = mk('div', 'position:absolute;left:12px;top:40px;font-size:12px;line-height:1.5;text-shadow:0 0 4px #000',
            `${t(`mode.${r.mode}`)} · ${roomStatusText(r.status)}\n${mapName} · ${getCharacterSet(r.characterSet).label}\n${isZombieMode(r.mode) ? t('lobby.room.playerCount', { n: r.players, max: r.maxPlayers }) : `${t('team.A.name')} ${r.teamA} — ${r.teamB} ${t('team.B.name')}`}`)
          info.style.whiteSpace = 'pre-line'
          const row = mk('div', 'position:absolute;left:0;right:0;bottom:10px;display:flex;justify-content:center;gap:6px')
          const sel = teamSelect(teamChoice.get(r.id) ?? saved.team)
          sel.addEventListener('change', () => teamChoice.set(r.id, sel.value))
          const full = r.players >= r.maxPlayers
          const join = mk('button', BTN, full ? t('lobby.room.full') : t('lobby.room.join')); join.disabled = full
          if (full) join.style.opacity = '.5'
          join.addEventListener('click', () => enter({ name: saved.name, room: r.id, team: sel.value as TeamId | 'auto', create: false }))
          row.append(sel, join)
          card.append(name, cnt, info, row)
          grid.appendChild(card)
        }
      }

      // Create room
      const openBtn = mk('button', BTN + ';align-self:flex-start', t('lobby.room.create'))
      const form = mk('div', 'display:none;flex-direction:column;gap:10px')
      const nameIn = mk('input', INPUT); nameIn.maxLength = 32; nameIn.placeholder = t('lobby.room.namePlaceholder')
      const mapSel = mk('select', INPUT)
      const charSel = mk('select', INPUT)
      charSel.innerHTML = CHARACTER_SETS.map(id => `<option value="${id}">${t('lobby.room.character', { name: getCharacterSet(id).label })}</option>`).join('')
      charSel.value = DEFAULT_CHARACTER_SET   // always default to the Desert Sandstorm set
      const teamSel = teamSelect(saved.team)
      const maxSel = mk('select', INPUT)
      for (let n = MAX_PLAYERS_LIMITS[1]; n >= MAX_PLAYERS_LIMITS[0]; n -= 2) maxSel.add(new Option(t('lobby.room.maxPlayers', { n }), String(n)))
      // Game mode: large cards; the settings change with the mode
      let mode: GameMode = 'elimination'
      const modeRow = mk('div', 'display:grid;grid-template-columns:1fr 1fr;gap:10px')
      const modeCards = new Map<GameMode, HTMLElement>()
      for (const m of GAME_MODES) {
        const c = mk('div', 'padding:12px;border-radius:8px;cursor:pointer;border:2px solid #556;background:rgba(0,0,0,.35)')
        c.append(mk('div', 'font-size:18px;font-weight:bold;margin-bottom:4px', t(`mode.${m}`)), mk('div', 'font-size:12px;opacity:.85', t(`mode.${m}.desc`)))
        c.addEventListener('click', () => { mode = m; syncMode() })
        modeCards.set(m, c); modeRow.appendChild(c)
      }
      const numField = (label: string, [lo, hi]: readonly [number, number], def: number) => {
        const wrapF = mk('label', 'display:flex;flex-direction:column;gap:4px;font-size:12px')
        const inp = mk('input', INPUT + ';width:110px'); inp.type = 'number'; inp.min = String(lo); inp.max = String(hi); inp.value = String(def)
        wrapF.append(mk('span', '', `${label} (${lo}–${hi})`), inp)
        return { wrapF, inp }
      }
      const fRounds = numField(t('lobby.field.roundsToWin'), SETTINGS_LIMITS.roundsToWin, DEFAULT_SETTINGS.elimination.roundsToWin)
      const fRoundTime = numField(t('lobby.field.roundTime'), SETTINGS_LIMITS.roundTimeSec, DEFAULT_SETTINGS.elimination.roundTimeSec)
      const fKills = numField(t('lobby.field.killLimit'), SETTINGS_LIMITS.killLimit, DEFAULT_SETTINGS.tdm.killLimit)
      const fMinutes = numField(t('lobby.field.matchMinutes'), SETTINGS_LIMITS.timeLimitMin, DEFAULT_SETTINGS.tdm.timeLimitMin)
      const fInfRounds = numField(t('lobby.field.rounds'), SETTINGS_LIMITS.infectionRounds, DEFAULT_SETTINGS.infection.rounds)
      const fInfTime = numField(t('lobby.field.roundTime'), SETTINGS_LIMITS.infectionRoundTimeSec, DEFAULT_SETTINGS.infection.roundTimeSec)
      const fWaves = numField(t('lobby.field.waves'), SETTINGS_LIMITS.waves, DEFAULT_SETTINGS.defense.waves)
      const fInter = numField(t('lobby.field.intermission'), SETTINGS_LIMITS.intermissionSec, DEFAULT_SETTINGS.defense.intermissionSec)
      const selField = (label: string, opts: [string, string][], def: string) => {
        const wrapF = mk('label', 'display:flex;flex-direction:column;gap:4px;font-size:12px')
        const sel = mk('select', INPUT)
        for (const [v, text] of opts) sel.add(new Option(text, v))
        sel.value = def
        wrapF.append(mk('span', '', label), sel)
        return { wrapF, sel }
      }
      const fLight = selField(t('lobby.field.lighting'), [['night', t('lobby.light.night')], ['day', t('lobby.light.day')]], 'night')
      const fDiff = selField(t('lobby.field.difficulty'), [['easy', t('lobby.diff.easy')], ['normal', t('lobby.diff.normal')], ['hard', t('lobby.diff.hard')]], DEFAULT_SETTINGS.defense.difficulty)
      const resetBtn = mk('button', BTN, t('lobby.reset')); resetBtn.type = 'button'
      const setRow = mk('div', 'display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap')
      setRow.append(fRounds.wrapF, fRoundTime.wrapF, fKills.wrapF, fMinutes.wrapF, fInfRounds.wrapF, fInfTime.wrapF, fWaves.wrapF, fInter.wrapF, fDiff.wrapF, fLight.wrapF, resetBtn)
      function syncMode(): void {
        for (const [m, c] of modeCards) c.style.borderColor = m === mode ? '#6fa0ff' : '#556'
        fRounds.wrapF.style.display = fRoundTime.wrapF.style.display = mode === 'elimination' ? '' : 'none'
        fKills.wrapF.style.display = fMinutes.wrapF.style.display = mode === 'tdm' ? '' : 'none'
        fInfRounds.wrapF.style.display = fInfTime.wrapF.style.display = mode === 'infection' ? '' : 'none'
        fWaves.wrapF.style.display = fInter.wrapF.style.display = fDiff.wrapF.style.display = mode === 'defense' ? '' : 'none'
        fLight.wrapF.style.display = mode === 'infection' || mode === 'defense' ? '' : 'none'
      }
      resetBtn.addEventListener('click', () => {
        fRounds.inp.value = String(DEFAULT_SETTINGS.elimination.roundsToWin); fRoundTime.inp.value = String(DEFAULT_SETTINGS.elimination.roundTimeSec)
        fKills.inp.value = String(DEFAULT_SETTINGS.tdm.killLimit); fMinutes.inp.value = String(DEFAULT_SETTINGS.tdm.timeLimitMin)
        fInfRounds.inp.value = String(DEFAULT_SETTINGS.infection.rounds); fInfTime.inp.value = String(DEFAULT_SETTINGS.infection.roundTimeSec)
        fWaves.inp.value = String(DEFAULT_SETTINGS.defense.waves); fInter.inp.value = String(DEFAULT_SETTINGS.defense.intermissionSec)
        fDiff.sel.value = DEFAULT_SETTINGS.defense.difficulty; fLight.sel.value = 'night'
      })
      syncMode()
      const selRow = mk('div', 'display:flex;gap:8px;flex-wrap:wrap')
      selRow.append(mapSel, maxSel, charSel, teamSel)
      const btns = mk('div', 'display:flex;gap:8px')
      const ok = mk('button', BTN, t('lobby.room.create'))
      const cancel = mk('button', BTN, t('lobby.cancel'))
      btns.append(ok, cancel)
      form.append(nameIn, modeRow, setRow, selRow, btns)
      createBox.append(openBtn, form)
      const defaultRoomName = () => { let i = 1; while (rooms.some(r => r.id === `ROOM ${i}`)) i++; return `ROOM ${i}` }
      openBtn.addEventListener('click', () => {
        openBtn.style.display = 'none'; form.style.display = 'flex'
        nameIn.value = defaultRoomName(); if (!IS_TOUCH) { nameIn.focus(); nameIn.select() }
      })
      cancel.addEventListener('click', () => { form.style.display = 'none'; openBtn.style.display = '' ; err.textContent = '' })
      ok.addEventListener('click', () => {
        const room = nameIn.value.trim()
        if (!room) { err.textContent = t('lobby.err.roomName'); return }
        const settings: RoomOptions['settings'] = mode === 'elimination'
          ? { roundsToWin: Number(fRounds.inp.value), roundTimeSec: Number(fRoundTime.inp.value) }
          : mode === 'tdm' ? { killLimit: Number(fKills.inp.value), timeLimitMin: Number(fMinutes.inp.value) }
          : mode === 'infection' ? { rounds: Number(fInfRounds.inp.value), roundTimeSec: Number(fInfTime.inp.value), lighting: fLight.sel.value }
          : { waves: Number(fWaves.inp.value), intermissionSec: Number(fInter.inp.value), difficulty: fDiff.sel.value, lighting: fLight.sel.value }
        const options: RoomOptions = { mode, maxPlayers: Number(maxSel.value), settings }
        enter({ name: saved.name, room, team: teamSel.value as TeamId | 'auto', characterSet: charSel.value, create: true, mapId: mapSel.value, options })
      })
      nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') ok.click(); else if (e.key === 'Escape') cancel.click() })

      let sig = ''
      transport.onMessage(msg => {
        if (msg.t === MsgType.JoinRejected && msg.reason === 'version') { clearInterval(poll); err.textContent = rejectText('version'); return }
        if (msg.t !== MsgType.RoomList) return
        const next = JSON.stringify(msg)
        if (next === sig) return   // unchanged: don't redraw (it would close an open team dropdown)
        sig = next
        rooms = msg.rooms; maps = msg.maps
        if (mapSel.options.length !== maps.length) mapSel.innerHTML = maps.map(m => `<option value="${m.id}">Map: ${m.name}</option>`).join('')
        drawRooms()
      })
      transport.onClose(() => { clearInterval(poll); err.textContent = t('lobby.err.connectionLost') })
      const ask = () => transport.send({ t: MsgType.ListRooms, version: APP_VERSION })
      const poll = setInterval(() => { if (!busy) ask() }, 2000)
      ask()
    }

    nameStep()
  })
}
