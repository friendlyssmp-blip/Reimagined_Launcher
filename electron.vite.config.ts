import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

/**
 * electron-vite build configuration.
 * Three targets: main process, preload script, renderer (React).
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@': resolve(__dirname, 'src/renderer/src')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        // Two renderer entry points: the main launcher UI and the detached
        // game console window (its own frameless BrowserWindow).
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          console: resolve(__dirname, 'src/renderer/console.html')
        }
      }
    }
  }
})
