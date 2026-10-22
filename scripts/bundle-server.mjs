// Bundle the standalone server into a single CommonJS file for Node SEA (K.2): node scripts/bundle-server.mjs → build/server.cjs
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { builtinModules } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const result = await build({
  entryPoints: [join(root, 'server/src/standalone.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',                                  // matches .nvmrc
  outfile: join(root, 'build/server.cjs'),
  external: ['bufferutil', 'utf-8-validate'],        // optional ws packages, ws skips them if missing
  define: { 'process.env.APP_VERSION': JSON.stringify(version) },
  metafile: true,
  logLevel: 'warning',
})

// SEA can only require Node built-in modules → fail if any external package is still required
const bad = []
for (const out of Object.values(result.metafile.outputs)) {
  for (const imp of out.imports) {
    if (imp.external && !imp.path.startsWith('node:') && !builtinModules.includes(imp.path) && !['bufferutil', 'utf-8-validate'].includes(imp.path)) bad.push(imp.path)
  }
}
if (bad.length) {
  console.error('build/server.cjs still requires external packages (SEA cannot load them): ' + [...new Set(bad)].join(', '))
  process.exit(1)
}
console.log(`Bundled server v${version} → build/server.cjs`)
