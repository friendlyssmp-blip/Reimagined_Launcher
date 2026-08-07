/**
 * Reliable image proxy (V2 fix).
 *
 * The renderer's CSP (`connect-src 'self'`) blocks in-page fetch() to remote
 * CDNs, and direct <img> to Modrinth's CDN fails intermittently with no
 * fallback — that's why project covers/icons sometimes didn't load.
 *
 * This module downloads images in the MAIN process (no CSP there) with
 * browser-like headers, a timeout and retries, and returns a data URL.
 * A bounded LRU-ish cache (cap 150 entries, oversized images skipped) keeps
 * memory flat across thousands of browsed results.
 */
import { logger } from '../logs/logger'

const MAX_CACHE = 150
/** Total cached bytes budget — a hard ceiling so huge covers can never
 * accumulate in memory. Raised for v1.0.22 so large/full-res (4K) covers and
 * gallery screenshots are cached like small icons are. */
const MAX_CACHE_BYTES_TOTAL = 160 * 1024 * 1024
/** Images bigger than this are not cached (they are still delivered once).
 * Bumped so real high-resolution covers fit — never downscaled. */
const MAX_CACHE_BYTES = 12 * 1024 * 1024
const MAX_ATTEMPTS = 3
const TIMEOUT_MS = 15_000

/** url → dataUrl. Map preserves insertion order; oldest evicted first. */
const cache = new Map<string, string>()
/** Running total of cached bytes for the budget above. */
let cacheBytes = 0
/** In-flight dedupe so the same URL is never downloaded twice at once. */
const inflight = new Map<string, Promise<string | null>>()

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/** Browser-like headers — some CDNs throttle/bounce non-browser clients. */
function headers(): Record<string, string> {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    // Modrinth's CDN serves hotlinked covers to pages that reference it.
    Referer: 'https://modrinth.com/',
    'Accept-Language': 'en-US,en;q=0.9'
  }
}

async function downloadOnce(url: string): Promise<string | null> {
  if (!isHttpUrl(url)) return null
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { headers: headers(), signal: ctrl.signal })
    if (!res.ok) {
      logger.warn(`Image proxy: HTTP ${res.status} for ${url.slice(0, 120)}`)
      return null
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length === 0) return null
    const type = (res.headers.get('content-type') ?? 'image/png').split(';')[0].trim() || 'image/png'
    const dataUrl = `data:${type};base64,${buf.toString('base64')}`
    if (buf.length <= MAX_CACHE_BYTES) {
      cache.set(url, dataUrl)
      cacheBytes += buf.length
      while (cache.size > MAX_CACHE || cacheBytes > MAX_CACHE_BYTES_TOTAL) {
        const oldest = cache.keys().next().value as string
        const oldUrl = cache.get(oldest)
        cache.delete(oldest)
        if (oldUrl) cacheBytes -= (oldUrl.length * 3) / 4 // approx base64 → bytes
      }
    }
    return dataUrl
  } catch (err) {
    logger.warn(`Image proxy: fetch failed for ${url.slice(0, 120)} (${(err as Error).message})`)
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Fetch an image as a data URL with retries + cache + dedupe. Never throws. */
export async function fetchImageDataUrl(url: string): Promise<string | null> {
  if (!isHttpUrl(url)) return null
  const hit = cache.get(url)
  if (hit) return hit
  const busy = inflight.get(url)
  if (busy) return busy

  const p = (async () => {
    let last: string | null = null
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      last = await downloadOnce(url)
      if (last) break
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 500 * attempt))
      }
    }
    return last
  })().finally(() => inflight.delete(url))

  inflight.set(url, p)
  return p
}
