# FPS Web

A multiplayer browser FPS: two-team Elimination / Team Deathmatch, plus Zombie Infection and Zombie Defense modes, with bots, a weapon shop, grenades and a bilingual (English / Vietnamese) UI. It uses Three.js on the client and a Node WebSocket server with an authoritative simulation, client-side prediction and lag compensation.

## Requirements

- Node **24.22.0** (see `.nvmrc`; `nvm use` picks it up). CI uses the same version.
- npm (comes with Node).
- Chrome, Edge or Firefox (recent).

## Quick start

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. Pick a room in the lobby, or skip it to play **offline** against bots.

`npm run dev` starts two processes (see `dev.mjs`):

| Process | Command | Address |
|---|---|---|
| Game server (watch mode) | `npm -w server run dev` | `ws://localhost:8081` |
| Client (Vite dev server) | `npm -w client run dev` | `http://localhost:5173` |

The browser talks to the server through Vite's `/ws` proxy, so one address works on localhost, the LAN (Vite prints the `Network:` line) and ngrok. Friends on the same network can open the `Network:` address.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Server (watch) + Vite dev server with hot reload |
| `npm run build` | Production build of the client into `client/dist` |
| `npm run play` | Build, then run the server and the built client (`vite preview`) on ports `8082` / `4173`, so it can run next to `npm run dev` |
| `npm run typecheck` | `tsc --noEmit` for `shared`, `server` and `client` |
| `npm test` | Run all tests (Vitest) |
| `npm run bot-bench` | Measure the bot AI cost per tick |
| `npm run bundle-server` | Bundle the standalone server with esbuild |
| `npm run package` | Build the double-click package for the current OS (see [Packaging](#packaging)) |

Run a single test file with `npx vitest run path/to/file.test.ts`.

### Environment variables

| Variable | Used by | Default | Meaning |
|---|---|---|---|
| `FPS_PORT` | server, Vite proxy | `8081` | WebSocket server port |
| `FPS_WEB_PORT` | `npm run play` | `4173` | Port of the built client |
| `FPS_MATCH_MS`, `FPS_KILL_LIMIT`, `FPS_END_MS` | server | see `server/src` | Override match length, kill limit and end-of-match delay (handy for testing) |

## Project layout

```
fps-web/
  shared/    Code that runs on both client and server: movement, weapons, hitboxes,
             economy, zombies, protocol, map loading, Rapier physics world.
             No DOM or Three.js imports here.
  server/    Authoritative simulation: rooms, matches, lag compensation, bots (src/bots).
             main.ts = dev entry, standalone.ts = packaged entry (HTTP + WebSocket on one port).
  client/    Three.js rendering, input, prediction/interpolation, HUD, audio, i18n.
  assets/    Map JSON, credits, and source files for models/characters.
  packaging/ Files shipped inside the release zip (config.json, GUIDE.txt, HUONG-DAN.txt).
  scripts/   Bundling, packaging, credits and release-notes scripts.
  tools/     Blender helper scripts.
  plan/      Design docs and task list per feature; plan/PROGRESS.md tracks what is done.
```

`shared`, `server` and `client` are npm workspaces and import each other as `@fps/shared`.

## Developing

### Conventions

The rules in [CLAUDE.md](CLAUDE.md) apply to everyone, not only to Claude Code:

- Units are metres, seconds and radians; the Y axis points up.
- `yaw = 0` looks toward **-Z**; increasing yaw turns left; positive pitch looks up.
- Gameplay numbers (speed, damage, timings...) live in the config files under `shared/`, never in logic code.
- Code used by both sides goes in `shared/`.
- Do not allocate objects (`new Vector3`, temporary arrays) inside per-frame or per-tick loops; reuse scratch variables.
- Code, comments, tests, docs, commit messages and logs are in English.

### UI text and i18n

Every player-visible string goes through `t('area.key', { params })` from `client/src/i18n`. Add the key to **both** `client/src/i18n/en/<area>.ts` and `client/src/i18n/vi/<area>.ts` with the same `{placeholders}`. `npm test` fails if a key is missing in one language, if placeholders differ, or if a `t('key')` literal has no entry. `shared/` and `server/` must not contain player-facing prose; send ids or numbers and let the client translate. The language is chosen at startup (saved choice, then browser language, then English).

### Before you commit

```bash
npm run typecheck
npm test
```

Both must pass. Then tick the task in `plan/PROGRESS.md` and add a line to `CHANGELOG.md` for user-visible changes.

### Debug tools

Debug keys are enabled in `npm run dev`, and in a built client by adding `?debug` to the URL.

| Key | Tool |
|---|---|
| `F3` | Debug overlay (FPS, speed, position, spread...) |
| `F4` | Map wireframe and spawn arrows |
| `F6` | Movement tuning panel (sliders, Copy JSON) |
| `F8` | Gun audio tuning panel |
| `F9` / `F10` | Pose editor / orbit camera |

Useful URL parameters: `?room=<name>` joins a room directly, `?loadout=<weapon ids>` sets the offline loadout, `?dummies` adds target dummies offline.

Bot behaviour is tuned in `server/src/bots/bots.json`. Editing it while you play offline is applied live without a page reload.

### Maps and assets

- Maps are JSON files in `assets/maps/` (minimap images are in `client/public/maps/`). The format and loader are in `shared/src/map`.
- To add a map: put `<id>.json` in `assets/maps/`, add one import and one entry to `assets/maps/index.ts` (the registry the client, the offline worker and the server all read), and add the lobby preview `client/public/maps/<id>.png`. `server/src/maps.test.ts` fails if any of these is missing. Night street lamps are listed per map name in `client/src/render/night.ts`. A map that is not left/right symmetric sets `"mirrorX": false` and lists both teams' `spawnsA`/`spawnsB` and `buyZoneA`/`buyZoneB` (see `assets/maps/dust2.json`, generated by `assets/source/maps/dust2.mjs`).
- Models and sounds are in `client/public/`.
- Convert Blender files to `.glb` as described in `plan/tools-blend-to-glb.md`.
- Third-party assets are listed in `assets/CREDITS.json`; the packaging step checks that it is complete.

## Controls

| Input | Action |
|---|---|
| `W` `A` `S` `D` | Move |
| Mouse | Look |
| Left / right mouse | Fire / aim down sights |
| `Space` | Jump (hold while landing to bunny hop) |
| `C` or `Ctrl` | Crouch; crouching while running slides |
| `R` | Reload |
| `T` | Quick grenade (hold, release to throw) |
| `G` | Drop the held gun (Team Deathmatch and Elimination) |
| `E` | Pick up the nearest dropped gun; a gun in the same slot is swapped out |
| Number keys | Select weapon slot |
| `B` | Shop |
| `` ` `` (backquote) | Switch team |

## Packaging

`npm run package` builds a self-contained zip for the OS you run it on, using a Node Single Executable Application, so the recipient does not need Node:

```
release/FPSWeb-<os>-<arch>.zip
  FPSWeb(.exe)   double-click to start the server and open the browser
  game/          the built client
  config.json    { "port": 8080, "openBrowser": true, "maxRooms": 20 }
  GUIDE.txt, HUONG-DAN.txt, CREDITS.txt
```

One port serves both the game page and the WebSocket. If the port is busy, the next free one (up to +10) is used. The server prints the address friends on the same network should open. Command-line flags `--port 9000` and `--no-open` override `config.json`.

### Docker (behind nginx)

`docker compose up --build` builds the server image ([Dockerfile](Dockerfile)) and starts it behind an nginx reverse proxy ([docker/nginx.conf](docker/nginx.conf)). Open http://localhost:8000 (change the port with `FPS_PROXY_PORT`). Only nginx is published; the game container listens on `8080` inside the compose network. nginx forwards the `/ws` WebSocket (`Upgrade` headers, 1 hour read timeout). For a real deployment add TLS to the nginx `server` block; the client switches to `wss` by itself on https. The game must be served at the root of a host (it connects to `/ws`, so a sub-path such as `/fps/` is not supported).

### Releasing

1. Bump `version` in the root `package.json` and add a section to `CHANGELOG.md`.
2. Push a tag such as `v1.3.0`, or run the **Release** GitHub workflow manually and enter the tag.
3. The workflow builds Windows x64, macOS arm64 and macOS x64 zips and attaches them to a GitHub Release.

The server rejects clients built from a different version, so players must all use the same release.

## More documentation

- [plan/00-overview.md](plan/00-overview.md): goals, stack, constants, the first map.
- [plan/PROGRESS.md](plan/PROGRESS.md): task-by-task status.
- [plan/18-packaging.md](plan/18-packaging.md): packaging design.
- [CHANGELOG.md](CHANGELOG.md): release notes.
