import { resolve, join } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import dotenv from 'dotenv'

// Must load env BEFORE defineConfig evaluates the define block.
// Vite plugin hooks (vite-plugin-dotenv) run after the config object is built,
// so process.env values set by plugins are too late for define to capture.
if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: join(process.cwd(), '.env.dev'), override: true })
} else {
  dotenv.config({ path: join(process.cwd(), '.env') })
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
