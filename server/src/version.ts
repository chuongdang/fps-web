import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'

// Packaged build: esbuild replaces process.env.APP_VERSION with the version in the root package.json (scripts/bundle-server.mjs).
// Dev run: look for the root package.json (the one with "workspaces") walking up from the current directory - `npm -w server` runs with cwd = server/.
function devVersion(): string {
  try {
    for (let dir = process.cwd(); ; dir = dirname(dir)) {
      const file = join(dir, 'package.json')
      if (existsSync(file)) {
        const pkg = JSON.parse(readFileSync(file, 'utf8')) as { version?: string; workspaces?: unknown }
        if (pkg.workspaces) return String(pkg.version ?? '0.0.0')
      }
      if (dirname(dir) === dir) break
    }
  } catch { /* fall through to the default */ }
  return '0.0.0'
}

export const APP_VERSION: string = process.env.APP_VERSION ?? devVersion()
