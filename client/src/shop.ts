// Shopping cart + shop menu (H.7). Only displays and sends the Buy command; money/loadout/buy zone are decided by the server.
import { CATEGORY_SLOT, ECONOMY, type EconomyConfig, WEAPONS, grenadeCount, maxCarryOf, quoteBuy, type Loadout, type OwnedWeapon } from '@fps/shared'
import { weaponLabel, weaponIcon } from './weaponIcon'
import { t } from './i18n'
import { IS_TOUCH } from './touch/mode'
import { hudIcon } from './hudIcons'

export interface ShopDeps {
  money(): number
  loadout(): (OwnedWeapon | null)[]
  eco?(): EconomyConfig            // economy rules of the game mode (default: Team Deathmatch)
  canShop(): boolean              // in the buy zone, alive, match not ENDED, online
  onDenied?(): void               // the player asked to open the menu but cannot (tell them why)
  send(key: string): void         // send the Buy command
  onOpenChange?(open: boolean): void
  sounds: { ok(): void; fail(): void }
}

// Two-level menu as in CS 1.6: B opens it, a level-1 number key picks a group (1 Pistols, 2 Shotguns, 3 SMGs, 4 Rifles, 8 Equipment), level 2 picks the item, 0 exits.
// Buying an AK47 = B 4 2. Equipment: 4 = HE grenade, 5 = smoke grenade (the same numbers as the CS 1.6 Equipment menu).
interface GroupDef { num: number; label: string /* i18n key */; items: [number, string][] }
const GROUPS: GroupDef[] = [
  { num: 1, label: 'hud.shop.group.pistols', items: [[1, 'colt'], [2, 'rulo']] },
  { num: 2, label: 'hud.shop.group.shotguns', items: [[1, 'shotgun']] },
  { num: 3, label: 'hud.shop.group.smgs', items: [[1, 'smg']] },
  { num: 4, label: 'hud.shop.group.rifles', items: [[1, 'm16'], [2, 'ak47'], [3, 'sniper']] },
  { num: 8, label: 'hud.shop.group.equipment', items: [[4, 'm67'], [5, 'smoke']] },
]

const STYLE = `
.shop-cart{position:fixed;left:24px;top:50%;transform:translateY(-50%);z-index:26;display:flex;align-items:center;gap:6px;color:#fff;
  font:14px sans-serif;text-shadow:0 0 4px #000;opacity:.3;pointer-events:auto;cursor:pointer;user-select:none;border-radius:10px;padding:6px 8px;transition:opacity 150ms,left 200ms ease}
.shop-cart svg{width:36px;height:36px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.shop-cart.shift{left:224px}
.shop-cart.shift2{left:564px}
.shop-cart.on{opacity:1;animation:shop-glow 2.4s ease-in-out infinite}
@keyframes shop-glow{0%,100%{box-shadow:0 0 0 rgba(255,255,255,0)}50%{box-shadow:0 0 14px rgba(255,255,255,.55)}}
.shop-panel{position:fixed;left:0;top:15%;width:200px;max-height:70vh;overflow:auto;z-index:25;box-sizing:border-box;padding:14px 14px 10px;
  background:rgba(10,12,16,.88);border-radius:0 12px 12px 0;color:#fff;font:14px sans-serif;transform:translateX(-100%);transition:transform 200ms ease;pointer-events:none}
.shop-panel.open{transform:translateX(0);pointer-events:auto}
.shop-sub{left:200px;width:340px;border-radius:0 12px 12px 0;border-left:1px solid rgba(255,255,255,.2);z-index:24;transform:translateX(calc(-100% - 200px))}
.shop-sub.open{transform:translateX(0)}
.shop-grp{display:flex;align-items:center;gap:8px;padding:7px 6px;border-radius:6px;cursor:pointer;font-weight:700}
.shop-grp:hover,.shop-grp.sel{background:rgba(255,255,255,.14)}
.shop-grp .badge{flex:none;min-width:24px;text-align:center;font:bold 12px monospace;border:1px solid rgba(255,255,255,.5);border-radius:5px;padding:1px 0}
.shop-grp .cur{display:block;font-size:10.5px;font-weight:400;color:#9aa0aa}
.shop-head{display:flex;justify-content:space-between;align-items:baseline;font-weight:800;font-size:16px;margin-bottom:6px}
.shop-head .m{color:#5fd16b}
.shop-line{border-top:1px solid rgba(255,255,255,.25);margin-top:8px}
.shop-cat{font-size:11px;color:#9aa0aa;text-transform:uppercase;letter-spacing:.06em;margin:3px 0 2px}
.shop-row{display:flex;align-items:center;gap:8px;padding:3px 4px;border-radius:6px;cursor:pointer;position:relative}
.shop-row:hover{background:rgba(255,255,255,.08)}
.shop-row .badge{flex:none;min-width:24px;text-align:center;font:bold 12px monospace;border:1px solid rgba(255,255,255,.5);border-radius:5px;padding:1px 0}
.shop-row .ico{flex:none;width:96px;height:40px;display:flex;align-items:center;justify-content:center}
.shop-row .ico img{width:96px;height:40px}
.shop-row .nm{flex:1;font-weight:700}
.shop-row .pr{font-weight:800}
.shop-row .sub{position:absolute;left:136px;bottom:-2px;font-size:10.5px;color:#9aa0aa;white-space:nowrap}
.shop-row.has-sub{padding-bottom:13px}
.shop-row.dim{opacity:.5}
.shop-row.dim.owned{opacity:.6}
.shop-row .pr.bad{color:#ff5555}
.shop-row.ok-flash{animation:shop-ok 500ms ease-out}
@keyframes shop-ok{0%{background:rgba(95,209,107,.65)}100%{background:rgba(95,209,107,0)}}
.shop-row.shake{animation:shop-shake 150ms linear}
@keyframes shop-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}
.shop-foot{font-size:12px;color:#9aa0aa;margin-top:10px;line-height:1.4}
/* Touch (plan 19): one sheet instead of two sliding panels. The group rail is on the left, the items of the selected group right next to it
   (the first group is preselected, so opening the menu already shows weapons: open, tap a weapon = bought). Finger-sized targets (>= 44px),
   no keyboard hints, a close button, and the cart hides while the sheet is open (it no longer hops around the screen). */
.shop-x{display:none;flex:none;width:44px;height:44px;margin:-10px -8px -10px 4px;align-items:center;justify-content:center;font:22px sans-serif;color:#fff;cursor:pointer}
html.touch .shop-x{display:flex}
html.touch .shop-cart{padding:12px 14px;opacity:.6}
html.touch .shop-cart svg{width:40px;height:40px}
html.touch .shop-cart.shift{visibility:hidden}
html.touch.hand-left .shop-cart{left:auto;right:24px}   /* left-handed: the Fire arc is on the left */
html.touch .shop-cart span:first-of-type{display:none}   /* the "(B)" key hint */
html.touch .shop-panel{top:68px;max-height:calc(100vh - 76px);max-height:calc(100dvh - 76px);width:150px;padding:10px 8px;border-radius:0;transition:none;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}   /* below the Scoreboard / Switch team buttons and the room label */
html.touch .shop-sub{left:150px;width:min(320px,calc(100vw - 160px));border-radius:0 12px 12px 0;transform:translateX(-200%)}
html.touch .shop-sub.open{transform:translateX(0)}
html.touch .shop-head{font-size:15px;margin-bottom:4px;align-items:center;gap:6px}
html.touch .shop-grp{padding:9px 8px;font-size:16px;min-height:44px;box-sizing:border-box}
html.touch .shop-grp.sel{background:rgba(255,255,255,.22)}
html.touch .shop-row{padding:8px 6px;min-height:56px;box-sizing:border-box}
html.touch .shop-row:active{background:rgba(255,255,255,.18)}
html.touch .shop-row.has-sub{padding-bottom:20px}
html.touch .shop-row .ico{width:72px;height:32px}
html.touch .shop-row .ico img{width:72px;height:32px}
html.touch .shop-row .sub{left:92px}
html.touch .shop-grp .badge,html.touch .shop-row .badge,html.touch .shop-foot{display:none}
`

const CART = '<svg viewBox="0 0 24 24"><path d="M2 3h3l2.2 11.2a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.5L21 7H6"/><circle cx="10" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/></svg>'

export function createShop(deps: ShopDeps) {
  const st = document.createElement('style')
  st.textContent = STYLE
  document.head.appendChild(st)

  const cart = document.createElement('div')
  cart.className = 'shop-cart'
  cart.innerHTML = CART + '<span>(B)</span><span class="bt" style="color:#ffd23c"></span>'
  const buyEl = cart.querySelector('.bt') as HTMLElement
  document.body.appendChild(cart)

  const panel = document.createElement('div')
  panel.className = 'shop-panel'
  document.body.appendChild(panel)
  const head = document.createElement('div')
  head.className = 'shop-head'
  head.innerHTML = `<span>${t('hud.shop.title')}</span><span class="m"></span>`
  const moneyEl = head.querySelector('.m') as HTMLElement
  const closeBtn = document.createElement('span')   // touch only (CSS): there is no B / 0 key on a phone
  closeBtn.className = 'shop-x'; closeBtn.appendChild(hudIcon('close', '20px'))
  closeBtn.setAttribute('role', 'button'); closeBtn.setAttribute('aria-label', t('hud.shop.close'))
  head.appendChild(closeBtn)
  panel.appendChild(head)

  const sub = document.createElement('div')
  sub.className = 'shop-panel shop-sub'
  document.body.appendChild(sub)

  interface Row { key: string; el: HTMLElement; pr: HTMLElement; sub: HTMLElement }
  interface Grp { def: GroupDef; el: HTMLElement; cur: HTMLElement; box: HTMLElement; rows: Map<number, Row> }
  const rows: Row[] = []
  const groups: Grp[] = []
  for (const g of GROUPS) {
    const gel = document.createElement('div'); gel.className = 'shop-grp'
    const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = `(${g.num})`
    const txt = document.createElement('span')
    txt.textContent = t(g.label)
    const cur = document.createElement('span'); cur.className = 'cur'
    txt.appendChild(cur)
    gel.append(badge, txt)
    panel.appendChild(gel)
    const box = document.createElement('div'); box.style.display = 'none'
    sub.appendChild(box)
    const grp: Grp = { def: g, el: gel, cur, box, rows: new Map() }
    gel.addEventListener('click', () => openGroup(grp))
    for (const [num, key] of g.items) {
      const w = WEAPONS.find(x => x.key === key)
      if (!w || !w.buyable) continue
      const el = document.createElement('div')
      el.className = 'shop-row'
      const bd = document.createElement('span'); bd.className = 'badge'; bd.textContent = `(${num})`
      const ico = document.createElement('span'); ico.className = 'ico'; ico.appendChild(weaponIcon(w.key, weaponLabel(w.key, w.name)))
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = weaponLabel(w.key, w.name)
      const pr = document.createElement('span'); pr.className = 'pr'
      const sb = document.createElement('span'); sb.className = 'sub'
      el.append(bd, ico, nm, pr, sb)
      el.addEventListener('click', () => buyKey(key))
      box.appendChild(el)
      const row: Row = { key: w.key, el, pr, sub: sb }
      rows.push(row); grp.rows.set(num, row)
    }
    groups.push(grp)
  }
  const foot = document.createElement('div')
  foot.className = 'shop-line'
  const footTxt = document.createElement('div')
  footTxt.className = 'shop-foot'
  footTxt.textContent = t('hud.shop.footer', { pct: Math.round((deps.eco?.() ?? ECONOMY).sellRatio * 100), he: maxCarryOf('m67'), smoke: maxCarryOf('smoke') })
  footTxt.style.whiteSpace = 'pre-line'
  panel.append(foot, footTxt)

  let selected: Grp | null = null
  let open = false
  let drawKey = ''
  const asLoadout = (): Loadout => ({ slots: deps.loadout() })

  function setOpen(v: boolean): void {
    if (v === open) return
    open = v
    if (!v) selectGroup(null)
    else if (IS_TOUCH) selectGroup(groups[0] ?? null)
    panel.classList.toggle('open', v)
    cart.classList.toggle('shift', v)   // the menu slides out from the left edge: push the cart right so it is not covered
    deps.onOpenChange?.(v)
  }

  function selectGroup(g: Grp | null): void {
    selected = g
    for (const x of groups) { x.el.classList.toggle('sel', x === g); x.box.style.display = x === g ? '' : 'none' }
    sub.classList.toggle('open', g !== null)
    cart.classList.toggle('shift2', g !== null)
  }
  function openGroup(g: Grp): void { if (open) { drawKey = ''; selectGroup(g) } }

  function refresh(): void {
    const money = deps.money()
    const lo = asLoadout()
    const key = `${money}|${lo.slots.map(w => (w ? w.key + w.paid + ':' + JSON.stringify(w.counts ?? w.count ?? 0) : '-')).join(',')}`
    if (key === drawKey) return
    drawKey = key
    moneyEl.textContent = `$${money}`
    for (const g of groups) {   // small line under the group name: items owned that belong to this group
      const have: string[] = []
      for (const r of g.rows.values()) {
        const def = WEAPONS.find(w => w.key === r.key)!
        if (def.consumable) { const n = grenadeCount(lo, r.key); if (n > 0) have.push(`${weaponLabel(r.key)} ×${n}`) }
        else if (lo.slots[CATEGORY_SLOT[def.category]]?.key === r.key) have.push(weaponLabel(r.key))
      }
      g.cur.textContent = have.length ? have.join(' · ') : '—'
    }
    for (const r of rows) {
      const q = quoteBuy(money, lo, r.key, deps.eco?.())
      const def = WEAPONS.find(w => w.key === r.key)!
      const old = lo.slots[CATEGORY_SLOT[def.category]] ?? null
      const owned = !q.ok && q.reason === 'already_owned'
      const full = !q.ok && q.reason === 'max_carry'
      const cnt = def.consumable ? grenadeCount(lo, r.key) : 0
      const maxN = maxCarryOf(r.key)
      r.pr.textContent = owned ? t('hud.shop.inUse') : full ? t('hud.shop.full', { cnt, max: maxN }) : def.consumable && cnt > 0 ? `${cnt}/${maxN} · $${def.price}` : `$${def.price}`
      r.pr.classList.toggle('bad', !q.ok && q.reason === 'not_enough_money')
      r.el.classList.toggle('dim', !q.ok)
      r.el.classList.toggle('owned', owned)
      let sub = ''
      if (old && !owned && !def.consumable) {
        const oldName = weaponLabel(old.key)
        const refund = q.refund
        sub = refund > 0
          ? t(q.net >= 0 ? 'hud.shop.sellPay' : 'hud.shop.sellGet', { name: oldName, refund, amount: Math.abs(q.net) })
          : t('hud.shop.issued', { name: oldName })
      }
      r.sub.textContent = sub
      r.el.classList.toggle('has-sub', sub !== '')
    }
  }

  function buyKey(key: string): void {
    if (!deps.canShop()) return
    const q = quoteBuy(deps.money(), asLoadout(), key, deps.eco?.())
    if (!q.ok) { feedback(key, false); return }
    deps.send(key)
  }

  function feedback(key: string, ok: boolean): void {
    const r = rows.find(x => x.key === key)
    if (r) {
      const cls = ok ? 'ok-flash' : 'shake'
      r.el.classList.remove('ok-flash', 'shake')
      void r.el.offsetWidth
      r.el.classList.add(cls)
      setTimeout(() => r.el.classList.remove(cls), 520)
    }
    if (ok) deps.sounds.ok(); else deps.sounds.fail()
  }

  cart.addEventListener('click', () => api.toggle())
  closeBtn.addEventListener('click', () => setOpen(false))

  const api = {
    get isOpen(): boolean { return open },
    toggle(): void { if (open) setOpen(false); else if (deps.canShop()) setOpen(true); else deps.onDenied?.() },
    close(): void { setOpen(false) },
    /** Number key while the menu is open: level 1 picks a group (1–4, 8), level 2 picks an item, 0 exits. Returns true if handled (no weapon switch) */
    digit(n: number): boolean {
      if (!open) return false
      if (n === 0) { setOpen(false); return true }   // 0 = exit, as in CS 1.6
      if (!selected) {
        const g = groups.find(x => x.def.num === n)
        if (g) openGroup(g)
        return true
      }
      const r = selected.rows.get(n)
      if (r) buyKey(r.key)
      else { const g = groups.find(x => x.def.num === n); if (g) openGroup(g) }   // pressing another group number while on level 2: jump to that group
      return true
    },
    onBuyResult(ok: boolean, key: string): void { feedback(key, ok); if (ok) setOpen(false) },   // close the shop after a purchase
    /** Call every frame: closes itself when leaving the buy zone / dying / match end, updates the cart + list */
    tick(): void {
      const can = deps.canShop()
      cart.classList.toggle('on', can)
      if (!can && open) setOpen(false)
      if (open) refresh()
    },
    /** Remaining buy time (ms) next to the cart; null = hidden */
    setBuyLeft(ms: number | null): void {
      const text = ms === null ? '' : t('hud.shop.buyTime', { time: `${Math.floor(Math.ceil(ms / 1000) / 60)}:${String(Math.ceil(ms / 1000) % 60).padStart(2, '0')}` })
      if (buyEl.textContent !== text) buyEl.textContent = text
    },
    /** Used when opened by click while the money state changes: forces a redraw */
    invalidate(): void { drawKey = '' },
  }
  return api
}
export type Shop = ReturnType<typeof createShop>
