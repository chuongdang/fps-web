# CLAUDE.md – Working rules for the FPS Web project

This file lives at the repo root. Claude Code reads it every session. **Follow it strictly.**

## Language
- **English is the project language.** Code comments, identifiers, test names, `plan/` docs, `plan/PROGRESS.md`, `CHANGELOG.md`, commit messages, console/log messages and your reports to the user are all written in English.
- The user may write to you in Vietnamese or English; reply in the language they used, but anything that is saved into the repo is English.
- **The game UI is bilingual (English + Vietnamese).** See "UI text and i18n" below.

## UI text and i18n
- Every string a player can see goes through `t('area.key', { params })` from `client/src/i18n`. Never hard-code player-facing text in logic or DOM code.
- Add the key to **both** `client/src/i18n/en/<area>.ts` and `client/src/i18n/vi/<area>.ts` (same key, same `{placeholders}`). English is the source of truth. `npm test` fails if a key is missing in one language, if placeholders differ, or if a `t('key')` literal has no dictionary entry.
- The language is chosen once at startup (saved choice > browser language > English); switching reloads the page (`i18n/selector.ts`). Build UI text when a screen is created; do not cache translated text across a language change.
- `shared/` and `server/` must not contain player-facing prose: send ids/codes/numbers and let the client translate. Developer-only tools (tuning panels, pose editor, debug overlays, console output) are English only and do not need i18n.
- Player-facing documents shipped in the package exist in both languages (`packaging/GUIDE.txt` English, `packaging/HUONG-DAN.txt` Vietnamese).

## Before coding
1. Read `plan/00-overview.md` and the phase file you were given (for example `plan/04-phase3-netcode-move.md`).
2. Read `plan/PROGRESS.md` to see which tasks are done.
3. If the request is ambiguous or contradicts the plan: **stop and ask**, do not guess.

## Finding where to change code
- When you need to find where to fix a bug or add a feature, **consult the graphify knowledge graph first** (`graphify-out/`), before grepping or opening files at random.
  1. Read `graphify-out/GRAPH_REPORT.md` for the god nodes, communities and overall structure.
  2. Use the graphify skill (`/graphify query "<question>"`, `path`, `explain`) to locate the relevant files, symbols and their relationships.
  3. Only then open the specific files it points to, and use Grep/Glob to confirm details.
- If `graphify-out/` is missing or looks stale (it does not mention files you know exist), say so and fall back to normal search; do not silently trust an outdated graph.

## Scope
- Do **exactly the task you were given**. Do not start later tasks, do not refactor unrelated code "while you're there".
- Do not rewrite a whole file when a few lines need changing.
- Do not change interfaces/data types in `shared/` unless the task requires it. If you think it is needed: stop, explain why, wait for approval.
- Do not add libraries that are not listed in `00-overview.md`. If one is needed, ask first.
- Do not delete existing debug code/overlays.

## Mandatory conventions
- Units: metres, seconds, radians. Y axis points up.
- yaw = 0 looks toward **-Z**. Increasing yaw = turning left. Positive pitch = looking up.
- `forward = (-sin(yaw), 0, -cos(yaw))`, `right = (cos(yaw), 0, -sin(yaw))`.
- All gameplay values (speed, damage, timings, ...) live in the config files of `shared/`, **never hard-coded** in logic.
- Code that runs on both client and server goes in `shared/`; no Three.js or DOM imports in `shared/`.
- Do not allocate new objects (`new Vector3`, temporary arrays) inside per-frame / per-tick loops; reuse scratch variables.

## Fixing bugs
1. State the **suspected cause** and **how you will verify it** (log, debug overlay, test) before changing anything.
2. Verify first, then fix. Fix **one cause at a time**.
3. If two fixes did not solve it: stop, summarise what you tried, propose a different direction. Do not keep patching in circles.
4. Never "fix" by nudging constants up and down until it seems to work.

## Verifying in the browser
- When you check the game by screenshot (headless Chrome, dev server), skip the "Click to play" overlay: hide it before taking the shot, so it does not dim the view or cover the middle of the screen. It is the full-screen `position:fixed; inset:0; z-index:10` div created in `client/src/input.ts` (text `hud.overlay.clickToPlay` / `tapToPlay`), e.g. `[...document.body.children].find(e => e.style.zIndex === '10' && e.style.inset === '0px')?.remove()`.

## After every task
1. Run `npm run typecheck` and `npm test`; both must pass.
2. Update `plan/PROGRESS.md` (tick the task, add a short note).
3. Report using this template:
   - **Done:** ...
   - **Files changed:** ...
   - **How to test by hand:** concrete steps the user can follow
   - **Unsure / needs the user's decision:** ...
