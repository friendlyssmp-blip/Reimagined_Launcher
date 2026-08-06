/**
 * Account face icon.
 *
 * The ONLY remaining piece of the removed Skins section: the small 2D face
 * render of the player's current skin shown next to their username across
 * the launcher (Sidebar, TopBar, Home).
 *
 * Textures are loaded through the MAIN process as data URLs (canvas-safe —
 * textures.minecraft.net has no CORS headers and file:// is blocked in the
 * dev server), then the 8x8 face region (plus hat overlay) is composited
 * onto a crisp pixelated canvas.
 */
import { useEffect, useRef, useState } from 'react'
import { api, friendlyError } from '../lib/api'

export interface SkinTextureData {
  dataUrl: string
  width: number
  height: number
  legacy: boolean
}

/* ------------------------- texture loading (via main) ------------------------- */

const textureCache = new Map<string, Promise<SkinTextureData>>()
const imageCache = new Map<string, Promise<HTMLImageElement>>()

export function loadSkinTexture(url: string): Promise<SkinTextureData> {
  const existing = textureCache.get(url)
  if (existing) return existing
  const p = api.skin
    .texture(url)
    .then((d) => ({ dataUrl: d.dataUrl, width: d.width, height: d.height, legacy: d.height === 32 }))
    .catch((err) => {
      textureCache.delete(url)
      throw err
    })
  textureCache.set(url, p)
  return p
}

export function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  const existing = imageCache.get(dataUrl)
  if (existing) return existing
  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Skin texture could not be decoded.'))
    img.src = dataUrl
  })
  imageCache.set(dataUrl, p)
  return p
}

/** Draw the 8x8 face (with hat overlay) onto a canvas — crisp pixel art. */
export async function drawFaceToCanvas(canvas: HTMLCanvasElement, tex: SkinTextureData, size: number): Promise<void> {
  const img = await loadImage(tex.dataUrl)
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const faceX = tex.legacy ? 0 : 8
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, size, size)
  ctx.drawImage(img, faceX, 8, 8, 8, 0, 0, size, size)
  if (!tex.legacy) ctx.drawImage(img, 40, 8, 8, 8, 0, 0, size, size)
}

/* --------------------------------- component --------------------------------- */

/**
 * Renders the player's CURRENT skin face from the real skin texture URL (read
 * straight from the account data — no skin backend involved), loaded through
 * the main process as a data URL. Falls back to a subtle placeholder while
 * loading or when no skin URL is available.
 */
export function SkinHeadPreview({ url, size = 32 }: { url?: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [tex, setTex] = useState<SkinTextureData | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setTex(null)
    setFailed(false)
    if (!url) return
    loadSkinTexture(url)
      .then((t) => {
        if (alive) setTex(t)
      })
      .catch((err) => {
        if (alive) {
          setFailed(true)
          void api.logs.write('error', `SkinHeadPreview failed: ${friendlyError(err)}`)
        }
      })
    return () => { alive = false }
  }, [url])

  useEffect(() => {
    if (!tex || !canvasRef.current) return
    const canvas = canvasRef.current
    // Render at devicePixelRatio resolution so the face is sharp on HiDPI
    // displays, then scale down to the CSS size — always crisp pixel art.
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1))
    const px = Math.max(8, Math.round(size * dpr))
    canvas.width = px
    canvas.height = px
    void drawFaceToCanvas(canvas, tex, px).catch((err) =>
      void api.logs.write('error', `Face render failed: ${friendlyError(err)}`)
    )
  }, [tex, size])

  if (failed || !url) {
    return <div style={{ width: size, height: size, borderRadius: 8, background: 'var(--bg-4)', flex: '0 0 auto' }} />
  }
  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ width: size, height: size, borderRadius: 8, background: 'var(--bg-4)', flex: '0 0 auto', imageRendering: 'pixelated' }}
    />
  )
}
