/**
 * Minecraft version resolution and installation.
 *
 * Talks to the official Mojang manifest + version JSONs, downloads the
 * client jar, required libraries (with OS rules and natives), asset index
 * and log4j config, then provides the classpath and natives directory the
 * launcher needs.
 */
import path from 'node:path'
import fs from 'node:fs'
import { execFile } from 'node:child_process'
import { paths } from '../paths'
import { exists, mkdirp, sizeOf, remove } from '../utils/fs'
import { getJson } from '../utils/http'
import { logger } from '../logs/logger'
import { runDownloadBatch, type DownloadItem } from './downloader'
import { ensureAssets } from './assets'
import type { MinecraftVersionSummary, DownloadKind } from '@shared/types'

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
const LIBRARY_BASE = 'https://libraries.minecraft.net'
const MANIFEST_CACHE_FILE = 'version-manifest.json'

interface Manifest {
  latest: { release: string; snapshot: string }
  versions: MinecraftVersionSummary[]
}

interface Artifact {
  path: string
  url: string
  sha1?: string
  size?: number
}

interface LibraryDownload {
  artifact?: Artifact
  classifiers?: Record<string, Artifact>
}

interface Library {
  name: string
  downloads?: LibraryDownload
  url?: string
  rules?: { action: 'allow' | 'disallow'; os?: { name?: string; arch?: string }; features?: Record<string, boolean> }[]
  natives?: Record<string, string>
}

interface VersionJson {
  id: string
  mainClass: string
  jar?: string
  inheritsFrom?: string
  type: string
  minecraftArguments?: string
  arguments?: {
    game?: (string | { rules?: unknown[]; value: string | string[] })[]
    jvm?: (string | { rules?: unknown[]; value: string | string[] })[]
  }
  libraries: Library[]
  assetIndex?: { id: string; url: string; sha1?: string; size?: number }
  downloads?: { client?: Artifact; server?: Artifact }
  javaVersion?: { majorVersion: number }
  logging?: { client?: { file: Artifact; argument?: string } }
}

/**
 * Load a version JSON following `inheritsFrom` chains (Forge installer
 * versions reference their base Minecraft version for client jar, asset
 * index and base libraries). Child values win; parent supplies the rest.
 */
async function loadVersionJsonResolved(vm: VersionManager, id: string): Promise<VersionJson> {
  // Prefer the local copy when the version is already installed (e.g. the
  // Forge installer wrote it) — avoids re-fetching on every launch.
  const localPath = path.join(paths.versions, id, `${id}.json`)
  let vj: VersionJson | null = null
  if (exists(localPath)) {
    try {
      vj = JSON.parse(fs.readFileSync(localPath, 'utf-8')) as VersionJson
    } catch {
      vj = null
    }
  }
  if (!vj) {
    const summary = await vm.getVersionSummary(id)
    if (!summary) throw new Error(`Unknown Minecraft version: ${id}`)
    vj = await getJson<VersionJson>(summary.url, { timeoutMs: 30_000 })
  }
  if (!vj.inheritsFrom) return vj

  const parent = await loadVersionJsonResolved(vm, vj.inheritsFrom)
  const merged: VersionJson = {
    ...parent,
    ...vj,
    // Libraries: parent (base MC) + child (loader-specific) — dedupe by name.
    libraries: [...(parent.libraries ?? []), ...(vj.libraries ?? [])].filter(
      (lib, i, arr) => arr.findIndex((l) => l.name === lib.name) === i
    ),
    // Client jar / assets come from the base version when the loader JSON
    // doesn't ship its own (e.g. Forge installer output).
    downloads: { ...(parent.downloads ?? {}), ...(vj.downloads ?? {}) },
    assetIndex: vj.assetIndex ?? parent.assetIndex,
    mainClass: vj.mainClass ?? parent.mainClass,
    javaVersion: vj.javaVersion ?? parent.javaVersion,
    logging: vj.logging ?? parent.logging,
    arguments: vj.arguments ?? parent.arguments,
    minecraftArguments: vj.minecraftArguments ?? parent.minecraftArguments
  }
  return merged
}

const OS = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux'
export const targetOs = OS

function archMatches(arch?: string): boolean {
  if (!arch) return true
  return arch === 'x86' ? process.arch === 'ia32' : process.arch === 'x64'
}
export const archMatchesCurrent = archMatches

/** Evaluate Mojang library rules for the current OS. */
export function libraryAllowed(lib: Library): boolean {
  if (!lib.rules) return true
  let allowed = false
  for (const rule of lib.rules) {
    let matches = true
    if (rule.os) {
      if (rule.os.name && rule.os.name !== OS) matches = false
      if (rule.os.arch && !archMatches(rule.os.arch)) matches = false
    }
    if (rule.features) {
      // We launch without demo, custom resolution or quick-play features.
      const features = Object.keys(rule.features)
      if (features.length > 0) matches = false
    }
    if (matches) allowed = rule.action === 'allow'
  }
  return allowed
}

class VersionManager {
  private manifest: Manifest | null = null
  private manifestFetchedAt = 0

  async fetchManifest(force = false): Promise<Manifest> {
    if (this.manifest && !force && Date.now() - this.manifestFetchedAt < 5 * 60_000) return this.manifest
    const cached = await this.readCachedManifest()
    try {
      const fresh = await getJson<Manifest>(MANIFEST_URL, { timeoutMs: 20_000 })
      this.manifest = fresh
      this.manifestFetchedAt = Date.now()
      void this.cacheManifest(fresh)
      return fresh
    } catch (err) {
      logger.warn(`Could not fetch version manifest (${(err as Error).message}); using cached copy`)
      if (cached) return cached
      throw err
    }
  }

  private async readCachedManifest(): Promise<Manifest | null> {
    try {
      const raw = fs.readFileSync(path.join(paths.games, MANIFEST_CACHE_FILE), 'utf-8')
      return JSON.parse(raw) as Manifest
    } catch {
      return null
    }
  }

  private async cacheManifest(m: Manifest): Promise<void> {
    try {
      fs.writeFileSync(path.join(paths.games, MANIFEST_CACHE_FILE), JSON.stringify(m), 'utf-8')
    } catch {
      /* non-fatal */
    }
  }

  async listVersions(): Promise<MinecraftVersionSummary[]> {
    const manifest = await this.fetchManifest()
    return manifest.versions
  }

  async getVersionSummary(id: string): Promise<MinecraftVersionSummary | null> {
    const manifest = await this.fetchManifest()
    return manifest.versions.find((v) => v.id === id) ?? null
  }

  async getVersionJson(id: string): Promise<VersionJson> {
    const summary = await this.getVersionSummary(id)
    if (!summary) throw new Error(`Unknown Minecraft version: ${id}`)
    return getJson<VersionJson>(summary.url, { timeoutMs: 30_000 })
  }

  /** Resolve a version JSON, merging `inheritsFrom` parents (Forge needs this). */
  async getResolvedVersionJson(id: string): Promise<VersionJson> {
    return loadVersionJsonResolved(this, id)
  }

  versionDir(id: string): string {
    return path.join(paths.versions, id)
  }

  isVersionInstalled(id: string): boolean {
    return exists(path.join(this.versionDir(id), `${id}.json`)) && exists(path.join(this.versionDir(id), `${id}.jar`))
  }

  /** Fetch + cache the version JSON to disk. */
  async ensureVersionJson(id: string): Promise<VersionJson> {
    const jsonPath = path.join(this.versionDir(id), `${id}.json`)
    if (exists(jsonPath)) {
      try {
        return JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as VersionJson
      } catch {
        /* fall through to re-download */
      }
    }
    const vj = await this.getVersionJson(id)
    mkdirp(this.versionDir(id))
    fs.writeFileSync(jsonPath, JSON.stringify(vj, null, 2), 'utf-8')
    return vj
  }

  /** ensureVersionJson but with `inheritsFrom` parents resolved at read time. */
  async ensureResolvedVersionJson(id: string): Promise<VersionJson> {
    const jsonPath = path.join(this.versionDir(id), `${id}.json`)
    if (exists(jsonPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as VersionJson
        if (raw.inheritsFrom) return loadVersionJsonResolved(this, id)
        return raw
      } catch {
        /* fall through to re-download */
      }
    }
    return this.getResolvedVersionJson(id)
  }

  /** Download the client jar into versions/<id>/<id>.jar. */
  async ensureClient(id: string): Promise<string> {
    const dest = path.join(this.versionDir(id), `${id}.jar`)
    const vj = await this.ensureVersionJson(id)

    if (!vj.downloads?.client) {
      // Some installer-produced versions (e.g. Forge) already ship the jar,
      // or the version resolves its client jar from an `inheritsFrom` parent.
      if ((await sizeOf(dest)) > 0) return dest
      // Last resort: try the resolved parent chain directly.
      const resolved = await loadVersionJsonResolved(this, id)
      if (!resolved.downloads?.client) {
        throw new Error(`Version ${id} has no client download`)
      }
      const artifact = resolved.downloads.client
      mkdirp(path.dirname(dest))
      await runDownloadBatch([{ url: artifact.url, dest, expectedSize: artifact.size, expectedSha1: artifact.sha1 }], {
        kind: 'client',
        label: `Minecraft ${id} client`
      })
      return dest
    }

    const artifact = vj.downloads.client
    if ((await sizeOf(dest)) >= (artifact.size ?? 1)) return dest
    mkdirp(path.dirname(dest))
    await runDownloadBatch([{ url: artifact.url, dest, expectedSize: artifact.size, expectedSha1: artifact.sha1 }], {
      kind: 'client',
      label: `Minecraft ${id} client`
    })
    return dest
  }

  /** Download every allowed library into libraries/<path>. Returns classpath entries. */
  async ensureLibraries(
    id: string,
    onKind: (kind: DownloadKind) => void
  ): Promise<{ classpath: string[]; nativesDir: string }> {
    const vj = await this.ensureResolvedVersionJson(id)
    const items: DownloadItem[] = []
    const classpath: string[] = []
    const nativesDir = path.join(this.versionDir(id), 'natives')

    for (const lib of vj.libraries) {
      if (!libraryAllowed(lib)) continue
      const artifact = lib.downloads?.artifact
      if (!artifact) continue
      const dest = path.join(paths.libraries, artifact.path)
      classpath.push(dest)
      items.push({ url: artifact.url, dest, expectedSize: artifact.size, expectedSha1: artifact.sha1 })

      // Natives (e.g. LWJGL DLLs) — extract into the natives dir.
      const nativeClassifier = lib.natives?.[OS]
      if (nativeClassifier) {
        const nativeArtifact = lib.downloads?.classifiers?.[nativeClassifier]
        if (nativeArtifact) {
          const nativeJar = path.join(paths.libraries, nativeArtifact.path)
          classpath.push(nativeJar)
          items.push({ url: nativeArtifact.url, dest: nativeJar, expectedSize: nativeArtifact.size, expectedSha1: nativeArtifact.sha1 })
        }
      }
    }

    // Fabric / installer-generated versions may reference extra libraries
    // without downloads entries — resolve them from the standard Maven URL.
    for (const lib of vj.libraries) {
      if (lib.downloads?.artifact) continue
      if (!libraryAllowed(lib)) continue
      const mavenPath = mavenPathFromName(lib.name)
      if (!mavenPath) continue
      const base = lib.url?.replace(/\/$/, '') ?? LIBRARY_BASE
      const dest = path.join(paths.libraries, mavenPath)
      classpath.push(dest)
      items.push({ url: `${base}/${mavenPath}`, dest })
    }

    await runDownloadBatch(items, { kind: 'libraries', label: `Libraries for ${id}`, concurrency: 6 })
    await this.extractNatives(id, nativesDir)
    return { classpath, nativesDir }
  }

  /** Extract natives jars (plain zip files) into the natives dir using `tar`. */
  private async extractNatives(id: string, nativesDir: string): Promise<void> {
    const vj = await this.ensureVersionJson(id)
    const nativesJars: string[] = []
    for (const lib of vj.libraries) {
      const nativeClassifier = lib.natives?.[OS]
      const nativeArtifact = nativeClassifier ? lib.downloads?.classifiers?.[nativeClassifier] : undefined
      if (nativeArtifact) nativesJars.push(path.join(paths.libraries, nativeArtifact.path))
    }
    if (nativesJars.length === 0) return

    mkdirp(nativesDir)
    const existing = fs.readdirSync(nativesDir)
    if (existing.some((f) => f.endsWith('.dll'))) return // already extracted

    for (const jar of nativesJars) {
      const st = fs.statSync(jar, { throwIfNoEntry: false })
      if (!st || st.size === 0) continue
      try {
        await new Promise<void>((resolve, reject) => {
          execFile(
            'tar',
            ['-xf', jar, '-C', nativesDir],
            { timeout: 60_000, windowsHide: true },
            (err) => (err ? reject(err) : resolve())
          )
        })
      } catch (err) {
        logger.warn(`Native extraction failed for ${jar} (${(err as Error).message}); relying on classpath natives`)
      }
    }
  }

  /** Download the log4j config used by the official launcher. */
  async ensureLog4jConfig(id: string): Promise<string | null> {
    const vj = await this.ensureVersionJson(id)
    const loggingFile = vj.logging?.client?.file
    if (!loggingFile) return null
    const dest = path.join(this.versionDir(id), 'log4j2.xml')
    if ((await sizeOf(dest)) >= (loggingFile.size ?? 1)) return dest
    await runDownloadBatch([{ url: loggingFile.url, dest, expectedSize: loggingFile.size }], {
      kind: 'log4j',
      label: `Log4j config for ${id}`
    })
    return dest
  }

  async ensureAssets(assetIndexId: string, assetIndex: { id: string; url: string }): Promise<string> {
    return ensureAssets(assetIndex, assetIndexId)
  }

  /** Fully ensure everything needed to launch a version. */
  async prepareVersion(id: string, onStage: (stage: DownloadKind) => void): Promise<{
    versionJson: VersionJson
    classpath: string[]
    nativesDir: string
    assetsDir: string
    log4jConfig: string | null
  }> {
    onStage('version')
    const vj = await this.ensureVersionJson(id)
    onStage('client')
    await this.ensureClient(id)
    onStage('libraries')
    const { classpath, nativesDir } = await this.ensureLibraries(id, onStage)
    onStage('assets')
    const assetIndex = vj.assetIndex
    if (!assetIndex) {
      throw new Error(`Version "${id}" has no asset index — cannot prepare assets.`)
    }
    const assetsDir = await this.ensureAssets(assetIndex.id, assetIndex)
    onStage('log4j')
    const log4jConfig = await this.ensureLog4jConfig(id)
    return { versionJson: vj, classpath, nativesDir, assetsDir, log4jConfig }
  }

  async installedVersions(): Promise<string[]> {
    const { listDir } = await import('../utils/fs')
    const dirs = await listDir(paths.versions)
    return dirs.filter((d) => this.isVersionInstalled(d))
  }
}

/** Convert a Maven coordinate `group:name:version[:classifier]` to a path. */
export function mavenPathFromName(name: string): string | null {
  const parts = name.split(':')
  if (parts.length < 3) return null
  const [group, artifact, version, classifier] = parts
  const base = group.replace(/\./g, '/')
  const file = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.jar`
  return `${base}/${artifact}/${version}/${file}`
}

export const versionManager = new VersionManager()
