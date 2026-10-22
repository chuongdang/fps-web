import { defineConfig, type Plugin, type PreviewServer } from 'vite'
import { resolve } from 'path'
import { readFileSync } from 'fs'

// Editing bots.json while playing offline: push the new content to the page via HMR and block the page reload (the offline worker keeps the match running)
const botsJsonHot = (): Plugin => ({
  name: 'bots-json-hot',
  handleHotUpdate({ file, server }) {
    if (!file.replace(/\\/g, '/').endsWith('/server/src/bots/bots.json')) return
    try { server.ws.send({ type: 'custom', event: 'bots-json', data: JSON.parse(readFileSync(file, 'utf8')) }) } catch { /* JSON half-edited: ignore */ }
    return []
  },
})

// The browser talks to the backend through Vite's own /ws (proxy → :8081): one address for both LAN and ngrok (https → wss)
const shared = {
  host: true,   // listen on all network interfaces so other machines on the LAN can connect (Vite prints the Network line)
  allowedHosts: ['.ngrok-free.app', '.ngrok.app', '.ngrok.io', '.ngrok-free.dev'],   // Vite blocks unknown hostnames
  proxy: { '/ws': { target: `ws://localhost:${process.env.FPS_PORT ?? 8081}`, ws: true } },
}

// `vite preview` (sirv) may overwrite headers, so wrap res.writeHead to inject Cache-Control right before the response is sent.
// /assets/ (hashed file names) are cached for 1 year; models/sounds/icons for 7 days; index.html is left unset (always revalidated).
const previewCache = (): Plugin => ({
  name: 'preview-cache-control',
  configurePreviewServer(server: PreviewServer) {
    server.middlewares.use((req, res, next) => {
      const url = (req.url ?? '').split('?')[0]!
      const value = url.startsWith('/assets/') ? 'public, max-age=31536000, immutable'
        : /^\/(models|sounds|icons)\//.test(url) ? 'public, max-age=604800' : null
      if (value) {
        const writeHead = res.writeHead.bind(res) as (...a: unknown[]) => typeof res
        res.writeHead = ((...args: unknown[]) => {
          // sirv passes headers through writeHead's arguments (overriding setHeader): override Cache-Control in both places
          const h = args.find(x => x && typeof x === 'object' && !Array.isArray(x)) as Record<string, unknown> | undefined
          if (h) { for (const k of Object.keys(h)) if (k.toLowerCase() === 'cache-control') delete h[k]; h['Cache-Control'] = value }
          res.setHeader('Cache-Control', value)
          return writeHead(...args)
        }) as typeof res.writeHead
      }
      next()
    })
  },
})

const { version } = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8')) as { version: string }

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [botsJsonHot(), previewCache()],
  server: shared,
  preview: { ...shared, port: 4173 },
  optimizeDeps: {
    entries: ['index.html'],
  },
  resolve: {
    alias: {
      '@fps/shared/physics/world': resolve(__dirname, '../shared/src/physics/world.ts'),
      '@fps/shared': resolve(__dirname, '../shared/src/index.ts'),
      '@assets': resolve(__dirname, '../assets'),
    },
  },
})
