import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
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
