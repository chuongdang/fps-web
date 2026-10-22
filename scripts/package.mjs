// "Double-click to run" packaging for the platform running the script (K.3): npm run package
// → release/FPSWeb-<os>-<arch>.zip (Node Single Executable Application)
//
// Environment variables (used by CI for cross builds, e.g. the Intel Mac build on an Apple Silicon runner):
//   FPS_NODE_BINARY  `node` binary used as the shell (must be the SAME Node version running this script)
//   FPS_TARGET       release target name, e.g. macos-x64 (required when FPS_NODE_BINARY is set)
import { spawnSync, spawn } from 'node:child_process'
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkCredits, creditsText } from './credits.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const win = process.platform === 'win32'
const mac = process.platform === 'darwin'
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const nodeBinary = process.env.FPS_NODE_BINARY ? resolve(process.env.FPS_NODE_BINARY) : process.execPath
if (process.env.FPS_NODE_BINARY && !process.env.FPS_TARGET) fail('When FPS_NODE_BINARY is set, FPS_TARGET must be set too (e.g. macos-x64).')
const target = process.env.FPS_TARGET ?? `${win ? 'windows' : mac ? 'macos' : process.platform}-${process.arch}`
const targetIsWin = target.startsWith('windows')
const targetIsMac = target.startsWith('macos')

const exeName = targetIsWin ? 'FPSWeb.exe' : 'FPSWeb'
const outDir = join(root, 'release', 'FPSWeb')
const exe = join(outDir, exeName)
const zipName = `FPSWeb-${target}.zip`
const SENTINEL = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'

function fail(msg) {
  console.error('\nPackaging ERROR: ' + msg)
  process.exit(1)
}

function run(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`)
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: win && cmd === 'npm', ...opts })
  if (r.status !== 0) fail(`command failed (code ${r.status}): ${cmd} ${args.join(' ')}`)
}

function step(n, text) { console.log(`\n[${n}] ${text}`) }

// ── Checks before spending time on the build ────────────────────────────────────
const nodeVer = spawnSync(nodeBinary, ['--version'], { encoding: 'utf8' }).stdout?.trim()
if (nodeVer !== process.version) fail(`the node binary used as the shell is ${nodeVer}, different from the one running this script (${process.version}). The SEA blob must be created and injected with the same Node version.`)
try {
  const want = readFileSync(join(root, '.nvmrc'), 'utf8').trim().replace(/^v/, '')
  if (process.version.replace(/^v/, '') !== want) console.warn(`Warning: .nvmrc says Node ${want} but ${process.version} is running.`)
} catch { /* no .nvmrc */ }

step('K.6', 'Check asset credits')
const credits = checkCredits(root)
if (credits.missing.length) fail('assets in client/public not declared in assets/CREDITS.json:\n  - ' + credits.missing.join('\n  - '))
if (credits.stale.length) console.warn('Warning: CREDITS.json lists files no longer in client/public:\n  - ' + credits.stale.join('\n  - '))
if (credits.unverified.length) console.warn(`Warning: ${credits.unverified.length} assets have unverified author/license (see assets/CREDITS.json). Check them before releasing to outside users.`)

step(1, 'Build client')
run('npm', ['run', 'build', '-w', 'client'])
step(2, 'Bundle the server into build/server.cjs')
run(process.execPath, ['scripts/bundle-server.mjs'])

step(3, 'Write build/sea-config.json')
const blob = join(root, 'build', 'sea-prep.blob')
writeFileSync(join(root, 'build', 'sea-config.json'), JSON.stringify({
  main: 'build/server.cjs',
  output: 'build/sea-prep.blob',
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
}, null, 2))

step(4, 'Create the SEA blob')
run(process.execPath, ['--experimental-sea-config', 'build/sea-config.json'])

step(5, `Copy node → ${exeName}`)
rmSync(join(root, 'release'), { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
copyFileSync(nodeBinary, exe)
chmodSync(exe, 0o755)

if (targetIsMac) { step(6, 'Remove the original node signature (Mac)'); run('codesign', ['--remove-signature', exe]) }

step(7, 'Inject the blob with postject')
const postject = join(root, 'node_modules', 'postject', 'dist', 'cli.js')
if (!existsSync(postject)) fail('node_modules/postject is missing, run npm ci first.')
run(process.execPath, [postject, exe, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', SENTINEL, ...(targetIsMac ? ['--macho-segment-name', 'NODE_SEA'] : [])])

if (targetIsMac) { step(8, 'Ad-hoc sign (required on Apple Silicon Macs)'); run('codesign', ['--sign', '-', exe]) }

step(9, 'Copy game/, config.json, GUIDE.txt, HUONG-DAN.txt, CREDITS.txt')
cpSync(join(root, 'client', 'dist'), join(outDir, 'game'), { recursive: true })
rmSync(join(outDir, 'game', 'sounds', 'local'), { recursive: true, force: true })   // personal sounds (gitignored) must not leak into the release
copyFileSync(join(root, 'packaging', 'config.json'), join(outDir, 'config.json'))
const eol = text => (targetIsWin ? text.replace(/\r?\n/g, '\r\n') : text)
// Player guide in both languages: GUIDE.txt (English) and HUONG-DAN.txt (Vietnamese)
for (const guide of ['GUIDE.txt', 'HUONG-DAN.txt']) {
  writeFileSync(join(outDir, guide), eol(readFileSync(join(root, 'packaging', guide), 'utf8').replaceAll('{version}', version)))
}
writeFileSync(join(outDir, 'CREDITS.txt'), eol(creditsText(credits.entries, version)))

// Smoke-run the freshly built binary (from another directory) before zipping: catches SEA/signing problems early
step('✔', 'Smoke-run the packaged binary')
// The standalone server prints this once it is listening
const RUNNING = /is running/i
await new Promise(res => {
  const child = spawn(exe, ['--no-open', '--port', '18080'], { cwd: join(root, 'release'), stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  const timer = setTimeout(() => { child.kill(); fail('binary did not report "running" within 30 seconds:\n' + out) }, 30_000)
  const onData = d => {
    out += d
    if (RUNNING.test(out)) { clearTimeout(timer); child.kill(); res() }
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  child.on('exit', code => { if (!RUNNING.test(out)) { clearTimeout(timer); fail(`binary exited early (code ${code}):\n${out}`) } })
})

step(10, `Zip ${zipName}`)
const zip = join(root, 'release', zipName)
if (mac) run('ditto', ['-c', '-k', '--keepParent', 'FPSWeb', zipName], { cwd: join(root, 'release') })
else if (win) run('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path 'FPSWeb' -DestinationPath '${zipName}' -Force`], { cwd: join(root, 'release'), shell: false })
else run('zip', ['-r', '-y', '-q', zipName, 'FPSWeb'], { cwd: join(root, 'release') })
console.log(`\nDone: ${zip}`)
