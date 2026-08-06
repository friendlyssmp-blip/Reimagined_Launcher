/**
 * Account store.
 *
 * IMPORTANT SECURITY NOTE: we never store passwords. Only OAuth tokens are
 * persisted (required to re-authenticate silently), and they are encrypted
 * with Electron safeStorage (DPAPI on Windows / Keychain on macOS) before
 * touching disk — a raw dump of the data folder never leaks credentials.
 */
import { paths } from '../paths'
import { readJson, writeJson } from '../utils/fs'
import { encryptSecret, decryptSecret } from './secure-store'
import { logger } from '../logs/logger'
import type { Account } from '@shared/types'

/** Shape written to disk — secrets stored as base64 ciphertext. */
interface StoredAccount {
  tokens: { accessToken: string; refreshToken: string; expiresAt: number }
  profile: Account['profile']
  xboxUhs: string
  lastRefreshedAt: string
}

function toStored(account: Account): StoredAccount {
  return {
    tokens: {
      accessToken: encryptSecret(account.tokens.accessToken),
      refreshToken: encryptSecret(account.tokens.refreshToken),
      expiresAt: account.tokens.expiresAt
    },
    profile: account.profile,
    xboxUhs: encryptSecret(account.xboxUhs),
    lastRefreshedAt: account.lastRefreshedAt
  }
}

function fromStored(stored: StoredAccount): Account {
  return {
    tokens: {
      accessToken: decryptSecret(stored.tokens.accessToken),
      refreshToken: decryptSecret(stored.tokens.refreshToken),
      expiresAt: stored.tokens.expiresAt
    },
    profile: stored.profile ?? null,
    xboxUhs: decryptSecret(stored.xboxUhs ?? ''),
    lastRefreshedAt: stored.lastRefreshedAt
  }
}

class AccountStore {
  private account: Account | null = null
  private loaded = false

  async load(): Promise<Account | null> {
    if (this.loaded) return this.account
    try {
      const stored = await readJson<StoredAccount | null>(paths.accountsFile, null)
      this.account = stored ? fromStored(stored) : null
    } catch (err) {
      logger.error(`Could not load the saved account: ${(err as Error).message}`)
      this.account = null
    }
    this.loaded = true
    return this.account
  }

  get(): Account | null {
    return this.account
  }

  async set(account: Account): Promise<void> {
    this.account = account
    await writeJson(paths.accountsFile, toStored(account))
    logger.info('Account saved to disk (tokens encrypted)')
  }

  async clear(): Promise<void> {
    this.account = null
    await writeJson(paths.accountsFile, null)
    logger.info('Account removed from disk')
  }
}

export const accountStore = new AccountStore()
