/**
 * Spotify connection (v1.0.85) — Authorization Code with PKCE + Web Playback.
 *
 * Security model: the launcher NEVER sees your password. You authorize inside
 * Spotify's own page (oauth.accounts.spotify.com), and the only credential
 * exchanged is a short-lived access token + a refresh token, stored encrypted
 * with Electron safeStorage (DPAPI on Windows) inside data/spotify-tokens.json.
 * Playback is streamed by Spotify's Web Playback SDK directly from Spotify's
 * servers to the launcher — your IP is only ever visible to Spotify, exactly
 * like the official app. Requires a Spotify Premium account and a free
 * "Spotify for Developers" app with its Client ID pasted in Settings.
 */
import crypto from 'node:crypto'
import http from 'node:http'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { safeStorage, shell } from 'electron'
import type { AddressInfo } from 'node:net'
import { paths } from '../paths'
import { readJson, writeJson } from '../utils/fs'
import { logger } from '../logs/logger'

const TOKEN_URL = 'https://accounts.spotify.com/api/token'
const AUTH_URL = 'https://accounts.spotify.com/authorize'
const SCOPES = [
  'streaming',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-read-email'
].join(' ')

interface StoredTokens {
  accessToken: string
  refreshToken: string
  clientId: string
  expiresAt: number
  displayName?: string
}

function tokenFile(): string {
  return path.join(paths.data, 'spotify-tokens.json')
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function readStored(): Promise<StoredTokens | null> {
  const raw = await readJson<{ data?: string; encrypted?: boolean } | null>(tokenFile(), null).catch(() => null)
  if (!raw?.data) return null
  try {
    const buf = Buffer.from(raw.data, 'base64')
    const json = raw.encrypted
      ? safeStorage.decryptString(buf)
      : buf.toString('utf-8')
    return JSON.parse(json) as StoredTokens
  } catch {
    return null
  }
}

async function writeStored(t: StoredTokens | null): Promise<void> {
  if (!t) {
    await fsp.rm(tokenFile(), { force: true }).catch(() => {})
    return
  }
  const json = JSON.stringify(t)
  const encrypted = safeStorage.isEncryptionAvailable()
  const data = encrypted ? safeStorage.encryptString(json).toString('base64') : Buffer.from(json, 'utf-8').toString('base64')
  await writeJson(tokenFile(), { data, encrypted })
}

async function exchange(params: Record<string, string>): Promise<{ access_token?: string; refresh_token?: string; expires_in?: number } | null> {
  try {
    const body = new URLSearchParams(params).toString()
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    })
    if (!res.ok) return null
    return (await res.json().catch(() => null)) as { access_token?: string; refresh_token?: string; expires_in?: number } | null
  } catch {
    return null
  }
}

/** Current connection status (for the Settings UI). */
export async function status(): Promise<{ connected: boolean; displayName?: string }> {
  const t = await readStored()
  return { connected: Boolean(t?.refreshToken && t?.clientId), displayName: t?.displayName }
}

/**
 * Kick off the PKCE flow: opens Spotify's authorize page in the browser,
 * waits for the redirect to a temporary 127.0.0.1 callback server, exchanges
 * the code, stores the tokens (encrypted) and resolves. Timeout 2 minutes.
 */
export async function beginAuth(rawClientId: string): Promise<{ ok: boolean; error?: string }> {
  const clientId = String(rawClientId ?? '').trim()
  if (!clientId) {
    return { ok: false, error: 'Enter your Spotify Client ID first — create a free app at developer.spotify.com.' }
  }

  const verifier = base64url(crypto.randomBytes(64))
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest())

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/callback') {
      res.writeHead(404)
      res.end('Not found')
      return
    }
    const code = url.searchParams.get('code')
    const error = url.searchParams.get('error')
    if (error || !code) {
      res.writeHead(400)
      res.end('Spotify login was cancelled — you can close this tab.')
      server.close()
      settle(null)
      return
    }
    const port = (server.address() as AddressInfo).port
    const tok = await exchange({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `http://127.0.0.1:${port}/callback`,
      client_id: clientId,
      code_verifier: verifier
    })
    if (!tok?.access_token) {
      res.writeHead(502)
      res.end('Could not finish the connection — close this tab and try again.')
      server.close()
      settle(null)
      return
    }
    const stored: StoredTokens = {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token ?? '',
      clientId,
      expiresAt: Date.now() + (tok.expires_in ?? 3600) * 1000
    }
    const me = await fetch('https://api.spotify.com/v1/me', {
      headers: { authorization: `Bearer ${tok.access_token}` }
    }).catch(() => null)
    if (me?.ok) {
      const d = (await me.json().catch(() => null)) as { display_name?: string } | null
      if (d?.display_name) stored.displayName = d.display_name
    }
    await writeStored(stored)
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(
      '<html><body style="background:#0b0b12;color:#fff;font-family:Segoe UI,Arial,sans-serif;' +
      'display:flex;align-items:center;justify-content:center;height:100vh;margin:0">' +
      '<div style="text-align:center"><h1 style="font-size:26px">✓ Connected to Spotify</h1>' +
      '<p style="color:#aaa">You can close this tab and go back to Reimagined.</p></div></body></html>'
    )
    server.close()
    settle(stored)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const redirectUri = `http://127.0.0.1:${port}/callback`
  void shell.openExternal(
    `${AUTH_URL}?${new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      code_challenge_method: 'S256',
      code_challenge: challenge,
      scope: SCOPES
    })}`
  )
  logger.info('Spotify: opened the authorize page — waiting for the callback')

  const result = await new Promise<StoredTokens | null>((resolve) => {
    resolvers.push(resolve)
    setTimeout(() => {
      server.close()
      settle(null)
    }, 120_000)
  })
  if (!result) return { ok: false, error: 'Spotify login timed out or was cancelled — try again.' }
  logger.info(`Spotify: connected as ${result.displayName ?? 'user'}`)
  return { ok: true }
}

let resolvers: ((t: StoredTokens | null) => void)[] = []
function settle(t: StoredTokens | null): void {
  const rs = resolvers
  resolvers = []
  rs.forEach((r) => r(t))
}

/** A valid access token for the Web Playback SDK (refreshes when needed). */
export async function getAccessToken(): Promise<{ ok: boolean; token?: string; error?: string }> {
  const stored = await readStored()
  if (!stored?.refreshToken || !stored.clientId) {
    return { ok: false, error: 'Not connected to Spotify yet.' }
  }
  if (stored.accessToken && stored.expiresAt > Date.now() + 60_000) {
    return { ok: true, token: stored.accessToken }
  }
  const tok = await exchange({
    grant_type: 'refresh_token',
    refresh_token: stored.refreshToken,
    client_id: stored.clientId
  })
  if (!tok?.access_token) {
    return { ok: false, error: 'The Spotify session expired and could not be refreshed — reconnect.' }
  }
  await writeStored({
    ...stored,
    accessToken: tok.access_token,
    expiresAt: Date.now() + (tok.expires_in ?? 3600) * 1000
  })
  return { ok: true, token: tok.access_token }
}

/** Forget the stored Spotify session. */
export async function disconnect(): Promise<void> {
  await writeStored(null)
  logger.info('Spotify: disconnected')
}

export const spotifyService = { status, beginAuth, getAccessToken, disconnect }
