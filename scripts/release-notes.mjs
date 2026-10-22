// Print the section of one version from CHANGELOG.md (used as the GitHub Release body): node scripts/release-notes.mjs v1.3.0
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const tag = process.argv[2] ?? ''
const version = tag.replace(/^v/, '')
const text = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'CHANGELOG.md'), 'utf8')

// Section looks like "## 1.3.0 – date" or "## [1.3.0] ..."
const lines = text.split(/\r?\n/)
const start = lines.findIndex(l => /^##\s/.test(l) && l.replace(/[\[\]v]/g, '').split(/\s+/).includes(version))
if (start < 0) {
  console.log(`FPS Web ${version}\n\n(CHANGELOG.md has no entry for this version.)`)
} else {
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l))
  if (end < 0) end = lines.length
  console.log(lines.slice(start + 1, end).join('\n').trim())
}
