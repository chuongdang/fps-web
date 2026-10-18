import { spawn } from 'child_process'

const server = spawn('npm', ['-w', 'server', 'run', 'dev'], { stdio: 'inherit' })
const client = spawn('npm', ['-w', 'client', 'run', 'dev'], { stdio: 'inherit' })

function cleanup() {
  server.kill()
  client.kill()
}

process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)
