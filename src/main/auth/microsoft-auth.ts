/**
 * Official Microsoft authentication (device code flow).
 *
 * Full OAuth 2.0 device-code flow against Microsoft Entra ID (consumer),
 * followed by the Xbox Live → XSTS → Minecraft services token exchange.
 *
 *  1. POST /devicecode              → user code + verification URI
 *  2. Poll POST /token              → access/refresh token
 *  3. POST user.auth.xboxlive.com   → XBL token
 *  4. POST xsts.auth.xboxlive.com   → XSTS token
 *  5. POST login_with_xbox          → Minecraft bearer token
 *  6. GET  minecraft/profile        → username + UUID
 *
 * Passwords are never handled. Requires a registered Azure client ID
 * (Settings → Microsoft), documented in the README.
 */
import { eventBus } from '../core/event-bus'
import { shell } from 'electron'
import { Errors, LauncherError } from '../core/errors'
import { getJson, postForm } from '../utils/http'
import { settingsManager } from '../settings/settings-manager'
import { accountStore } from './account-store'
import { logger } from '../logs/logger'
import { iso, delay } from '../utils/format'
import type { Account, AccountProfile } from '@shared/types'

const BUILT_IN_CLIENT_ID = "c36a9fb6-4f2a-41ff-90bd-ae7cc92031eb"

const AAD = 'https://login.microsoftonline.com/consumers/oauth2/v2.0'
const XBOX_AUTH = 'https://user.auth.xboxlive.com/user/authenticate'
const XBOX_XSTS = 'https://xsts.auth.xboxlive.com/xsts/authorize'
const MC_LOGIN = 'https://api.minecraftservices.com/authentication/login_with_xbox'
const MC_PROFILE = 'https://api.minecraftservices.com/minecraft/profile'
const SCOPE = 'XboxLive.signin offline_access'

interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
  message: string
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

class MicrosoftAuth {
  private cancelFlag = false
  private polling = false
  private currentDeviceCode: string | null = null
  /**
   * v1.0.59 — single-flight token refresh. Every caller (startup, account
   * status check, Play) shares ONE in-flight refresh. Microsoft rotates the
   * refresh token on every refresh, so two concurrent requests using the
   * same token race: the first one wins and the rest get HTTP 400
   * invalid_grant — which made the launcher look like it "lost" its session
   * after every update restart (startup refresh + status check + Play all
   * fired at once).
   */
  private refreshInFlight: Promise<Account | null> | null = null
  /**
   * v1.0.59 — last time the refresh was genuinely rejected by Microsoft.
   * Cooldown guard: the renderer re-checks the account (which re-invokes
   * refreshIfNeeded) after every 'expired' event, so without this a dead
   * session would hammer AAD with a failing refresh and a fresh "Session
   * expired" toast on every cycle while the launcher stays open.
   */
  private lastRejectedAt = 0

  isConfigured(): boolean {
    return !!settingsManager.get().microsoftClientId || Boolean(BUILT_IN_CLIENT_ID)
  }

  /** Starts the flow. Returns immediately with the code so the UI can show it. */
  async startDeviceCode(): Promise<{ userCode: string; verificationUri: string; message: string }> {
    const clientId = settingsManager.get().microsoftClientId || BUILT_IN_CLIENT_ID
    if (!clientId) {
      throw Errors.notConfigured(
        'Microsoft authentication',
        'Register an Azure app and add its Client ID in Settings → Microsoft. See README.'
      )
    }

    logger.info('Starting Microsoft device-code authentication')
    const res = await postForm<DeviceCodeResponse>(`${AAD}/devicecode`, {
      client_id: clientId,
      scope: SCOPE
    })

    this.cancelFlag = false
    this.currentDeviceCode = res.device_code
    this.polling = true

        // Auto-open browser for the user
    try {
      shell.openExternal(res.verification_uri)
    } catch {}

    eventBus.emit('auth:code', {
      userCode: res.user_code,
      verificationUri: res.verification_uri,
      message: res.message
    })

    // Fire-and-forget polling; progress is pushed to the UI via events.
    void this.poll(res.device_code, res.interval, res.expires_in)

    return {
      userCode: res.user_code,
      verificationUri: res.verification_uri,
      message: res.message
    }
  }

  cancel(): void {
    this.cancelFlag = true
    this.polling = false
    logger.info('Authentication cancelled by user')
  }

  private async poll(deviceCode: string, interval: number, expiresIn: number): Promise<void> {
    const clientId = settingsManager.get().microsoftClientId || BUILT_IN_CLIENT_ID
    const deadline = Date.now() + expiresIn * 1000
    let currentInterval = Math.max(interval, 5)
    let lastPollAt = 0

    try {
      while (!this.cancelFlag && Date.now() < deadline) {
        const waitMs = Math.max(0, lastPollAt + currentInterval * 1000 - Date.now())
        if (waitMs > 0) await delay(waitMs)
        lastPollAt = Date.now()
        eventBus.emit('auth:state', { phase: 'waiting' })

        let res: TokenResponse
        try {
          res = await postForm<TokenResponse>(`${AAD}/token`, {
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            client_id: clientId,
            device_code: deviceCode
          })
        } catch (err: any) {
          // Microsoft returns authorization_pending as HTTP 400 while user hasn't entered code yet
          const body = err?.body as any
          const error = body?.error
          if (error === 'authorization_pending') {
            continue
          }
          if (error === 'slow_down') {
            currentInterval += 5
            continue
          }
          if (error === 'authorization_declined') {
            throw new LauncherError('AUTH_DECLINED', 'You declined the sign-in request.', 'Open the browser link again and approve the request.')
          }
          if (error === 'expired_token' || error === 'bad_verification_code') {
            throw new LauncherError('AUTH_EXPIRED', 'The sign-in code expired.', 'Start a new login and enter the new code.')
          }
          throw err
        }

        if (res.access_token && res.refresh_token) {
          logger.info('Device code approved — exchanging for Minecraft access')
          const account = await this.exchangeTokens(res.access_token, res.refresh_token, res.expires_in ?? 86400)
          await accountStore.set(account)
          this.polling = false
          // Emit the success event FIRST — a failure in bookkeeping (e.g.
          // writing recent activity) must never hide a successful login from
          // the UI (Part 13 root-cause e).
          eventBus.emit('auth:state', { phase: 'success', account })
          try {
            await settingsManager.addRecent('auth', `Signed in as ${account.profile?.name ?? 'Microsoft account'}`)
          } catch (err) {
            logger.exception('Could not record recent activity after login', err)
          }
          return
        }


      }

      if (!this.cancelFlag) {
        throw new LauncherError('AUTH_TIMEOUT', 'The sign-in timed out.', 'Start a new login.')
      }
    } catch (err) {
      this.polling = false
      logger.exception('Microsoft authentication failed', err)
      eventBus.emit('auth:error', {
        code: err instanceof LauncherError ? err.code : 'AUTH_FAILED',
        message: err instanceof Error ? err.message : String(err),
        hint: err instanceof LauncherError ? err.hint : undefined
      })
    }
  }

  /** XBL → XSTS → Minecraft token exchange. */
  private async exchangeTokens(accessToken: string, refreshToken: string, expiresIn: number): Promise<Account> {
    // 1. XBL
    logger.info('Exchanging for Xbox Live token...')
    const xblRes = await fetch(XBOX_AUTH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-xbl-contract-version': '1'
      },
      body: JSON.stringify({
        Properties: {
          AuthMethod: 'RPS',
          SiteName: 'user.auth.xboxlive.com',
          RpsTicket: `d=${accessToken}`
        },
        RelyingParty: 'http://auth.xboxlive.com',
        TokenType: 'JWT'
      })
    })
    const xbl = await xblRes.json() as { Token: string; DisplayClaims: { xui: { uhs: string }[] } }
    if (!xbl.Token) {
      logger.error('XBL response:', JSON.stringify(xbl))
      throw new LauncherError('AUTH_FAILED', 'Xbox Live authentication failed.', 'Your account may not have Xbox Live enabled.')
    }
    logger.info('XBL token obtained')

    // 2. XSTS
    logger.info('Exchanging for XSTS token...')
    const xstsRes = await fetch(XBOX_XSTS, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-xbl-contract-version': '1'
      },
      body: JSON.stringify({
        Properties: {
          SandboxId: 'RETAIL',
          UserTokens: [xbl.Token]
        },
        RelyingParty: 'rp://api.minecraftservices.com/',
        TokenType: 'JWT'
      })
    })
    const xsts = await xstsRes.json() as { Token: string; DisplayClaims: { xui: { uhs: string }[] }; Identity?: string; Error?: string; Message?: string; Redirect?: string }
    if (!xsts.Token) {
      logger.error('XSTS response:', JSON.stringify(xsts))
      // Check if user needs to sign up for Xbox
      if (xsts.Redirect) {
        throw new LauncherError('AUTH_XBOX_REQUIRED', 'Xbox Live account required.', `Please visit ${xsts.Redirect} to set up your Xbox profile first.`)
      }
      throw new LauncherError('AUTH_FAILED', 'XSTS authentication failed.', xsts.Message || 'Your account may not have Xbox Live or Minecraft.')
    }
    logger.info('XSTS token obtained')

    const uhs = xsts.DisplayClaims.xui[0].uhs

    // 3. Minecraft services
    logger.info('Authenticating with Minecraft services...')
    const mcRes = await fetch(MC_LOGIN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identityToken: `XBL3.0 x=${uhs};${xsts.Token}`
      })
    })
    const mc = await mcRes.json() as { access_token: string; expires_in: number; username: string; error?: string; errorMessage?: string }
    if (!mc.access_token) {
      logger.error('MC login response:', JSON.stringify(mc))
      throw new LauncherError('AUTH_FAILED', 'Minecraft authentication failed.', mc.errorMessage || 'You may not own Minecraft Java Edition.')
    }
    logger.info('Minecraft token obtained for: ' + mc.username)

    // 4. Profile
    let profile: AccountProfile | null = null
    try {
      const p = await getJson<{ id: string; name: string; skins?: AccountProfile['skins'] }>(MC_PROFILE, {
        headers: { Authorization: `Bearer ${mc.access_token}` }
      })
      profile = { id: p.id, name: p.name, skins: p.skins }
      logger.info(`Minecraft profile: ${p.name} (${p.id})`)
    } catch {
      logger.warn('Could not fetch Minecraft profile (account may own no copy of Minecraft)')
    }

    return {
      tokens: {
        accessToken: mc.access_token,
        refreshToken,
        expiresAt: Date.now() + mc.expires_in * 1000
      },
      profile,
      xboxUhs: uhs,
      lastRefreshedAt: iso()
    }
  }

  /**
   * Refresh the Minecraft bearer token when it is close to expiry.
   *
   * v1.0.59 — single-flight: concurrent callers share one refresh promise,
   * eliminating the refresh-token rotation race that made the launcher look
   * logged-out after every update restart. Transient network hiccups are
   * retried with backoff and never mark the session as expired; only a
   * genuine OAuth rejection (invalid_grant) does.
   */
  async refreshIfNeeded(): Promise<Account | null> {
    if (this.refreshInFlight) return this.refreshInFlight
    this.refreshInFlight = this.doRefresh()
    try {
      return await this.refreshInFlight
    } finally {
      this.refreshInFlight = null
    }
  }

  private async doRefresh(): Promise<Account | null> {
    const account = accountStore.get()
    if (!account) return null
    // Cooldown after a genuine rejection (see lastRejectedAt) — a dead
    // session must not re-hit AAD on every account re-check.
    if (Date.now() - this.lastRejectedAt < 2 * 60_000) return account
    const stillValid = account.tokens.expiresAt - Date.now() > 5 * 60_000
    if (stillValid) return account

    const clientId = settingsManager.get().microsoftClientId || BUILT_IN_CLIENT_ID
    if (!clientId) return account

    // A fresh-token recovery shared by every "the server said no" path: a
    // rotation race may already have stored new tokens while we were in
    // flight, so re-read the store before declaring the session expired.
    const useStoredIfFresh = (): Account | null => {
      const current = accountStore.get()
      if (current && current.tokens.expiresAt - Date.now() > 5 * 60_000) {
        logger.info('Refresh raced with another rotation — using the tokens already stored')
        return current
      }
      return null
    }

    // Bounded retry for genuine transient server conditions (429/5xx) with a
    // short per-request timeout — a momentary hiccup right after an update
    // restart must never force a re-login, but a dead network must not block
    // Play for minutes either. OAuth rejections (HTTP 400 with an error
    // body) are NOT retried.
    let lastErr: unknown
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        logger.info('Refreshing Microsoft session token')
        const res = await postForm<TokenResponse>(
          `${AAD}/token`,
          {
            grant_type: 'refresh_token',
            client_id: clientId,
            refresh_token: account.tokens.refreshToken,
            scope: SCOPE
          },
          { timeoutMs: 8_000 }
        )
        if (!res.access_token || !res.refresh_token) {
          // The server answered but refused the refresh — the session really
          // is dead and the user must sign in again.
          const stored = useStoredIfFresh()
          if (stored) return stored
          logger.warn('Token refresh rejected — user must sign in again')
          this.lastRejectedAt = Date.now()
          eventBus.emit('auth:state', { phase: 'expired' })
          return account
        }
        const updated: Account = {
          ...account,
          tokens: {
            accessToken: res.access_token,
            refreshToken: res.refresh_token,
            expiresAt: Date.now() + (res.expires_in ?? 86400) * 1000
          },
          lastRefreshedAt: iso()
        }
        await accountStore.set(updated)
        eventBus.emit('auth:state', { phase: 'refreshed', account: updated })
        logger.info('Microsoft session refreshed successfully')
        return updated
      } catch (err) {
        lastErr = err
        const e = err as { status?: number; body?: { error?: string } }
        const oauthError = e.body?.error
        const oauthRejected = e.status === 400 && typeof oauthError === 'string'
        if (oauthRejected) {
          // A 400 with an OAuth error means the refresh token is dead
          // (invalid_grant) — unless another refresh already rotated it and
          // stored fresh tokens while we were in flight.
          const stored = useStoredIfFresh()
          if (stored) return stored
          logger.warn(`Token refresh rejected by Microsoft (${oauthError}) — user must sign in again`)
          this.lastRejectedAt = Date.now()
          eventBus.emit('auth:state', { phase: 'expired' })
          return account
        }
        // Retry only real server-side transient conditions (429/5xx), the
        // same policy getJson uses — network/timeout failures stop
        // immediately so a launch is never blocked for minutes.
        const status = e.status
        const retriable = status === 429 || (status !== undefined && status >= 500 && status < 600)
        if (retriable && attempt < 2) {
          await new Promise((r) => setTimeout(r, 600 * Math.pow(2, attempt)))
          continue
        }
        break
      }
    }
    logger.exception(
      'Token refresh failed (transient)',
      lastErr instanceof Error ? lastErr : new Error(String(lastErr))
    )
    return account
  }

  async logout(): Promise<void> {
    await accountStore.clear()
    logger.info('User logged out')
  }
}

export const microsoftAuth = new MicrosoftAuth()
