/**
 * Profile share & import (Part 1/2 of the additive pass).
 *
 * A profile's *setup* can be shared two ways, both built from the exact same
 * immutable snapshot:
 *
 *   1. EXPORT AS .ZIP — a small package (manifest + README) written to disk
 *      that the receiver imports offline until the install step runs.
 *   2. ONLINE CODE — the same snapshot stored in `data/share-codes.json`
 *      behind a unique, non-guessable code valid for exactly 7 days.
 *
 * Imports always create a brand-new independent profile and re-resolve every
 * item from its original source (Modrinth / CurseForge). Items that can no
 * longer be resolved are skipped and reported — the import never fails as a
 * whole. Account data, worlds, saves and screenshots are never shared.
 */
import path from 'node:path'
import fsp from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { paths } from '../paths'
import { exists, readJson, writeJson, mkdirp } from '../utils/fs'
import { zipCreate, zipReadEntry } from '../utils/zip'
import { profileManager } from '../profiles/profile-manager'
import { modManager } from '../mods/mod-manager'
import { eventBus } from '../core/event-bus'
import { logger } from '../logs/logger'
import { LauncherError } from '../core/errors'
import { iso } from '../utils/format'
import type { ShareSnapshot, ShareItem } from '@shared/types'

const CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const MANIFEST_NAME = 'reimagined-manifest.json'
const FORMAT_VERSION = 1

interface StoredRecord extends ShareSnapshot {
  code: string
}

function shareFile(): string {
  return path.join(paths.data, 'share-codes.json')
}

async function readRecords(): Promise<Record<string, StoredRecord>> {
  try {
    return await readJson<Record<string, StoredRecord>>(shareFile(), {})
  } catch {
    return {}
  }
}

async function writeRecords(records: Record<string, StoredRecord>): Promise<void> {
  await writeJson(shareFile(), records)
}

/** Drop expired codes so the store never grows stale. */
function pruneExpired(records: Record<string, StoredRecord>): boolean {
  let changed = false
  const now = Date.now()
  for (const code of Object.keys(records)) {
    const rec = records[code]
    if (rec.expiresAt && new Date(rec.expiresAt).getTime() < now) {
      delete records[code]
      changed = true
    }
  }
  return changed
}

/**
 * Build the immutable, portable description of a profile's setup. Every item
 * (mod, resource pack, data pack, shader) keeps its source + version so the
 * receiving launcher can re-download the exact same files.
 */
export async function prepareSnapshot(profileId: string): Promise<ShareSnapshot> {
  const profile = await profileManager.get(profileId)
  if (!profile) throw new LauncherError('PROFILE_MISSING', 'Profile not found.')

  const items: ShareItem[] = (profile.mods ?? []).map((m) => ({
    id: m.id,
    title: m.title,
    source: m.source,
    projectType: m.projectType,
    versionId: m.versionId,
    versionNumber: m.versionNumber,
    disabled: m.disabled
  }))

  return {
    schema: 'reimagined-profile',
    formatVersion: FORMAT_VERSION,
    name: profile.name,
    minecraftVersion: profile.minecraftVersion,
    loader: profile.loader,
    memory: profile.memory,
    resolution: profile.resolution,
    items,
    createdAt: iso()
  }
}

/** Validate a parsed manifest, returning a typed snapshot or a clear error. */
function validateSnapshot(raw: unknown): ShareSnapshot {
  const snap = raw as ShareSnapshot | null
  if (!snap || snap.schema !== 'reimagined-profile') {
    throw new LauncherError(
      'NOT_SHARE_EXPORT',
      "This doesn't look like a Reimagined profile export.",
      'Expected a package containing a reimagined-manifest.json file.'
    )
  }
  if (!snap.name || !snap.minecraftVersion || !Array.isArray(snap.items)) {
    throw new LauncherError('SHARE_CORRUPT', 'This profile export is corrupted or incomplete.')
  }
  return snap
}

/* ------------------------------- ZIP export ------------------------------- */

/**
 * Write a profile's snapshot to a .zip (manifest + README). Small, portable,
 * and always re-fetches fresh mod files on import.
 */
export async function exportZip(profileId: string, savePath: string): Promise<void> {
  const snapshot = await prepareSnapshot(profileId)
  const manifest = Buffer.from(JSON.stringify(snapshot, null, 2), 'utf-8')
  const readme = Buffer.from(
    [
      'REIMAGINED PROFILE EXPORT',
      '=======================',
      '',
      `Profile: ${snapshot.name}`,
      `Minecraft: ${snapshot.minecraftVersion}`,
      `Loader: ${snapshot.loader.type}${snapshot.loader.version ? ` (${snapshot.loader.version})` : ''}`,
      `Items: ${snapshot.items.length}`,
      `Created: ${snapshot.createdAt}`,
      '',
      'Import this file with: Profiles → New Profile → Import → Import from .zip',
      'No account data, worlds or personal information are included.',
      ''
    ].join('\n'),
    'utf-8'
  )
  const zip = zipCreate([
    { name: MANIFEST_NAME, data: manifest },
    { name: 'README.txt', data: readme }
  ])
  mkdirp(path.dirname(savePath))
  await fsp.writeFile(savePath, zip)
  logger.info(`Profile exported to .zip: "${snapshot.name}" → ${savePath} (${snapshot.items.length} items)`)
}

/** Open a save dialog and export the profile to the chosen location. */
export async function exportZipWithDialog(profileId: string): Promise<{ canceled: true } | { canceled: false; path: string; name: string }> {
  const profile = await profileManager.get(profileId)
  if (!profile) throw new LauncherError('PROFILE_MISSING', 'Profile not found.')
  const { dialog: electronDialog } = await import('electron')
  const showSaveDialog = electronDialog.showSaveDialog.bind(electronDialog)
  const safeName = (profile.name || 'profile').replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'profile'
  const result = await showSaveDialog({
    title: 'Export Reimagined profile',
    defaultPath: `${safeName}-reimagined.zip`,
    filters: [{ name: 'Reimagined profile', extensions: ['zip'] }]
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  await exportZip(profileId, result.filePath)
  return { canceled: false, path: result.filePath, name: profile.name }
}

/** Read + validate a Reimagined export .zip and return its snapshot. */
export async function readZip(zipPath: string): Promise<ShareSnapshot> {
  if (!exists(zipPath)) {
    throw new LauncherError('FILE_MISSING', 'The selected file no longer exists.')
  }
  const buf = await fsp.readFile(zipPath)
  const manifest = zipReadEntry(buf, MANIFEST_NAME)
  if (!manifest) {
    throw new LauncherError(
      'NOT_SHARE_EXPORT',
      "This doesn't look like a Reimagined profile export.",
      'Expected a .zip containing a reimagined-manifest.json file.'
    )
  }
  try {
    return validateSnapshot(JSON.parse(manifest.toString('utf-8')))
  } catch (err) {
    if (err instanceof LauncherError) throw err
    throw new LauncherError('SHARE_CORRUPT', 'This profile export is corrupted or unreadable.')
  }
}

/* ------------------------------ Online codes ------------------------------ */

/**
 * Store the profile's snapshot behind a unique code valid for 7 days.
 * Editing the original profile afterwards never changes what the code
 * resolves to (the snapshot is fixed at generation time).
 */
export async function createCode(profileId: string): Promise<{ code: string; expiresAt: string; snapshot: ShareSnapshot }> {
  const snapshot = await prepareSnapshot(profileId)
  const records = await readRecords()
  pruneExpired(records)

  let code = ''
  for (let attempt = 0; attempt < 5; attempt++) {
    code = randomBytes(8).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 11).toUpperCase()
    if (!records[code]) break
    code = ''
  }
  if (!code) throw new LauncherError('SHARE_FAILED', 'Could not generate a unique share code. Try again.')

  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString()
  records[code] = { ...snapshot, code, expiresAt, profileId }
  await writeRecords(records)
  logger.info(
    `Share code created for "${snapshot.name}" (${code}) — ${snapshot.items.length} items, expires ${expiresAt}`
  )
  return { code, expiresAt, snapshot }
}

/** Resolve a code to its exact snapshot, enforcing the 7-day expiry. */
export async function resolveCode(code: string): Promise<ShareSnapshot> {
  const key = (code ?? '').trim().toUpperCase()
  if (!key) throw new LauncherError('SHARE_NOT_FOUND', 'Enter a share code first.')
  const records = await readRecords()
  const rec = records[key]
  if (!rec) {
    throw new LauncherError(
      'SHARE_NOT_FOUND',
      'This share code is invalid or has expired.',
      'Codes are valid for 7 days after they are generated.'
    )
  }
  if (rec.expiresAt && new Date(rec.expiresAt).getTime() < Date.now()) {
    throw new LauncherError(
      'SHARE_EXPIRED',
      'This share code has expired.',
      'Codes are valid for 7 days after they are generated.'
    )
  }
  logger.info(`Share code resolved: "${rec.name}" (${rec.minecraftVersion}, ${rec.items.length} items)`)
  const { code: _code, profileId: _pid, ...snapshot } = rec
  return snapshot
}

/* -------------------------------- Importing ------------------------------- */

export interface ImportResult {
  profileId: string
  name: string
  skipped: string[]
}

/**
 * Create a brand-new independent profile from a snapshot and restore every
 * item from its original source, with step-by-step progress. Items that can
 * no longer be resolved are skipped and reported — never a hard failure.
 */
export async function importSnapshot(snapshot: ShareSnapshot): Promise<ImportResult> {
  const profile = await profileManager.create({
    name: snapshot.name,
    minecraftVersion: snapshot.minecraftVersion,
    loader: { type: snapshot.loader.type, version: snapshot.loader.version },
    memory: snapshot.memory,
    resolution: snapshot.resolution
  })

  const emit = (phase: string, percent: number | null) =>
    eventBus.emit('profile:progress', {
      action: 'import',
      profileId: profile.id,
      name: profile.name,
      phase,
      percent,
      done: false
    })

  emit('Setting up folders…', 8)
  const { mkdirp } = await import('../utils/fs')
  const pathMod = await import('node:path')
  for (const d of ['mods', 'saves', 'logs', 'resourcepacks', 'shaderpacks', 'datapacks']) {
    mkdirp(pathMod.join(paths.games, profile.gameDir, d))
  }

  const items = snapshot.items ?? []
  const skipped: string[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    emit(`Restoring ${item.title}…`, 15 + Math.round((i / Math.max(1, items.length)) * 80))
    try {
      if (item.source === 'curseforge') {
        await modManager.installCurseforge(
          profile.id,
          item.id,
          { title: item.title },
          (item.projectType ?? 'mod') as 'mod' | 'resourcepack' | 'shader' | 'datapack'
        )
      } else if (item.source === 'modrinth') {
        await modManager.install(
          profile.id,
          item.id,
          (item.projectType ?? 'mod') as 'mod' | 'resourcepack' | 'shader' | 'datapack'
        )
      } else {
        skipped.push(`${item.title} (local content — not included in share)`)
        continue
      }
      // A shared disabled item must stay disabled in the new profile.
      const installed = await profileManager.get(profile.id)
      const mod = installed?.mods.find((m) => m.id === item.id)
      if (item.disabled && mod) {
        await modManager.setEnabled(profile.id, mod.slug, false)
      }
    } catch (err) {
      logger.warn(`Import: could not restore "${item.title}": ${(err as Error).message}`)
      skipped.push(item.title)
    }
  }

  emit('Finalizing…', 97)
  const finalProfile = await profileManager.get(profile.id)
  eventBus.emit('profile:changed', { action: 'created', profile: finalProfile })
  eventBus.emit('profile:progress', { action: 'import', profileId: profile.id, name: profile.name, phase: 'Done', percent: 100, done: true })

  logger.info(
    `Profile imported: "${snapshot.name}" (${snapshot.minecraftVersion}) — ${items.length - skipped.length}/${items.length} items restored`
  )
  return { profileId: profile.id, name: profile.name, skipped }
}

/** Import by online code. */
export async function importCode(code: string): Promise<ImportResult> {
  const snapshot = await resolveCode(code)
  return importSnapshot(snapshot)
}

/** Import from an exported .zip file. */
export async function importZip(zipPath: string): Promise<ImportResult> {
  const snapshot = await readZip(zipPath)
  return importSnapshot(snapshot)
}

export const shareService = {
  prepareSnapshot,
  exportZip,
  exportZipWithDialog,
  readZip,
  createCode,
  resolveCode,
  importCode,
  importZip
}
