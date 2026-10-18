import { VERSION } from '@fps/shared'

const app = document.getElementById('app')
if (app != null) {
  app.textContent = `FPS Web v${VERSION}`
}
