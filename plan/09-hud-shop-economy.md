# 09 – New HUD, 4 weapon slots, shop and economy

Do this after the core is finished (phases 0–5 + the audio task). It touches `shared/` (guns, economy) and the server, so **follow the task order exactly**, and finish testing each task before moving on to the next.

Order: H.0 → H.1 → H.2 → H.3 → H.4 → H.5 → H.6 → H.7 → H.8. Tasks marked ⚠️ should use a stronger model.

---

## Summary of the new rules

- Each player carries at most **4 weapon categories**, **exactly 1 weapon** per category:

| Slot (key) | Category | Guns in the category |
|---|---|---|
| 1 | Knife | Knife (always owned, cannot be bought/sold) |
| 2 | Pistol | Colt, Rulo |
| 3 | Mid-range | Shotgun, SMG |
| 4 | Rifle | AK47, M16, Sniper |

- At the start of a match: **$2000**, a knife + 1 pistol + 1 rifle depending on team:
  - Cops: Knife, **Colt**, **M16**
  - Terrorists: Knife, **Rulo**, **AK47**
- Killing someone: **+$500**. If the victim currently has a **kill streak ≥ 3** then **+$1000** (wanted bounty). When a player is killed, their kill streak resets to 0.
- Maximum money is **$16000**; anything over that is lost.
- You can only buy when **standing in your own team's base zone, behind the city wall, on the ground** (the wall ledge and tower top do not count).
- Buying a gun in the same category as one you already own: **the old gun is automatically sold for 80% of what you paid for it**, then the new gun is bought.

### Provisional decisions (changeable via config, see H.2)

- **Guns issued at the start of a match cannot be resold** (resale price = $0). Reason: avoid the "die -> respawn with a free M16 -> sell it for $2480" infinite loop.
- **Dying loses the guns you bought**; you respawn with the team's default set (money is kept). Reason: so bounty money stays meaningful through the whole match. You respawn in the base so you can buy again right away.
- The shop sells **every gun to both teams** (Cops can buy the AK47, Terrorists can buy the M16).
- A new match (after ENDED) or a player joining mid-match: money back to $2000, default set, kill streak = 0.

---

## Task H.0 – Clean up the map

Do:
- Remove the dummies/targets in the middle area from the map. Keep the dummy code for practice: only show them when opened with `?dummies=1`.
- Remove the spawn arrows/markers from the map during play. Only draw them when the F4 debug is on (together with the collider drawing mode).

Acceptance:
- [ ] Enter a normal match: no more dummies in the middle of the map, no more spawn markers in the base.
- [ ] `?dummies=1`: the dummies show again and can be shot as before. F4: the spawn arrows are visible again.

---

## Task H.1 – Expand the weapon set ⚠️

### H.1.1 New fields in `WeaponDef` (`shared/src/weapons.ts`)

```ts
export type WeaponCategory = 'knife' | 'pistol' | 'mid' | 'long';
export const CATEGORY_SLOT: Record<WeaponCategory, 0 | 1 | 2 | 3> = { knife: 0, pistol: 1, mid: 2, long: 3 };
export const CATEGORY_LABEL: Record<WeaponCategory, string> = {
  knife: 'Knife', pistol: 'Pistol', mid: 'Mid-range', long: 'Rifle',
};

interface WeaponDef {
  // ...existing fields...
  key: string;               // 'knife' | 'colt' | 'rulo' | 'shotgun' | 'smg' | 'ak47' | 'm16' | 'sniper' — used for icon/audio/model file names
  category: WeaponCategory;
  price: number;             // USD; knife = 0
  buyable: boolean;          // knife = false
  pellets?: number;          // shotgun: number of rays per shot (default 1)
  falloff?: { startM: number; endM: number; minMult: number }; // damage reduction by distance
  melee?: boolean;           // knife: no ammo, no reload, short range
  scope?: { fov: number; spreadDeg: number }; // sniper: right mouse button to aim
  unscopedSpreadDeg?: number; // sniper when not aiming
  moveSpeedMul: number;      // run speed multiplier while holding this gun
}
```

Remove the old `slot` field (replaced by `category`). Remove selecting a gun by id on keys 1–4 (replaced by H.4).

### H.1.2 Gun table and prices (provisional prices, the user will tune them)

| key | Name | Category | Price | Notes |
|---|---|---|---|---|
| knife | Knife | knife | 0 | default, cannot be bought/sold |
| colt | Colt | pistol | $300 | Cops default |
| rulo | Rulo | pistol | $700 | Terrorists default |
| shotgun | Shotgun | mid | $1100 | |
| smg | SMG | mid | $1250 | |
| ak47 | AK47 | long | $2700 | Terrorists default |
| m16 | M16 | long | $3100 | Cops default |
| sniper | Sniper | long | $4750 | |

Stats for the new guns (AK47, M16, Colt, Rulo stay as in task A.1, only the new fields are added):

```ts
{ key: 'knife', name: 'Knife', category: 'knife', price: 0, buyable: false, melee: true, auto: true,
  damage: 55, headMult: 2, legMult: 1, fireIntervalMs: 450, magSize: 0, reloadMs: 0, reloadEmptyMs: 0,
  range: 2.2, spreadDeg: { stand: 0, move: 0, air: 0, crouch: 0 },
  recoilPitchDeg: 0, recoilYawDeg: 0, recoilRecoverDegPerSec: 0, moveSpeedMul: 1.1 },

{ key: 'shotgun', name: 'Shotgun', category: 'mid', price: 1100, buyable: true, auto: false, pellets: 8,
  damage: 14, headMult: 1.5, legMult: 0.75, falloff: { startM: 6, endM: 20, minMult: 0.3 },
  fireIntervalMs: 850, magSize: 6, reloadMs: 2400, reloadEmptyMs: 2400, range: 40,
  spreadDeg: { stand: 4.5, move: 5.5, air: 7, crouch: 4 },
  recoilPitchDeg: 4, recoilYawDeg: 0.6, recoilRecoverDegPerSec: 9, moveSpeedMul: 0.95 },

{ key: 'smg', name: 'SMG', category: 'mid', price: 1250, buyable: true, auto: true,
  damage: 20, headMult: 3, legMult: 0.75, falloff: { startM: 15, endM: 40, minMult: 0.6 },
  fireIntervalMs: 70, magSize: 30, reloadMs: 1800, reloadEmptyMs: 2200, range: 100,
  spreadDeg: { stand: 0.7, move: 1.2, air: 3.5, crouch: 0.5 },
  recoilPitchDeg: 0.4, recoilYawDeg: 0.35, recoilRecoverDegPerSec: 10, moveSpeedMul: 1.0 },

{ key: 'sniper', name: 'Sniper', category: 'long', price: 4750, buyable: true, auto: false,
  damage: 95, headMult: 2, legMult: 0.75,
  fireIntervalMs: 1400, magSize: 5, reloadMs: 3000, reloadEmptyMs: 3600, range: 300,
  scope: { fov: 25, spreadDeg: 0.05 }, unscopedSpreadDeg: 8,
  spreadDeg: { stand: 0.05, move: 3, air: 10, crouch: 0.05 },
  recoilPitchDeg: 5, recoilYawDeg: 0.3, recoilRecoverDegPerSec: 6, moveSpeedMul: 0.85 },
```

`moveSpeedMul` for the existing guns: Colt 1.0, Rulo 1.0, AK47 0.92, M16 0.93.

### H.1.3 Firing logic for the new guns (shared + server)

- **Shotgun (pellets):** each shot creates `pellets` rays. The spread of ray number `k` uses the seed `hashSeed(playerId, shotSeq, k)`. The server adds up the damage of all rays hitting the same player into **one** hit event (HitConfirm carries the total damage, `headshot = true` if at least 1 ray hit the head). Each ray's damage is multiplied by the `falloff` factor based on distance.
- **Falloff:** `mult = 1` if `d ≤ startM`; `minMult` if `d ≥ endM`; linearly interpolated in between.
- **Knife (melee):** consumes no ammo, no reload, the HUD ammo shows `—`. Fires a hitscan ray of length `range` (2.2m) from the eye; **no spread, no recoil**. Lag compensation still applies as with guns.
- **Sniper (scope):** add a `Btn.Scope` bit (right mouse button) to `InputCmd`. While holding Scope -> spread = `scope.spreadDeg`, the client changes FOV to `scope.fov` (interpolated over 120ms), covers the screen with a scope frame (HTML/CSS: transparent circle, black outside, thin crosshair), hides the viewmodel, reduces sensitivity in proportion to the FOV. Not holding Scope -> spread = `unscopedSpreadDeg`. After firing, automatically leave the scope for 0.3s then re-enter if the right mouse button is still held.
- **moveSpeedMul:** `stepMovement` multiplies `runSpeed`/`crouchSpeed` by the `moveSpeedMul` of the weapon **currently held** (taken from the loadout + the slot in the cmd). Aiming the sniper: multiply by an additional 0.5.

Acceptance:
- [ ] Test: shotgun, 1 shot at 3m into the body -> 8 rays, total damage ≈ 8 × 14 if all hit; at 25m it drops to about 30%.
- [ ] Test: same `playerId, shotSeq` -> the 8 ray directions are identical between 2 runs.
- [ ] The movement determinism test (task 1.6) still passes after adding `moveSpeedMul` and switching guns mid-way.
- [ ] Knife: a slash hits at 2m, a slash from 3m does not hit. 2 slashes kill.
- [ ] Sniper: hip-fire scatters, aiming hits precisely; 1 body shot leaves 5 health, a headshot kills.
- [ ] Running with the knife is faster than with the AK47 (measure on the debug overlay).
- [ ] Reconcile test (task 3.7): 1 minute of constantly switching guns while running, the reconcile error is still ≈ 0.

Pitfalls:
- Switching guns changes run speed -> if client and server disagree on the slot at the same `seq`, reconcile will jerk. The slot must travel in `InputCmd` (the `weapon` field already exists, its meaning changes to **slot 0–3**) and the server uses exactly that value.
- Models/audio for Shotgun, SMG, Sniper, Knife do not exist yet: the viewmodel uses a placeholder box, audio uses a placeholder profile (copy Colt for the knife at −30dB gain, replaced by a synthesized "whoosh": noise bandpass sweeping 800→3000Hz over 120ms, −10dB). Do not block the task because of missing assets.

---

## Task H.2 – Economy and loadout logic (shared, pure) ⚠️

Create `shared/src/economy.ts`. **Do not** import anything outside `shared/`. This is the only place holding the buy/sell/reward rules; both the client (display) and the server (decisions) call it.

```ts
export const ECONOMY = {
  startMoney: 2000,
  maxMoney: 16000,
  killReward: 500,
  bountyStreak: 3,          // victim has a kill streak >= this value
  bountyReward: 1000,
  sellRatio: 0.8,
  defaultResaleValue: 0,    // resale price of guns issued by default (0 = cannot be sold)
  keepLoadoutOnDeath: false,
};

export const DEFAULT_LOADOUT: Record<TeamId, string[]> = {
  A: ['knife', 'colt', 'm16'],   // Cops
  B: ['knife', 'rulo', 'ak47'],  // Terrorists
};

export interface OwnedWeapon { key: string; paid: number; }   // paid = amount paid (issued guns = 0)
export interface Loadout { slots: (OwnedWeapon | null)[]; }    // always exactly 4 elements, indexed by CATEGORY_SLOT

export function defaultLoadout(team: TeamId): Loadout;
export function resaleValue(w: OwnedWeapon): number;           // Math.floor(w.paid * sellRatio)
export function quoteBuy(money: number, loadout: Loadout, key: string):
  | { ok: true; price: number; refund: number; net: number; slot: number }
  | { ok: false; reason: 'not_buyable' | 'already_owned' | 'not_enough_money'; price: number; refund: number; net: number };
export function applyBuy(money: number, loadout: Loadout, key: string): { money: number; loadout: Loadout } | null;
export function killReward(victimStreak: number): number;      // victimStreak >= bountyStreak ? bountyReward : killReward
export function addMoney(money: number, delta: number): number; // clamp to [0, maxMoney]
```

Rules:
- `refund` = resale price of the gun currently owned in the same category (0 if empty). `net = price − refund`.
- Enough money when `money ≥ net` (the money from selling the old gun is counted). `net` can be negative (selling an expensive gun to buy a cheap one) -> money is added, still clamped to `maxMoney`.
- A newly bought gun has `paid = price`.
- Buying a gun you **already own** -> `already_owned`.
- The functions **do not** mutate the input objects, they return new objects.

Acceptance (vitest):
- [ ] Cops with $2000 buy the SMG: $750 left, slot 3 = SMG (paid 1250).
- [ ] Then buy the Shotgun: refund 1000 (80% of 1250), net 100, $650 left.
- [ ] Cops with $2000 buy the Sniper: `not_enough_money` (the issued M16 sells for $0, net 4750).
- [ ] Terrorists buy the AK47 while owning an AK47: `already_owned`.
- [ ] With $15800 and a Sniper (paid 4750 → refund 3800), buy the M16 ($3100): net = −700 → money gains 700 but is clamped to $16000.
- [ ] `killReward(2) = 500`, `killReward(3) = 1000`, `killReward(7) = 1000`.
- [ ] `addMoney(15800, 500) = 16000`.
- [ ] Buying the knife: `not_buyable`.

---

## Task H.3 – Server: money, loadout, buy zone, rewards ⚠️

### New messages (`protocol.ts`)

```ts
// C2S
  | { t: 5; key: string }                                   // Buy

// S2C
  | { t: 114; ok: boolean; reason?: string; key: string }   // BuyResult (to the buyer only)
  | { t: 115; delta: number; reason: 'kill' | 'bounty' | 'buy' | 'sell' | 'reset' } // MoneyEvent (to the recipient only)

// Kill (t: 107) adds: reward: number, victimStreak: number
// NetPlayer adds: killStreak (visible to everyone, to show the wanted marker)
// For the player themselves in Snapshot add: money, loadout (array of 4 elements key|null), slot
```

### Buy zone

- Map JSON adds: `"buyZoneA": { "min": [x, y, z], "max": [x, y, z] }` for the base on the negative-x side; `loadMap` mirrors it to `buyZoneB` (flip x, swap min/max accordingly).
- Map "Two Walls": base x −30 → the inner face of the city wall (≈ −19.75), z −20..20, **y from −1 to 2.5** (feet must be on the ground; standing on the 4m wall ledge or the 6m tower top is outside the zone).
- Which team is in which base depends on `sideSwapped` (task 5.4). Write a `shared` function: `inBuyZone(map, team, sideSwapped, pos): boolean` (uses the foot position).

### Server handling

- On receiving Buy: check `alive`, `inBuyZone` (current server position), match phase is not ENDED, then `applyBuy`. On success: update money + loadout, **automatically switch to the slot just bought**, fill ammo, cancel any running reload; send BuyResult + MoneyEvent (`buy` negative, and `sell` positive if there is a refund).
- Anti-spam limit: at most 5 Buy commands per second per player.
- Kill: `reward = killReward(victim.killStreak)`, add to the killer (`addMoney`), `killer.killStreak++`, `victim.killStreak = 0`. Send MoneyEvent (`kill` or `bounty`).
- Death: if `keepLoadoutOnDeath = false` → on respawn loadout = `defaultLoadout(team)`, slot = rifle. Money is kept.
- New match / player joining mid-match / team change: money = `startMoney`, default loadout, `killStreak = 0`, send MoneyEvent `reset`.
- `InputCmd.weapon` is now a **slot 0–3**. Empty slot → the server keeps the old slot (no holding "thin air").

Acceptance:
- [ ] Standing in the base, buy the SMG: money decreases, SMG is held immediately. Climb onto the wall ledge and press buy: the server rejects (`out_of_zone`).
- [ ] Temporarily modify the client to send Buy while standing in the middle of the map: the server rejects.
- [ ] Kill a player with a streak of 3: receive +$1000; that player respawns with streak 0.
- [ ] Buy the Sniper, die, respawn: back to the default set (Cops: Colt + M16).
- [ ] Match ends, new match: everyone has $2000, default set.
- [ ] Switch sides (2nd match): Cops can buy at the new base, not at the old one.

Pitfalls:
- Money and loadout are **decided by the server only**. The client does not deduct money itself when pressing buy; wait for BuyResult (local ping is low so no delay is noticeable).
- The client may still compute `inBuyZone` itself to brighten/dim the shopping cart, but that is display only.

---

## Task H.4 – Switch weapons by slot

Do (client):
- Keys **1–4** select the corresponding slot (ignored if the slot is empty). Mouse wheel: the next/previous slot that has a gun (wraps around).
- Key **Q**: quick-switch back to the slot held just before.
- While the shop menu is open (H.7), number keys are used to **buy**, not to switch guns; the wheel and Q still switch guns normally.
- Switching guns: 0.3s lower/raise animation (already exists from task 2.1), cancels reload, cancels scope.

Acceptance:
- [ ] Press 3 while there is no mid-range gun: nothing happens.
- [ ] The mouse wheel skips empty slots.
- [ ] Q toggles back and forth between the knife and the rifle.

---

## Task H.5 – Weapon icons (rendered from models with Blender)

Icons in a **flat white silhouette** style, transparent background, barrel pointing **left**, matching the white-outline HUD style.

Write `tools/blender/render_icon.py` (run the same way as `gun_tool.py`, see `tools-blend-to-glb.md`):
- Input: a **normalized** `.glb` file (barrel +Y, up +Z in Blender after import), output a 512×256 PNG.
- Import the glb into an empty scene. An **orthographic** camera placed on the **−X** side looking toward +X, up axis +Z (then +Y appears on the left of the screen → barrel points left). `ortho_scale` = the longest bbox edge × 1.1; centered on the bbox.
- Engine `BLENDER_WORKBENCH`: `shading.light = 'FLAT'`, `shading.color_type = 'SINGLE'`, `shading.single_color = (1, 1, 1)`, `render.film_transparent = True`, turn off outline/shadow/cavity. Result: a solid white silhouette.
- Output: `client/public/icons/weapons/<key>.png`.
- Guns without a model yet (knife, shotgun, smg, sniper): Claude Code **draws a simple placeholder SVG silhouette** at a 2:1 aspect ratio, saved as `<key>.svg`; the HUD prefers PNG and falls back to SVG.

Acceptance:
- [ ] The 4 icons AK47, M16, Colt, Rulo: white, transparent background, barrel pointing left, no clipped edges.
- [ ] The icons of the remaining guns have a placeholder SVG, and the gun type is recognizable.

---

## Task H.6 – Bottom-of-screen HUD

Layout (HTML/CSS over the canvas, everything 24px from the bottom):

```
                                                           
 $ 2000                                                     
 ♥ 100          [1 knife] [2 pistol] [3 mid] [4 rifle]        25 / 30
                                                         M16
```

- **Bottom left:**
  - Top line: `$ 2000` — bold white text 22px, the `$` symbol in green `#5fd16b`. When money changes: the number counts up/down to the new value over 400ms; flashes green on increase, red on decrease.
  - Bottom line: a **red heart icon** `#ff3b3b` (SVG, 28px) + health number in bold white 32px. Health < 30: the heart beats gently (scale 1 → 1.15, 0.9s per beat).
- **Bottom center, level with health and ammo:** 4 square weapon slots.
  - Each slot 72×72px, 10px apart, 10px rounded corners, 2px white border, background `rgba(0,0,0,0.35)`.
  - The slot number (1–4) at the **bottom-left inside the slot**, 12px bold, white.
  - Inside: the gun icon (H.5), `object-fit: contain`, 8px padding. If the icon is missing → show the gun name in small text.
  - **Empty slot: the whole slot is dimmed** (`opacity: 0.35`), no icon.
  - **Held slot:** 3px bright white border, background `rgba(255,255,255,0.15)`, raised 4px. Changing slots has a 120ms transition.
- **Bottom right:** ammo `25 / 30` (bold white 32px, turns orange when the remainder is ≤ 25% of the magazine), with the gun name in small text below. Knife: shows `—`.
- Use `pointer-events: none` for the entire HUD, **except** the shopping cart (H.7).
- All sizes use CSS variables on `:root` for easy tuning; scale down 15% when the window height is < 700px.

Acceptance:
- [ ] Switching guns lights up the right slot. Buying a mid-range gun: slot 3 goes from dimmed to showing an icon.
- [ ] Shot down to 25 health: the heart beats. Kill someone: money counts up and flashes green.
- [ ] Windows at 1280×720 and 1920×1080 both have no overlapping text.

---

## Task H.7 – Shopping cart and shop menu

### Shopping cart

- Position: **center of the left edge of the screen** (`left: 24px; top: 50%`).
- A white SVG shopping cart icon 36px, with the text `(B)` 14px to its right.
- In the buy zone: bright (`opacity: 1`) + a gently glowing border that pulses slowly. Outside the zone / while dead / during an ENDED match: dimmed (`opacity: 0.3`), the menu cannot be opened.
- Open/close: **B key** (toggle), or **click the cart** when the mouse is free (pointer not locked).

### Menu

- Slides out **from the left edge**, 340px wide, at most 70vh tall, `top: 15%`, background `rgba(10,12,16,0.88)`, 12px rounded right corners. Animation `transform: translateX(-100%) → 0` over 200ms. Pressing B again: slides back in.
- While open, if the player **leaves the buy zone** or dies: it slides in automatically.
- Menu header: the title `SHOP` and the current amount of money.
- The list, grouped by category (skip the knife):

```
────────────────────────────
Pistol
(1) [Colt icon]   Colt        $300
(2) [Rulo icon]   Rulo        $700
────────────────────────────
Mid-range
(3) [icon]        Shotgun    $1100
(4) [icon]        SMG        $1250
────────────────────────────
Rifle
(5) [icon]        AK47       $2700
(6) [icon]        M16        $3100
(7) [icon]        Sniper     $4750
────────────────────────────
Each category can carry only 1 gun. Buying in the same category
automatically sells your current gun for 80%.
```

- Each group: a **thin horizontal rule** (`1px rgba(255,255,255,0.25)`), right below it the **category name in small text** (11px, light gray, uppercase).
- Each gun row: `(i)` (key badge), 96×40 icon, name, price right-aligned. The index `i` is numbered continuously from 1 in display order.
- **Number key `i` buys gun number `i`** (while the menu is open). Clicking a row also buys (when the mouse is free).
- Row states (computed on the client with `quoteBuy`, for display only):
  - Owned: the text `Equipped` replaces the price, the row is slightly dimmed, cannot be bought.
  - Not enough money: price in red, row dimmed.
  - Buying will sell the old gun: an extra small line under the price, e.g. `sell SMG +$1000 · pay $100`. If the old gun is an issued gun (resale $0): write `Colt is issued, no resale`.
- Purchase success: the row flashes green, plays a "ka-ching" sound (synthesized: 2 triangle tones at 1320Hz then 1760Hz, 60ms apart, decay 150ms, −12dB). Failure: the row shakes horizontally for 150ms, a low "beep" sound (tone square 220Hz, 120ms, −16dB).
- The footer always shows the caption above, 12px gray text.
- An open menu **does not lock the mouse/movement**: you can still move and look, only the number keys are taken over for buying.

Acceptance:
- [ ] In the base, press B: the menu slides out; B again: slides back in.
- [ ] Press 4 (SMG) with $2000: the purchase works, slot 3 has the SMG, the menu stays open, $750 left, the SMG row becomes `Equipped`.
- [ ] Press 3 (Shotgun) right after: see `sell SMG +$1000 · pay $100`, after buying $650 is left.
- [ ] Walk out of the base while the menu is open: the menu closes itself, the cart dims, pressing B does not open it.
- [ ] Switch sides in the next match: the cart lights up at the new base.
- [ ] Press Esc to release the mouse, click the cart: the menu opens; click a gun row: the purchase works.

---

## Task H.8 – Bounty feedback

Do:
- MoneyEvent `kill`: the text `+$500` floats up next to the money amount and fades out (600ms).
- MoneyEvent `bounty`: a larger `+$1000` in gold, plus a line in the middle of the screen `WANTED! Took down [name] (streak 3)` for 1.5s; sound: kill sound + an extra "ka-ching".
- Killfeed: add a small `+$500` / `+$1000` at the end of the line **only on the lines for kills you made yourself**.
- **Wanted marker:** a player with `killStreak ≥ 3` shows a small flame/star icon above their head (visible to enemies as well), so everyone knows who is "worth" $1000.
- Scoreboard (Tab): add a money column **for teammates only** (opponents show `—`).

Acceptance:
- [ ] Kill 3 people in a row: the enemy side sees the wanted marker above your head.
- [ ] An enemy kills you at that point: they see the WANTED line and +$1000; the marker above your head disappears when you respawn.
- [ ] The scoreboard does not reveal the enemy team's money.
