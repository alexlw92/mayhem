import { resolve, join } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import dotenv from 'dotenv'

// Must load env BEFORE defineConfig evaluates the define block.
// Vite plugin hooks (vite-plugin-dotenv) run after the config object is built,
// so process.env values set by plugins are too late for define to capture.
//
// electron-vite always sets NODE_ENV=production during `electron-vite build`, so
// we can't use NODE_ENV to distinguish dev from release builds. Instead we use
// RELEASE_BUILD=true as an explicit opt-in for production packaging. Normal builds
// (dev, CI, e2e tests) load .env.dev so BACKEND_URL is inlined as localhost.
dotenv.config({ path: join(process.cwd(), '.env.dev'), override: true })
if (process.env.RELEASE_BUILD === 'true') {
  dotenv.config({ path: join(process.cwd(), '.env'), override: true })
} else if (process.env.STAGING === 'true') {
  dotenv.config({ path: join(process.cwd(), '.env.staging'), override: true })
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      'process.env.BACKEND_URL': JSON.stringify(process.env.BACKEND_URL ?? 'http://localhost:3847'),
      'process.env.API_KEY': JSON.stringify(process.env.API_KEY ?? ''),
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
