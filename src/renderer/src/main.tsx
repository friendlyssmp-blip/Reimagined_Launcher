import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { api } from './lib/api'
import './styles/global.css'

// Global crash net: uncaught errors and unhandled rejections are written to
// the launcher's on-disk log (via the main process) instead of being lost —
// and they never take the rest of the UI down.
window.addEventListener('error', (e) => {
  const detail = e.error instanceof Error ? `${e.message}\n${e.error.stack ?? ''}` : e.message
  void api.logs.write('error', `Uncaught renderer error: ${detail}`).catch(() => {})
})

window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason instanceof Error ? `${e.reason.message}\n${e.reason.stack ?? ''}` : String(e.reason)
  void api.logs.write('error', `Unhandled promise rejection: ${reason}`).catch(() => {})
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
