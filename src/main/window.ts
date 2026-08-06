/**
 * Main window lifecycle. Frameless, dark, custom title bar (drag region +
 * window controls live in the renderer).
 */
import { BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { isPackaged } from './paths'

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function showMainWindow(): void {
  mainWindow?.show()
}

export function createMainWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    frame: false,
    backgroundColor: '#07070b',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // Open external links in the default browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('maximize', () => mainWindow?.webContents.send('reimagined:maximized', true))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('reimagined:maximized', false))

  // Keep the app quit semantics intact: when the main launcher window closes,
  // the detached console window goes with it (otherwise a hidden console
  // window would keep an invisible app alive with no way back to the UI).
  mainWindow.on('closed', () => {
    void import('./console-window').then((m) => m.closeConsoleWindow())
  })

  if (isPackaged) {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  } else {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) {
      void mainWindow.loadURL(devUrl)
    } else {
      void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
    }
  }

  return mainWindow
}
