/**
 * useProjectImage — reliable project cover/icon loading (V2 fix).
 *
 * The renderer's CSP blocks in-page fetch() to remote CDNs and direct <img>
 * fails intermittently, so images are fetched through the MAIN-process proxy
 * (retries + browser headers + bounded cache) which returns a data URL.
 *
 * Dedupe: concurrent calls for the same URL share one IPC request.
 * Result: { status: 'loading' } → { status: 'ready', dataUrl } →
 * { status: 'error' } (never throws; callers render a placeholder).
 */
import { useEffect, useState } from 'react'
import { api } from './api'

type State = { status: 'loading' } | { status: 'ready'; dataUrl: string } | { status: 'error' }

const inFlight = new Map<string, Promise<string | null>>()
/** Session cache of resolved URLs — bounded (LRU-ish by insertion order) so
 * browsing hundreds of results never grows renderer memory without limit. */
const MAX_KNOWN = 200
const known = new Map<string, string | null>()

function fetchViaMain(src: string): Promise<string | null> {
  const hit = known.get(src)
  if (hit !== undefined) return Promise.resolve(hit)
  const busy = inFlight.get(src)
  if (busy) return busy
  const p = api.content
    .image(src)
    .then((r) => {
      known.set(src, r.dataUrl)
      while (known.size > MAX_KNOWN) {
        const oldest = known.keys().next().value as string
        known.delete(oldest)
      }
      return r.dataUrl
    })
    .catch(() => {
      known.set(src, null)
      while (known.size > MAX_KNOWN) {
        const oldest = known.keys().next().value as string
        known.delete(oldest)
      }
      return null
    })
    .finally(() => inFlight.delete(src))
  inFlight.set(src, p)
  return p
}

/** Reliable project image state for one URL (bounded memory, no re-fetch). */
export function useProjectImage(src?: string | null): State {
  const [state, setState] = useState<State>(src ? { status: 'loading' } : { status: 'error' })

  useEffect(() => {
    if (!src) {
      setState({ status: 'error' })
      return
    }
    let alive = true
    setState({ status: 'loading' })
    fetchViaMain(src).then((dataUrl) => {
      if (!alive) return
      setState(dataUrl ? { status: 'ready', dataUrl } : { status: 'error' })
    })
    return () => {
      alive = false
    }
  }, [src])

  return state
}
