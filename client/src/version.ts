declare const __APP_VERSION__: string   // vite.config.ts: version from the root package.json

// Vitest does not run through vite.config, so there is no define
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'
