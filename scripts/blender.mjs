// Runs tools/blender/asset_tool.py in headless Blender, finding Blender for you (so `blender` does not have to be on PATH).
// Usage:  node scripts/blender.mjs <mode> [args...]     e.g.  node scripts/blender.mjs build-scene in.gltf client/public/maps/x.glb --scale=1.875 --ground
// Blender is looked for in: env BLENDER, `blender` on PATH, the macOS app, Program Files (Windows), /usr/bin and /snap (Linux).
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function findBlender() {
  if (process.env.BLENDER) return process.env.BLENDER
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['blender'], { encoding: 'utf8' })
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim().split(/\r?\n/)[0]
  const fixed = ['/Applications/Blender.app/Contents/MacOS/Blender', '/usr/bin/blender', '/snap/bin/blender']
  const pf = process.env.ProgramFiles
  if (pf && existsSync(join(pf, 'Blender Foundation'))) {
    for (const d of readdirSync(join(pf, 'Blender Foundation')).sort().reverse()) fixed.push(join(pf, 'Blender Foundation', d, 'blender.exe'))
  }
  return fixed.find(existsSync) ?? null
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const blender = findBlender()
  if (!blender) { console.error('Blender not found. Install it or set BLENDER=/path/to/blender'); process.exit(1) }
  const r = spawnSync(blender, ['-b', '--python', join(root, 'tools', 'blender', 'asset_tool.py'), '--', ...process.argv.slice(2)], { stdio: 'inherit', cwd: root })
  process.exit(r.status ?? 1)
}
