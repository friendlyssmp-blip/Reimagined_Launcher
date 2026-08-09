/**
 * Network helpers built on top of the global fetch API (Node >= 20).
 * Downloads stream to disk so large files (client jars, assets, mods)
 * never occupy memory.
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Errors } from '../core/errors'

const DEFAULT_TIMEOUT_MS = 30_000

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    // The caller-provided signal is not supported on every path, so we only
    // race against the timeout for the promise form below.
    return await Promise.race([
      p,
      new Promise<T>((_, rej) => {
        timer.unref()
        ctrl.signal.addEventListener('abort', () => rej(Errors.network('The request timed out.')))
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

export interface JsonRequestOptions {
  timeoutMs?: number
  headers?: Record<string, string>
}

async function parseResponse(res: Response, context: string): Promise<unknown> {
  const text = await res.text().catch(() => '')
  let json: unknown
  try { json = JSON.parse(text) } catch { json = undefined }
  if (!res.ok) {
    // Attach HTTP status for callers that need to distinguish error types.
    // The raw response body (often an HTML error page) is NEVER put in the
    // message — it must never reach the user's UI (v1.0.52: no more raw 429
    // HTML dumps in the app). It stays available on `.bodyText` for logs.
    const err = new Error(`${context} failed with HTTP ${res.status}.`)
    ;(err as any).status = res.status
    ;(err as any).body = json
    ;(err as any).bodyText = text.slice(0, 600)
    ;(err as any).retryAfter = res.headers.get('retry-after') ?? undefined
    throw err
  }
  return json
}

/**
 * GET with bounded automatic retry on rate-limit (429) and transient 5xx
 * responses — Modrinth throttles bursts (HTTP 429) and a quick retry with
 * backoff resolves most of them without bothering the user.
 */
export async function getJson<T>(url: string, opts: JsonRequestOptions = {}): Promise<T> {
  let lastErr: unknown
  // v1.0.52 — four attempts with exponential backoff; a 429/5xx pauses and
  // retries (honouring a Retry-After header when the server sends one) so
  // rate-limit bursts resolve themselves instead of erroring the UI.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await withTimeout(fetch(url, { headers: opts.headers }), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
      return (await parseResponse(res, `GET ${url}`)) as T
    } catch (err) {
      lastErr = err
      const status = (err as { status?: number })?.status
      const retriable = status === 429 || (status !== undefined && status >= 500 && status < 600)
      if (!retriable) throw err
      const retryAfter = (err as { retryAfter?: string })?.retryAfter
      let waitMs = 500 * Math.pow(2, attempt)
      if (retryAfter && /^\d+$/.test(retryAfter.trim())) {
        waitMs = Math.max(waitMs, Number(retryAfter.trim()) * 1000)
      }
      if (attempt < 3) await new Promise((r) => setTimeout(r, waitMs))
    }
  }
  throw lastErr
}

export async function postForm<T>(
  url: string,
  body: Record<string, string>,
  opts: JsonRequestOptions = {}
): Promise<T> {
  const params = new URLSearchParams()
  Object.entries(body).forEach(([k, v]) => params.set(k, v))
  const res = await withTimeout(
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...opts.headers },
      body: params.toString()
    }),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  )
  return (await parseResponse(res, `POST ${url}`)) as T
}

export async function postJson<T>(
  url: string,
  body: unknown,
  opts: JsonRequestOptions = {}
): Promise<T> {
  const res = await withTimeout(
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...opts.headers },
      body: JSON.stringify(body)
    }),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  )
  return (await parseResponse(res, `POST ${url}`)) as T
}

export interface DownloadProgress {
  url: string
  dest: string
  received: number
  total: number
  percent: number
}

/**
 * Stream a file to disk. `onProgress` is called as chunks arrive.
 * Returns the final size in bytes.
 */
export async function downloadFile(
  url: string,
  dest: string,
  onProgress?: (p: DownloadProgress) => void,
  timeoutMs = 120_000,
  externalSignal?: AbortSignal
): Promise<number> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const onExternalAbort = (): void => ctrl.abort()
  externalSignal?.addEventListener('abort', onExternalAbort)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok || !res.body) {
      throw new Error(`Download failed with HTTP ${res.status} (${url})`)
    }
    const total = Number(res.headers.get('content-length')) || 0
    mkdirP(path.dirname(dest))
    const file = fs.createWriteStream(dest)
    let received = 0

    const reader = res.body.getReader()
    return await new Promise<number>((resolve, reject) => {
      const pump = async (): Promise<void> => {
        try {
          const { done, value } = await reader.read()
          if (done) {
            file.end(() => resolve(received))
            return
          }
          received += value.byteLength
          file.write(Buffer.from(value))
          if (onProgress && total > 0) {
            onProgress({ url, dest, received, total, percent: Math.min(100, (received / total) * 100) })
          }
          await pump()
        } catch (err) {
          file.destroy()
          reject(err instanceof Error ? err : new Error(String(err)))
        }
      }
      file.on('error', reject)
      pump()
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      // Distinguish a user-cancelled download from a timeout.
      throw externalSignal?.aborted
        ? Errors.network('The download was cancelled.')
        : Errors.network('The download timed out.')
    }
    throw err
  } finally {
    clearTimeout(timer)
    externalSignal?.removeEventListener('abort', onExternalAbort)
  }
}

function mkdirP(p: string): void {
  fs.mkdirSync(p, { recursive: true })
}
