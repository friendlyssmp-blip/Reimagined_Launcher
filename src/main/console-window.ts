/**
 * Detached game console window.
 *
 * A small frameless BrowserWindow shown while a game runs (or on demand from
 * the TopBar console button). It is independent from the main launcher window:
 * draggable, minimizable, resizable, and closing it never stops the game.
 *
 * The module keeps a rolling buffer of `launch:log` lines and the last launch
 * progress so the console window can seed its view when it opens (windows are
 * recreated lazily). Every app event is forwarded to the console window over
 * the same EVENT_CHANNEL the main window uses, so its renderer reuses the
 * exact same `window.reimagined.onEvent` helper.
 */
import { BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { isPackaged } from './paths'
import { eventBus } from './core/event-bus'
import { launcher } from './minecraft/launcher'
import { EVENT_CHANNEL, type AppEvent } from '@shared/ipc'
import type { LaunchLogLine, LaunchProgress } from '@shared/types'

let consoleWindow: BrowserWindow | null = null

/** Rolling log buffer (seeded into the window on open). */
const logBuffer: LaunchLogLine[] = []
let lastProgress: { stage: string; message: string; percent: number | null } | null = null

// Forward every app event to the console window if it is alive. Also keep the
// buffer so a freshly opened window immediately shows what already happened.
eventBus.subscribeAll((event: AppEvent) => {
  if (event.type === 'launch:log') {
    logBuffer.push(event.payload as LaunchLogLine)
    if (logBuffer.length > 3000) logBuffer.shift()
  } else if (event.type === 'launch:progress') {
    const p = event.payload as LaunchProgress
    lastProgress = { stage: p.stage, message: p.message, percent: p.percent ?? null }
  } else if (event.type === 'launch:status') {
    // A new session starts / the old one ends — drop the stale snapshot so a
    // reopened console never shows yesterday's "Launching…" message.
    const p = event.payload as { running?: boolean }
    if (p.running) lastProgress = null
  } else if (event.type === 'launch:exit') {
    lastProgress = null
  }
  if (consoleWindow && !consoleWindow.isDestroyed()) {
    consoleWindow.webContents.send(EVENT_CHANNEL, event)
  }
})

function ensureWindow(): BrowserWindow | null {
  if (consoleWindow && !consoleWindow.isDestroyed()) return consoleWindow

  const win = new BrowserWindow({
    width: 720,
    height: 500,
    minWidth: 420,
    minHeight: 300,
    show: false,
    frame: false,
    backgroundColor: '#0D0D0F',
    autoHideMenuBar: true,
    title: 'Reimagined — Game Console',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  consoleWindow = win

  win.on('ready-to-show', () => {
    if (!win.isDestroyed()) win.show()
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  win.on('closed', () => {
    if (consoleWindow === win) consoleWindow = null
  })

  if (isPackaged) {
    void win.loadFile(path.join(__dirname, '../renderer/console.html'))
  } else {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) void win.loadURL(`${devUrl}/console.html`)
    else void win.loadFile(path.join(__dirname, '../renderer/console.html'))
  }

  return win
}

/** Show (or create) the console window and bring it to the front. */
export function openConsoleWindow(): void {
  const win = ensureWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** Hide the window — the game keeps running untouched. */
export function hideConsoleWindow(): void {
  if (consoleWindow && !consoleWindow.isDestroyed()) consoleWindow.hide()
}

/** Destroy the window (used on app shutdown). */
export function closeConsoleWindow(): void {
  if (consoleWindow && !consoleWindow.isDestroyed()) consoleWindow.destroy()
}

export function consoleWindowRef(): BrowserWindow | null {
  return consoleWindow && !consoleWindow.isDestroyed() ? consoleWindow : null
}

/** Initial state for a freshly opened console window. */
export function getConsoleState() {
  return {
    running: launcher.isRunning(),
    handle: launcher.handle,
    progress: lastProgress,
    logs: [...logBuffer]
  }
}
