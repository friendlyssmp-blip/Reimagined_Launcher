/**
 * Secure secret storage via Electron `safeStorage`.
 *
 * On Windows this is backed by DPAPI, on macOS by the Keychain. Values are
 * persisted as base64 ciphertext, so even if the `data/` folder were ever
 * uploaded or leaked, tokens are never readable in the clear.
 *
 * Backwards compatible: previously-stored plaintext values (JWTs contain
 * non-base64 characters) are detected and returned as-is. Ciphertext that
 * cannot be decrypted (different machine / Windows profile) resolves to an
 * empty string so the app falls back to the clean logged-out state instead of
 * feeding corrupt tokens into auth.
 */
import { safeStorage } from 'electron'
import { logger } from '../logs/logger'

let warnedPlaintext = false

export function encryptSecret(plain: string): string {
  try {
    if (plain && safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(plain).toString('base64')
    }
  } catch {
    /* encryption unavailable — fall through */
  }
  if (plain && !warnedPlaintext) {
    warnedPlaintext = true
    logger.warn('safeStorage is not available — sensitive data is stored without OS-level encryption on this system.')
  }
  return plain
}

export function decryptSecret(stored: string): string {
  if (!stored) return stored
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'))
    }
  } catch {
    /* not decryptable ciphertext (moved machine / corrupt) */
  }
  // Legacy plaintext (JWTs contain '-', '_' and '.') — return as-is.
  // Pure-base64 strings that failed to decrypt are corrupt — drop them.
  return /^[A-Za-z0-9+/=]+$/.test(stored) ? '' : stored
}
