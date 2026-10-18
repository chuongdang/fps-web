import { TICK_RATE } from '@fps/shared'

const app = document.getElementById('app')
if (app != null) {
  app.textContent = `FPS Web (${TICK_RATE} tick/s)`
}
