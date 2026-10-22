// K.6: cross-check assets in client/public against assets/CREDITS.json and generate CREDITS.txt
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

export const UNVERIFIED = 'UNVERIFIED'

// Dev-only files, not third-party assets that need credit
const IGNORE = new Set(['viewer.html'])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

// The user's personal sounds (gitignored, not packaged): no credit needed, never part of the release
const LOCAL_PREFIX = 'sounds/local/'

export function listPublicAssets(root) {
  const pub = join(root, 'client', 'public')
  return walk(pub).map(p => relative(pub, p).split(sep).join('/')).filter(f => !IGNORE.has(f) && !f.startsWith(LOCAL_PREFIX)).sort()
}

/** @returns {{ entries: any[], missing: string[], stale: string[], unverified: string[] }} */
export function checkCredits(root) {
  const entries = JSON.parse(readFileSync(join(root, 'assets', 'CREDITS.json'), 'utf8'))
  const declared = new Set(entries.map(e => e.file))
  const files = listPublicAssets(root)
  const present = new Set(files)
  return {
    entries,
    missing: files.filter(f => !declared.has(f)),
    stale: [...declared].filter(f => !present.has(f)),
    unverified: entries.filter(e => !e.license || e.license.includes(UNVERIFIED) || !e.author || e.author.includes(UNVERIFIED)).map(e => e.file),
  }
}

export function creditsText(entries, version) {
  const lines = [`FPS WEB ${version} – CREDITS`, '', 'Third-party assets (models, sounds, images) used in the game:', '']
  for (const e of entries) {
    lines.push(`- ${e.file}`)
    lines.push(`    Author:    ${e.author}`)
    lines.push(`    Source:    ${e.source}${e.url ? ` (${e.url})` : ''}`)
    lines.push(`    License:   ${e.license}`)
  }
  return lines.join('\n') + '\n'
}
