// Bottom-of-screen HUD (H.6): money + health on the left, 4 weapon slots in the middle, ammo on the right. Plain DOM, only writes when a value changes.
import { SLOT_COUNT, WEAPON_BY_KEY } from '@fps/shared'
import { t } from './i18n'
import { weaponIcon } from './weaponIcon'

const STYLE = `
:root{
  --hud-s:1; --hud-bottom:24px; --hud-side:24px;
  --slot:calc(72px*var(--hud-s)); --slot-gap:calc(10px*var(--hud-s)); --slot-radius:calc(10px*var(--hud-s));
  --money-size:calc(22px*var(--hud-s)); --hp-size:calc(32px*var(--hud-s)); --heart-size:calc(28px*var(--hud-s)); --ammo-size:calc(32px*var(--hud-s));
}
@media (max-height:700px){ :root{ --hud-s:0.85 } }
.hb{position:fixed;pointer-events:none;z-index:12;color:#fff;font-family:system-ui,sans-serif;text-shadow:0 0 4px #000}
.hb-left{left:var(--hud-side);bottom:var(--hud-bottom);display:flex;flex-direction:column;gap:calc(4px*var(--hud-s))}
.hb-money{font-weight:800;font-size:var(--money-size);position:relative;display:flex;align-items:baseline;gap:6px}
.hb-money .cur{color:#5fd16b}
.hb-money .num{transition:color 600ms}
.hb-hp{display:flex;align-items:center;gap:calc(8px*var(--hud-s));font-weight:800;font-size:var(--hp-size);line-height:1}
.hb-heart{width:var(--heart-size);height:var(--heart-size);fill:#ff3b3b;filter:drop-shadow(0 0 3px #000)}
.hb-hp.low .hb-heart{animation:hb-beat .9s ease-in-out infinite}
@keyframes hb-beat{0%,100%{transform:scale(1)}50%{transform:scale(1.15)}}
.hb-slots{left:50%;bottom:var(--hud-bottom);transform:translateX(-50%);display:flex;gap:var(--slot-gap)}
.hb-slot{position:relative;width:var(--slot);height:var(--slot);box-sizing:border-box;border:2px solid #fff;border-radius:var(--slot-radius);
  background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;padding:calc(8px*var(--hud-s));
  transition:transform 120ms,background 120ms,border-width 120ms,opacity 120ms}
.hb-slot img,.hb-slot span{max-width:100%;max-height:100%;width:100%}
.hb-slot.empty{opacity:.35}
.hb-slot.active{border-width:3px;background:rgba(255,255,255,.15);transform:translateY(-4px)}
.hb-slot .n{position:absolute;right:calc(6px*var(--hud-s));top:calc(3px*var(--hud-s));font:bold 14px sans-serif}
.hb-slot .k{position:absolute;left:calc(6px*var(--hud-s));bottom:calc(3px*var(--hud-s));font:bold 12px sans-serif}
.hb-right{right:var(--hud-side);bottom:var(--hud-bottom);text-align:right}
.hb-ammo{font-weight:800;font-size:var(--ammo-size);line-height:1}
.hb-ammo.low{color:#ff9a2e}
.hb-wname{font-size:calc(14px*var(--hud-s));opacity:.85;margin-top:4px}
.hb-float{position:absolute;left:100%;margin-left:12px;top:0;font-weight:800;white-space:nowrap;pointer-events:none;animation:hb-float 600ms ease-out forwards}
@keyframes hb-float{from{transform:translateY(0);opacity:1}to{transform:translateY(-28px);opacity:0}}
`

const HEART = '<svg class="hb-heart" viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.1 3 4.5 6.6 4.5c2 0 3.6 1 5.4 3 1.8-2 3.4-3 5.4-3 3.6 0 5.7 3.6 4.2 7.2C19.5 16.4 12 21 12 21z"/></svg>'

function div(cls: string, parent?: HTMLElement): HTMLDivElement {
  const d = document.createElement('div')
  d.className = cls
  ;(parent ?? document.body).appendChild(d)
  return d
}

/** Number of displayed slots and the key label of each, as in CS 1.6 (1 primary, 2 pistol, 3 knife, 4 grenade) */
export const HUD_SLOTS = 4
export const HUD_KEY_LABEL: readonly string[] = ['1', '2', '3', '4']
/** Logical slot (CATEGORY_SLOT) of displayed slots 2–4; displayed slot 1 is the primary weapon, chosen by primarySlotToShow */
const HUD_LOGIC_SLOT: readonly number[] = [-1, 1, 0, 4]

/** Primary weapon shown in slot "1": the held weapon if it is a primary, otherwise the rifle if owned, otherwise the mid-range weapon */
export function primarySlotToShow(keys: readonly (string | null)[], active: number): number {
  if ((active === 2 || active === 3) && keys[active]) return active
  return keys[3] ? 3 : 2
}

export function createBottomHud() {
  const st = document.createElement('style')
  st.textContent = STYLE
  document.head.appendChild(st)

  // Bottom left: money + health
  const left = div('hb hb-left')
  const moneyRow = div('hb-money', left)
  moneyRow.innerHTML = '<span class="cur">$</span><span class="num">0</span>'
  const moneyNum = moneyRow.querySelector('.num') as HTMLElement
  const hpRow = div('hb-hp', left)
  hpRow.innerHTML = HEART + '<span class="v">100</span>'
  const hpVal = hpRow.querySelector('.v') as HTMLElement

  // Bottom middle: 4 weapon slots following the CS 1.6 keys – 1 primary, 2 pistol, 3 knife, 4 grenade. Slot 1 merges rifle and mid-range (shows the held / owned one)
  const slotsBox = div('hb hb-slots')
  const slotEls: HTMLDivElement[] = []
  for (let i = 0; i < HUD_SLOTS; i++) {
    const s = div('hb-slot empty', slotsBox)
    const k = document.createElement('div'); k.className = 'k'; k.textContent = HUD_KEY_LABEL[i]!
    s.appendChild(k)
    slotEls.push(s)
  }
  let slotKey = ''

  // Bottom right: ammo + weapon name
  const right = div('hb hb-right')
  const ammoEl = div('hb-ammo', right)
  const wnameEl = div('hb-wname', right)
  let ammoKey = ''

  // Money: the number counts up to the new value over 400ms
  let shown = 0, from = 0, target = 0, tween = 400
  let first = true
  function flash(up: boolean): void {
    moneyNum.style.transition = 'none'
    moneyNum.style.color = up ? '#5fd16b' : '#ff5555'
    void moneyNum.offsetWidth
    moneyNum.style.transition = 'color 600ms'
    moneyNum.style.color = '#fff'
  }

  let infinite = false
  return {
    setMoneyVisible(v: boolean): void { moneyRow.style.display = v ? '' : 'none' },
    /** Offline + infinite money: show `∞` instead of the amount */
    setInfiniteMoney(v: boolean): void { infinite = v; moneyNum.textContent = v ? '∞' : String(shown) },
    /** Hide the whole bottom HUD cluster (while spectating a teammate) */
    setVisible(v: boolean): void { const d = v ? '' : 'none'; left.style.display = d; slotsBox.style.display = d; right.style.display = d },
    /** Touch: tapping slot d (0..3, the displayed order = keys 1..4) calls fn(d). The bar is otherwise click-through, so this only turns it on. */
    onSlotTap(fn: (displayedSlot: number) => void): void {
      slotEls.forEach((el, d) => {
        el.style.pointerEvents = 'auto'
        el.style.touchAction = 'none'
        el.setAttribute('data-slot', String(d + 1))
        el.addEventListener('pointerdown', e => { e.preventDefault(); fn(d) })
      })
    },
    setMoney(v: number): void {
      if (first) { first = false; shown = from = target = v; moneyNum.textContent = infinite ? '∞' : String(v); return }
      if (v === target) return
      if (!infinite) flash(v > target)
      from = shown; target = v; tween = 0
    },
    /** A floating +$500 rises next to the money number and fades out (600ms). bounty: bigger, gold */
    floatMoney(delta: number, bounty = false): void {
      const f = document.createElement('div')
      f.className = 'hb-float'
      f.textContent = `${delta >= 0 ? '+' : '-'}$${Math.abs(delta)}`
      f.style.color = bounty ? '#ffd23c' : delta >= 0 ? '#5fd16b' : '#ff5555'
      f.style.fontSize = bounty ? '1.5em' : '1em'
      moneyRow.appendChild(f)
      setTimeout(() => f.remove(), 650)
    },
    setHealth(v: number): void {
      hpVal.textContent = String(Math.max(0, Math.round(v)))
      hpRow.classList.toggle('low', v > 0 && v < 30)
    },
    /** keys: weapon key in each slot (null = empty); active = slot being held */
    setSlots(keys: readonly (string | null)[], active: number, counts?: readonly (number | null)[]): void {
      const k = keys.join(',') + '|' + active + '|' + (counts ? counts.join(',') : '')
      if (k === slotKey) return
      slotKey = k
      const primary = primarySlotToShow(keys, active)
      for (let d = 0; d < HUD_SLOTS; d++) {
        const i = d === 0 ? primary : HUD_LOGIC_SLOT[d]!   // logical slot displayed at position d
        const el = slotEls[d]!
        const key = keys[i] ?? null
        el.classList.toggle('empty', key === null)
        el.classList.toggle('active', i === active && key !== null)
        el.querySelector('img,span:not(.k)')?.remove()
        el.querySelector('.n')?.remove()
        const cnt = counts?.[i]
        if (key && cnt != null) {
          const n = document.createElement('div'); n.className = 'n'; n.textContent = `×${cnt}`
          el.appendChild(n)
        }
        if (key) {
          const def = WEAPON_BY_KEY.get(key)
          el.insertBefore(weaponIcon(key, def?.name ?? key), el.firstChild)
          el.title = def ? t(`category.${def.category}`) : ''
        }
      }
    },
    setAmmo(name: string, cur: number, mag: number, reloading: boolean, melee = false, consumable = false, infinite = false): void {
      const key = `${name}|${cur}|${mag}|${reloading}|${melee}|${consumable}|${infinite}`
      if (key === ammoKey) return
      ammoKey = key
      ammoEl.textContent = consumable ? `×${cur}` : melee ? '—' : reloading ? t('hud.ammo.reload') : `${cur} / ${infinite ? '∞' : mag}`
      ammoEl.classList.toggle('low', !melee && !consumable && !reloading && mag > 0 && cur <= mag * 0.25)
      wnameEl.textContent = name
    },
    tick(dtMs: number): void {
      if (shown === target) return
      tween += dtMs
      const k = Math.min(1, tween / 400)
      shown = k >= 1 ? target : Math.round(from + (target - from) * (1 - (1 - k) * (1 - k)))
      if (!infinite) moneyNum.textContent = String(shown)
    },
  }
}
export type BottomHud = ReturnType<typeof createBottomHud>
