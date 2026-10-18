import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  optimizeDeps: {
    entries: ['index.html'],
  },
  resolve: {
    alias: {
      '@fps/shared': resolve(__dirname, '../shared/src/index.ts'),
    },
  },
})
