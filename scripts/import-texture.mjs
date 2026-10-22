// One command to bring in a map texture (the images the box / ramp maps tile): converts it, registers it and credits it.
//   node scripts/import-texture.mjs <image> --name sand_1 --author "Name" --license "CC0" [--url https://...] [--class sand] [--tile 2]
//        [--max-px 1024] [--quality 88] [--own] [--dry-run]
// What it does:
//   1. Blender (tools/blender/asset_tool.py build-texture): power-of-two JPEG, at most --max-px, into client/public/textures/<name>.jpg; reports the tiling seam
//   2. copies the original into assets/source/texture/ (the source of truth, like the others)
//   3. shared/src/map/materials.ts: adds <name> to TEXTURE_CLASSES - a new class called --class (default: the name) or another image in an existing class
//   4. assets/CREDITS.json: the credit line (--own = original work of this project; otherwise --author and --license are required, see assets/source/.../license.txt)
// Then a map box uses it with  "texture": "<class>"  (or the file name), optionally "color": "#rrggbb".
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findBlender } from './blender.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MATERIALS = join(root, 'shared', 'src', 'map', 'materials.ts')
const CREDITS = join(root, 'assets', 'CREDITS.json')
const NAME_RE = /^[a-z][a-z0-9_]*$/

/** materials.ts text with `file` added to TEXTURE_CLASSES: appended to class `cls` if it exists, else a new class line `cls: { files: [file], tileM }` */
export function addToTextureClasses(source, { cls, file, tileM }) {
  const start = source.indexOf('export const TEXTURE_CLASSES')
  if (start < 0) throw new Error('TEXTURE_CLASSES not found in materials.ts')
  const open = source.indexOf('{', source.indexOf('=', start))
  const close = source.indexOf('\n}', open)
  const body = source.slice(open, close)
  if (new RegExp(`^\\s*${file}\\s*:`, 'm').test(body)) throw new Error(`"${file}" is already a class name: a box's "texture" would be ambiguous, pick another --name`)
  const existing = new RegExp(`^(\\s*${cls}:\\s*\\{\\s*files:\\s*\\[)([^\\]]*)(\\])`, 'm').exec(body)
  if (existing) {
    const files = existing[2].split(',').map(f => f.trim().replace(/^'|'$/g, '')).filter(Boolean)
    if (files.includes(file)) throw new Error(`class "${cls}" already has the image "${file}"`)
    const updated = body.replace(existing[0], `${existing[1]}${[...files, file].map(f => `'${f}'`).join(', ')}${existing[3]}`)
    return source.slice(0, open) + updated + source.slice(close)
  }
  return source.slice(0, close) + `\n  ${cls}: { files: ['${file}'], tileM: ${tileM} },` + source.slice(close)
}

/** The credits list with the entry for `entry.file` added or replaced */
export function addCredit(list, entry) {
  return [...list.filter(e => e.file !== entry.file), entry]
}

function parseArgs(argv) {
  const opts = {}, pos = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) { pos.push(a); continue }
    const [k, v] = a.slice(2).split('=')
    if (v !== undefined) opts[k] = v
    else if (['own', 'dry-run'].includes(k)) opts[k] = true
    else opts[k] = argv[++i]
  }
  return { opts, pos }
}

function main() {
  const { opts, pos } = parseArgs(process.argv.slice(2))
  const fail = msg => { console.error('import-texture: ' + msg); process.exit(1) }
  const src = pos[0] && resolve(pos[0])
  if (!src || !existsSync(src)) fail('give the image file: node scripts/import-texture.mjs <image> --name <name> --author ... --license ...')
  const name = opts.name ?? basename(src, extname(src)).toLowerCase().replace(/[^a-z0-9]+/g, '_')
  if (!NAME_RE.test(name)) fail(`--name "${name}" must be lower case letters, digits and _ and start with a letter`)
  if (!opts.own && (!opts.author || !opts.license)) fail('a texture needs its credit: --author "..." --license "..." (or --own for original work of this project)')
  const cls = opts.class ?? name
  const tileM = Number(opts.tile ?? 2)
  if (!(tileM > 0)) fail('--tile is how many metres one repeat of the image covers, e.g. 2')

  const out = join(root, 'client', 'public', 'textures', `${name}.jpg`)
  const materials = readFileSync(MATERIALS, 'utf8')
  const newMaterials = addToTextureClasses(materials, { cls, file: name, tileM })   // throws before anything is written
  if (opts['dry-run']) { console.log(`dry run: would write ${out}, register ${name} in class "${cls}", add the credit`); return }

  const blender = findBlender()
  if (!blender) fail('Blender not found. Install it or set BLENDER=/path/to/blender')
  const r = spawnSync(blender, ['-b', '--python', join(root, 'tools', 'blender', 'asset_tool.py'), '--', 'build-texture', src, out,
    `--max-px=${opts['max-px'] ?? 1024}`, `--quality=${opts.quality ?? 88}`], { encoding: 'utf8', cwd: root })
  const lines = (r.stdout ?? '').split('\n').filter(l => l.startsWith('TEXTURE') || l.startsWith('SEAM'))
  if (r.status !== 0 || !existsSync(out)) fail('Blender failed:\n' + (r.stdout ?? '') + (r.stderr ?? ''))
  lines.forEach(l => console.log(l))
  const ratios = /ratio x=([\d.]+) y=([\d.]+)/.exec(lines.join('\n'))
  if (ratios && (Number(ratios[1]) > 2.5 || Number(ratios[2]) > 2.5)) console.warn('WARNING: the left/right or top/bottom edges differ much more than neighbouring pixels: this image probably shows a seam when tiled.')

  const srcDir = join(root, 'assets', 'source', 'texture')
  mkdirSync(srcDir, { recursive: true })
  const kept = join(srcDir, basename(src))
  if (resolve(src) !== kept) copyFileSync(src, kept)
  writeFileSync(MATERIALS, newMaterials)
  const credits = JSON.parse(readFileSync(CREDITS, 'utf8'))
  writeFileSync(CREDITS, JSON.stringify(addCredit(credits, {
    file: `textures/${name}.jpg`,
    author: opts.own ? 'FPS Web project' : opts.author,
    source: `assets/source/texture/${basename(src)} (scripts/import-texture.mjs)${opts.source ? '; ' + opts.source : ''}`,
    license: opts.own ? 'Original work' : opts.license,
    url: opts.url ?? '',
  }), null, 2) + '\n')
  console.log(`\nDone: textures/${name}.jpg registered in class "${cls}" (${tileM} m per repeat). In a map:  { "texture": "${cls}", "color": "#rrggbb" }`)
  console.log('Next: npm run typecheck && npm test (materials + credits checks)')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
