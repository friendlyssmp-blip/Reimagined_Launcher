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
    // Attach HTTP status for callers that need to distinguish error types
    const err = new Error(`${context} failed with HTTP ${res.status}${text ? `: ${text.slice(0, 300)}` : ''}`)
    ;(err as any).status = res.status
    ;(err as any).body = json
    throw err
  }
  return json
}

export async function getJson<T>(url: string, opts: JsonRequestOptions = {}): Promise<T> {
  const res = await withTimeout(fetch(url, { headers: opts.headers }), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  return (await parseResponse(res, `GET ${url}`)) as T
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
