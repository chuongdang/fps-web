// Run the "real play" setup: non-watch server + built client (vite preview, port 4173). Usage: npm run play
import { spawn } from 'child_process'

// Separate ports (8082 + 4173) so it can run alongside `npm run dev` (8081 + 5173)
const env = { ...process.env, FPS_PORT: '8082', FPS_WEB_PORT: '4173' }
const server = spawn('npm', ['-w', 'server', 'run', 'start'], { stdio: 'inherit', env })
const client = spawn('npm', ['-w', 'client', 'run', 'preview'], { stdio: 'inherit', env })

function cleanup() {
  server.kill()
  client.kill()
}

process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)
