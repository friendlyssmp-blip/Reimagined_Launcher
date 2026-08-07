/**
 * ModIcon — remote mod/modpack icon with a bounded, evicting cache.
 *
 * Browsed icons come from Modrinth's CDN. Instead of letting the browser
 * hold one decoded image per URL indefinitely, we fetch each icon once,
 * keep a blob object URL in a capped Map (LRU-ish by insertion order), and
 * revoke the URLs of evicted entries. The cap keeps memory flat even when
 * the user scrolls through thousands of results across sessions.
 *
 * Rendering is regression-proof: until the cached blob is ready (or if the
 * fetch ever fails), we show the plain <img src={originalUrl}> exactly like
 * before — an icon can never degrade into a placeholder.
 */
import { useEffect, useState } from 'react'

const MAX_ENTRIES = 160
const cache = new Map<string, string>()
const pending = new Map<string, Promise<string>>()
/** URLs that failed once are never refetched — direct <img> is kept instead. */
const failed = new Set<string>()

function resolve(src: string): Promise<string> {
  if (failed.has(src)) return Promise.reject(new Error('icon previously failed'))
  const hit = cache.get(src)
  if (hit) return Promise.resolve(hit)
  const inflight = pending.get(src)
  if (inflight) return inflight

  const p = fetch(src)
    .then((r) => {
      if (!r.ok) throw new Error('icon fetch ' + r.status)
      return r.blob()
    })
    .then((blob) => {
      const url = URL.createObjectURL(blob)
      cache.set(src, url)
      // Evict oldest entries (Map preserves insertion order) and release
      // their object URLs so memory stays bounded.
      while (cache.size > MAX_ENTRIES) {
        const oldest = cache.keys().next().value as string
        const oldUrl = cache.get(oldest)
        cache.delete(oldest)
        if (oldUrl) URL.revokeObjectURL(oldUrl)
      }
      return url
    })
    .catch((err) => {
      failed.add(src)
      throw err
    })
    .finally(() => pending.delete(src))

  pending.set(src, p)
  return p
}

/**
 * Renders the icon. Uses the cached blob URL when available; falls back to
 * the original URL (instant, browser-cached) while loading or on failure.
 */
export function ModIcon({ src, style, draggable = false }: { src?: string | null; style?: React.CSSProperties; draggable?: boolean }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!src) {
      setUrl(null)
      return
    }
    let alive = true
    resolve(src)
      .then((u) => {
        if (alive) setUrl(u)
      })
      .catch(() => {
        /* keep the direct <img> below */
      })
    return () => {
      alive = false
    }
  }, [src])

  if (!src) return null
  return <img src={url ?? src} alt="" style={style} draggable={draggable} />
}
