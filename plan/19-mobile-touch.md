# 19 – Touch controls for phones and tablets (iOS Safari, Android Chrome)

Status: **approved, all tasks coded** (M.1–M.6 done; real-phone and two-device checks still open, see PROGRESS.md). Decisions so far: **fire = a dedicated Fire button, held to shoot (changed from "tap anywhere" on 2026-10-22)**, aim = a toggle button (decided in M.3; switching to hold-to-aim is a one-word change of `mode` in `touch/buttons.ts`), all game modes on mobile, Android covered by the detection rule, builds are tried on the deployed site.

## Why

"Click to play" does nothing on iOS Safari. Cause (verified in `client/src/input.ts`):
- The game starts only when `pointerlockchange` fires after `canvas.requestPointerLock()`. iOS Safari (iPhone and iPad) has no Pointer Lock API, so the click throws and the game never starts.
- Even if the lock were skipped, the whole input layer is keyboard + mouse. There is no touch code in `client/src`. Android Chrome has Pointer Lock but no mouse, so it would start "locked" and still be unplayable.

Goal: the whole game (lobby, all modes, offline mode, buy menu, spectating) is playable on a phone held in **landscape**, with the same network protocol and the same server. Desktop behaviour must not change.

Out of scope: gyro aiming, gamepads, portrait layout, a layout editor for the buttons, performance work beyond a pixel-ratio cap (see M.6).

## What the survey found (so the plan stays small)

- All gameplay input goes through `client/src/input.ts` (`sampleButtons()`, `yaw`/`pitch`, `isLocked()`, `consumeWheel()`, `requestCycleNade()`), read by `loop.ts` and `main.ts`. A second input source that feeds the same functions needs **no change in `shared/` or `server/`**.
- The wire format has **digital** move buttons (`Btn.Forward/Back/Left/Right`). A joystick therefore maps to 8 directions at full speed; there is no analog walking speed. Adding it would be a `shared/` protocol change, which this plan does **not** do (CLAUDE.md: ask first).
- Weapon switching, last-weapon and the buy menu are plain functions in `main.ts` (`pressNumberKey`, `pressLastWeapon`, `requestSlot`, `cycleSlot`, `shop.toggle`); only their key bindings are desktop-specific.
- Already touch-friendly (DOM buttons): the cart/buy menu items (`shop.ts`), scoreboard and switch-team buttons (`hudButtons.ts`), the leave button, the whole lobby.
- Desktop-only today: spectating uses `mousedown`/Space (`main.ts` ~356), Tab = scoreboard, number keys, Q, B, F (flashlight), E (ability), Q (sniff, zombie mode), G, C/Ctrl, R, right mouse = aim.
- The audio context starts on `click`/`keydown` (`audio/context.ts`); on iOS it must also be unlocked from a touch event.

## Design (decisions I propose; the open ones are listed at the end)

**Touch mode** = `typeof canvas.requestPointerLock !== 'function'` **or** `!matchMedia('(any-pointer: fine)').matches`. A laptop with a touchscreen keeps desktop mode. `?touch=1` forces it, so it can be tried on a desktop with Chrome's device emulation.

**Layout (landscape):**
- Left thumb: virtual joystick (floating, appears where the thumb lands in the left 40% of the screen) → Forward/Back/Left/Right.
- Right side: dragging anywhere that is not a button looks around (yaw/pitch, own sensitivity setting, saved in `localStorage` like `fps_sens`).
- Right thumb buttons: large **Fire** (hold), **Aim** (toggle, because holding aim + fire + look needs three fingers), **Jump**, **Crouch** (toggle), **Reload**.
- Small buttons: grenade quick-throw (G), flashlight (F, only when allowed), ability (E) and sniff (Q) only in the zombie modes where they exist.
- Weapon bar: the existing 4-slot bar in `hudBottom.ts` becomes tappable (slot 1·2·3·4, tapping the held grenade slot again switches HE ↔ smoke, same as key 4); a "last weapon" button replaces Q.
- Existing buttons stay: buy (cart), scoreboard, switch team, leave. Spectating: tap = next player (replaces click/Space).
- Multi-touch is tracked per pointer id (Pointer Events), so joystick + look + fire work at the same time. `touch-action: none`, `overscroll-behavior: none`, no text selection, no long-press menu, no double-tap zoom.

**Start flow:** the overlay says "Tap to play" in touch mode. The tap marks the touch controls active (the equivalent of `_setLocked(true)`), asks for fullscreen where the browser allows it (iPad yes, iPhone Safari no), and tries `screen.orientation.lock('landscape')` (Android). If the device is in portrait, show a "Rotate your device" message instead of the game controls.

**Structure:** the logic that is worth testing is pure and lives in a new `client/src/touch/` folder: `joystick.ts` (vector → `Btn` bits), `look.ts` (pixel delta → yaw/pitch with sensitivity and the ADS `_sensScale`), `layout.ts` (button rectangles from the screen size + safe-area insets). The DOM wiring is a thin `touchControls.ts`. `input.ts` gets a small hook so touch can add to `_keys`/`_mouse*`/`yaw`/`pitch` and report itself as "locked"; the desktop code path is untouched.

## Tasks (one session each; test by hand between them)

| # | Task | Done when |
|---|---|---|
| M.1 | **Detection + start flow.** Touch-mode detection, "Tap to play" overlay, orientation/rotate message, audio unlock from a touch event, i18n keys (en + vi). | On an iPhone the overlay is dismissed by a tap and the lobby → game transition works; desktop unchanged. |
| M.2 | **Look + move + Fire button.** Pointer-event look drag, floating joystick, a held Fire button, pure modules + unit tests (joystick directions incl. deadzone, look scaling with ADS). **Done 2026-10-22.** | You can walk, look around and shoot in offline mode on a phone. |
| M.3 | **Action buttons.** (Fire is already done in M.2.) Aim/jump/crouch/reload/grenade/flashlight/ability/sniff, button layout with safe-area insets, press/release feedback. **Done 2026-10-22** (aim = toggle button, my proposal: the decision was postponed to here and not overruled). | You can kill a bot on a phone. |
| M.4 | **Weapons, buy menu, spectate, scoreboard.** Tappable weapon bar + last-weapon, buy menu sized for fingers, tap-to-spectate, key hints hidden in touch mode. | A full offline match, including buying, is playable. |
| M.5 | **Lobby and HUD on small screens.** Lobby/room list/forms, confirm prompts, text sizes, notch safe areas, no page scroll/zoom/pull-to-refresh. | Create/join a room and finish an online match from two devices. |
| M.6 | **Mobile performance + install.** Cap `devicePixelRatio` for the renderer (a setting), check frame rate on a real phone; optional "Add to Home Screen" support (`apple-mobile-web-app-capable` meta + web manifest) because iPhone Safari has no fullscreen API. | Stable frame rate on the target phone; fullscreen via home screen icon. |
| M.7 | **Touch polish** (2026-10-23, after comparing with PUBG Mobile). Drag on the held Fire button also looks; SVG icons instead of Unicode glyphs; readable on/idle button colours; secondary buttons on an outer arc (grenade first); button size / opacity / left-handed settings (lobby "Controls"). | You can aim and shoot with one thumb; icons look the same on iOS and Android; a left-handed layout is mirrored including the HUD. |

Tests: `npm test` covers the pure modules and i18n parity automatically. **Nothing here can be fully verified without a real phone**; each task ends with a hand-test checklist for you, and I will say plainly what I could not check.

## Risks

- Feel (joystick size, look sensitivity, button sizes) is a first guess and needs tuning on your phone; expect a round or two.
- Digital movement only (8 directions). Fine for a first version; analog needs a `shared/` change.
- Hit testing for aim assist, recoil and ADS were tuned for a mouse; touch aiming will feel coarser. No aim assist is planned.
- iPhone Safari cannot go fullscreen without the home-screen install, so the browser UI eats screen space until M.6.
- Bundle is ~3 MB and the renderer uses shadows; the phone's GPU may need lower defaults (M.6).

## Open questions

Answered 2026-10-22: **2** fire on tap (later changed to a Fire button), **3** all modes; **1** (aim) postponed to M.3; **4** (Android) and **5** (testing) assumed as above unless corrected. Original list:

1. **Aim:** toggle (proposed) or hold-to-aim button?
2. **Fire:** one big Fire button on the right (proposed), or also fire-on-tap anywhere?
3. **Modes:** all modes on mobile (proposed), or offline + deathmatch first?
4. **Android:** included by the detection rule above (proposed); do you also want it tested/tuned, or iOS only?
5. **Real-device testing:** which phone, and how do you want to try builds (the deployed site, or the dev server over your LAN)?
