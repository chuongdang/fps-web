# 18 – "Double-click to run" packaging for Windows and Mac (Node Single Executable)

Goal: the recipient **does not need to install Node**; they just download a zip file, extract it, and **double-click one file** to:
1. Run the game server (serving both the game page and the WebSocket on **one port**).
2. Have the browser open into the game automatically.
3. Show a console window with the address for friends on the LAN to join.

Release output: 3 zip files
- `FPSWeb-windows-x64.zip`
- `FPSWeb-macos-arm64.zip` (Macs with M1/M2/M3/M4 chips)
- `FPSWeb-macos-x64.zip` (Intel Macs)

Each zip contains:
```
FPSWeb/
  FPSWeb.exe        (Windows)  |  FPSWeb  (Mac)
  game/             the built game page (index.html, assets/, models/, sounds/, icons/, maps/)
  config.json       port, auto-open browser... (the recipient can edit it)
  HUONG-DAN.txt
  CREDITS.txt
```

Technology: **Node Single Executable Applications (SEA)**, built into Node, bundling a JS file + Node itself into one runnable file.

Order: K.1 → K.2 → K.3 → K.4 → K.5 → K.6 → K.7. Tasks marked ⚠️ should use a strong model.

---

## Task K.1 – Standalone server mode (one port for everything) ⚠️

Create a new entry `server/src/standalone.ts` (keep `main.ts` as is for dev):

- **HTTP server** (`node:http`, no extra libraries) serving static files from the `game/` folder:
  - Root folder: `path.join(path.dirname(process.execPath), 'game')` when running as SEA; when test-running with `tsx` use `client/dist`. Detect SEA mode with `require('node:sea').isSea()`.
  - Correct MIME for: `.html .js .mjs .css .json .wasm (application/wasm) .glb (model/gltf-binary) .gltf .png .jpg .webp .svg .ogg (audio/ogg) .mp3 .ico .woff2`.
  - Cache: `/assets/` → `public, max-age=31536000, immutable`; `/models/ /sounds/ /icons/ /maps/` → `public, max-age=604800`; `index.html` → `no-cache`.
  - A path that does not exist and has no file extension → return `index.html` (SPA).
  - **Block directory traversal**: normalize the path, reject any path outside the `game/` folder (`..`, absolute paths, odd characters).
  - `Range` support for large files is not required; `ETag` or `Last-Modified` + returning `304` is enough.
- **WebSocket** shares the HTTP server: `new WebSocketServer({ noServer: true })`, handle the `upgrade` event when `url` starts with `/ws`. The room/game logic reuses the existing code as is.
- **Port**: read `config.json` (default `8080`). If occupied (`EADDRINUSE`), try successively up to `+10`. Listen on `0.0.0.0` (so other machines on the LAN can join).
- **Print to the console** (in English, clear):
  ```
  ==============================================
   FPS Web v1.3.0 is running
   You play at:       http://localhost:8080
   Friends on the same network: http://192.168.1.23:8080
                                http://10.35.112.150:8080
   Close this window to stop the server.
  ==============================================
  ```
  List every non-`internal` IPv4 address, skipping `169.254.x.x`. Include the network adapter name if there are multiple addresses.
- **Auto-open the browser** (`config.openBrowser`, default `true`): Windows `cmd /c start "" <url>`, Mac `open <url>`. On error, ignore it, do not crash.
- **Command-line arguments** (override config): `--port 9000`, `--no-open`.
- **Fatal errors** (cannot open any port, missing `game/` folder): print an easy-to-understand English message, then **wait for the user to press Enter before exiting**, so the console window does not disappear before they can read it.
- `Ctrl+C` / closing the window: close all connections and exit cleanly.
- Default `config.json`:
  ```json
  { "port": 8080, "openBrowser": true, "maxRooms": 20 }
  ```

Acceptance:
- [ ] `npm run build -w client` then `tsx server/src/standalone.ts`: opening `http://localhost:8080` is playable, including offline/bots, buying, and grenades.
- [ ] Another machine on the LAN can join at `http://<IP>:8080` and play together.
- [ ] Running 2 copies at once: the second copy automatically uses port 8081 and prints the correct port.
- [ ] `curl http://localhost:8080/../../etc/passwd` and encoded variants (`%2e%2e`) are all rejected.
- [ ] `curl -I` on a `.glb` file returns the correct `Content-Type` and `Cache-Control`.

---

## Task K.2 – Bundle the server into one JS file (esbuild)

- Add `esbuild` (devDependency, pinned version).
- Script `scripts/bundle-server.mjs`:
  ```
  entry:    server/src/standalone.ts
  bundle:   true
  platform: node
  format:   cjs              // SEA needs a single CommonJS file
  target:   node24           // matches the Node version used for packaging
  outfile:  build/server.cjs
  external: ['bufferutil', 'utf-8-validate']   // optional packages of ws; ws skips them on its own if missing
  define:   { 'process.env.APP_VERSION': JSON.stringify(version in package.json) }
  ```
- `build/server.cjs` has no remaining `require` of any outside package (except the 2 external packages above): in SEA, `require` can only load Node's built-in modules.
- The `-compat` build of Rapier (WASM embedded as base64) works inside the bundled file; re-check this.

Acceptance:
- [ ] `node build/server.cjs` (with no `node_modules` next to it: copy the file to an empty folder to test) runs the game just like K.1.

---

## Task K.3 – SEA packaging for the current platform ⚠️

Script `scripts/package.mjs` (run with `npm run package`), operating on the **platform running the script**:

1. `npm run build -w client` → `client/dist`.
2. `node scripts/bundle-server.mjs` → `build/server.cjs`.
3. Write `build/sea-config.json`:
   ```json
   {
     "main": "build/server.cjs",
     "output": "build/sea-prep.blob",
     "disableExperimentalSEAWarning": true,
     "useSnapshot": false,
     "useCodeCache": false
   }
   ```
4. `node --experimental-sea-config build/sea-config.json` → creates the blob.
5. Copy the running `node` file itself (`process.execPath`) to `release/FPSWeb/FPSWeb` (Mac) or `FPSWeb.exe` (Windows).
6. **Mac**: `codesign --remove-signature release/FPSWeb/FPSWeb`.
7. Inject the blob with `postject` (devDependency):
   - Windows: `npx postject FPSWeb.exe NODE_SEA_BLOB build/sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`
   - Mac: same as above, adding `--macho-segment-name NODE_SEA`
8. **Mac**: ad-hoc sign with `codesign --sign - release/FPSWeb/FPSWeb` (mandatory on M-chip Macs; without a signature the operating system will not let it run).
9. Copy `client/dist` → `release/FPSWeb/game/`, write the default `config.json`, `HUONG-DAN.txt` (K.5), `CREDITS.txt` (K.6).
10. Compress into `release/FPSWeb-<os>-<arch>.zip`:
    - Mac: use `ditto -c -k --keepParent` or `zip -r -y` to **preserve the executable permission** of the `FPSWeb` file.
    - Windows: `Compress-Archive` or a compression library in Node.

Important notes:
- The **Node version** used for packaging must be the same at step 4 and step 5 (the same `node` file). Record the fixed Node version in `.nvmrc` and in the K.4 workflow.
- Cross-check the steps against the **"Single executable applications" documentation of the exact Node version in use**; if the documentation has a newer, cleaner way (for example creating the executable directly without `postject`), you may use it but must note it in the report.
- Windows: the original `node.exe` has a Node digital signature; injecting the blob makes that signature invalid. That is fine, it only makes SmartScreen show a warning (the recipient clicks "Run anyway", see K.5).

Acceptance:
- [ ] On Mac: `npm run package` creates `release/FPSWeb-macos-arm64.zip`. Extract it in another folder and double-click `FPSWeb`: Terminal opens, the server runs, and the browser opens the game automatically.
- [ ] Try it on a machine **without Node installed** (or remove Node from PATH to simulate): it still runs.

---

## Task K.4 – Build all 3 versions with GitHub Actions

`.github/workflows/release.yml`:
- Trigger: pushing a `v*` tag (for example `v1.3.0`) or a manual run (`workflow_dispatch`).
- A matrix of 3 jobs:

  | Build | Runner |
  |---|---|
  | windows-x64 | `windows-latest` |
  | macos-arm64 | `macos-latest` (M-chip machine) |
  | macos-x64 | an **Intel** runner still supported by GitHub at the time of the work (check the "GitHub-hosted runners" page for the latest Intel label). If no Intel runner remains: build on the M-chip runner but **download the darwin-x64 build of the `node` file** of the same version from nodejs.org for step 5 (the blob uses no snapshot/code cache so it can be shared), then try running on a real Intel Mac before release. |

- Each job: `actions/setup-node` with the **exact version in `.nvmrc`** → `npm ci` → `npm run package` → upload the zip file as an artifact.
- The final job (when run by tag): create a **GitHub Release**, attach the 3 zip files, with the release notes taken from `CHANGELOG.md` (the entry for that version).
- The repo may stay private; a Release on a private repo can only be downloaded by people with access → send the zip files directly to recipients.

Acceptance:
- [ ] Push a test tag `v0.0.1-test`: once finished, all 3 zip files are in the Release/artifacts.
- [ ] Download the Windows build to a Windows machine without Node installed: it runs.

Pitfalls:
- Large assets (models, sounds) make the repo heavy: if the total exceeds 1GB consider Git LFS; remember to enable LFS in the checkout step (`lfs: true`).
- Do not commit the `release/` and `build/` folders (add them to `.gitignore`).

---

## Task K.5 – Instructions for the recipient (`HUONG-DAN.txt`)

Content (write exactly as below, replacing `{version}` at packaging time):

```
FPS WEB {version} – GUIDE TO RUNNING YOUR OWN SERVER

1) Extract the zip file into a folder (for example the Desktop). Do not run it directly from inside the zip file.

2) WINDOWS
   - Double-click FPSWeb.exe.
   - If a "Windows protected your PC" screen appears: click "More info" → "Run anyway".
   - If the Firewall asks for permission: tick "Private networks" → click "Allow access".
     (If you do not allow it, friends on your network will not be able to join.)

3) MAC
   - Double-click the FPSWeb file.
   - If it says it cannot be opened because the developer cannot be verified:
     open System Settings → Privacy & Security → scroll down, click "Open Anyway" next to the FPSWeb line,
     then double-click FPSWeb again and choose "Open".
   - If the Mac asks to allow incoming network connections: choose "Allow".

4) A black window (Terminal/Console) appears and the browser opens the game automatically.
   - Friends on the same wifi/LAN: open a browser and type the "Friends on the same network" address shown in the black window.
   - Use a recent version of Chrome, Edge, or Firefox.

5) To stop the server: close the black window.

6) To change the port: open config.json with Notepad/TextEdit, edit "port", save, and run again.

If you hit an error: take a screenshot of the black window and send it to the person who sent you the game.
```

- Also include 2 illustrative screenshots (SmartScreen, Privacy & Security) in the `docs/` folder if available; if not, the text file alone is enough.

---

## Task K.6 – Credits (`CREDITS.txt`) and license check

- Create `assets/CREDITS.json` listing **every** third-party asset: `{ file, author, source, license, url }`.
- The packaging script generates `CREDITS.txt` from this file, and **stops packaging** if there is an asset in `client/public` that is not in `CREDITS.json` (to avoid forgetting to credit a source).
- In the game: the main menu has a **"Credits"** entry that shows the same content.
- **The user checks this themselves** (Claude Code does not decide): whether the license of each model/sound allows **redistribution**. Especially character models taken from community libraries. CC-BY files must credit the author; files that only allow personal use **must not** go into the release.

Acceptance:
- [ ] Add a new sound file without declaring it: `npm run package` reports an error naming the file.

---

## Task K.7 – Version and in-game info

- The version comes from the root `package.json`, shown at the bottom corner of the main menu and in the server console.
- Client and server on different versions (the user opened a stale old tab): the server refuses the connection, and the client shows "Game version mismatch, reload the page (Ctrl+F5)".
- `CHANGELOG.md`: add a short entry in English with each release.

---

## Notes for the user

- Each build is about 40–60MB compressed (Node alone takes most of that), plus the game's asset size.
- Some antivirus software occasionally flags a self-packaged unsigned executable by mistake. If a recipient runs into this, they can add it to the trusted list; to remove the warning entirely you must buy a code-signing certificate (Windows) and an Apple Developer account (Mac) to sign/notarize — do it later only if truly needed.
- For a Linux build: add an `ubuntu-latest` job to K.4, with steps like Windows (no signing needed).
