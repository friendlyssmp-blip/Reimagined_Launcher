/**
 * System tray (v1.0.85).
 *
 * The launcher must NEVER die while a game is running — the console window
 * and the session state belong to it. When the main window closes (whether
 * the user closes it, an update hides it, or a renderer crash takes the
 * window down), the app hides to the tray instead of quitting, and the game
 * session stays fully intact. Quit only happens from the tray menu.
 */
import { app, Menu, nativeImage, Tray } from 'electron'
import path from 'node:path'
import { getMainWindow } from './window'

let tray: Tray | null = null

/** A 16×16 tray icon — the real app icon when reachable, else an in-memory
 *  purple Reimagined glyph (BGRA bitmap, Windows native format). */
function trayIcon(): Electron.NativeImage {
  const candidates = [
    path.join(process.resourcesPath ?? '', 'build', 'icon.ico'),
    path.join(process.resourcesPath ?? '', 'icon.ico'),
    path.join(app.getAppPath(), 'build', 'icon.ico'),
    path.join(app.getAppPath(), 'resources', 'icon.ico')
  ]
  for (const p of candidates) {
    try {
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) return img.resize({ width: 16, height: 16 })
    } catch {
      /* keep looking */
    }
  }
  // Fallback: draw a soft purple disc (the launcher's accent) in memory.
  const size = 16
  const buf = Buffer.alloc(size * size * 4)
  const cx = 7.5
  const cy = 7.5
  const r = 6.5
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, y - cy)
      const i = (y * size + x) * 4
      const alpha = d <= r ? (d > r - 1.2 ? Math.max(0, Math.round(((r - d) / 1.2) * 255)) : 255) : 0
      if (alpha > 0) {
        const t = d / r
        buf[i] = Math.round(170 + t * 26) // B
        buf[i + 1] = Math.round(78 + t * 18) // G
        buf[i + 2] = Math.round(252 - t * 62) // R
        buf[i + 3] = alpha
      }
    }
  }
  const img = nativeImage.createFromBitmap(buf, { width: size, height: size })
  if (!img.isEmpty()) return img
  return nativeImage.createEmpty()
}

function showWindow(): void {
  const w = getMainWindow()
  if (!w) return
  if (w.isMinimized()) w.restore()
  w.show()
  w.focus()
}

export function createTray(): void {
  if (tray) return
  tray = new Tray(trayIcon())
  tray.setToolTip('Reimagined Launcher')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Reimagined', click: showWindow },
      { type: 'separator' },
      { label: 'Quit Reimagined', click: () => app.quit() }
    ])
  )
  tray.on('click', showWindow)
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}
