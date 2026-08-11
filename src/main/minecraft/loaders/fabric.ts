/**
 * Fabric loader support.
 *
 * Uses the official Fabric meta API to resolve loader versions and install
 * the loader libraries (loader + intermediary) into the shared libraries
 * folder, producing a patched version JSON ready to launch with KnotClient.
 */
import path from 'node:path'
import fs from 'node:fs'
import { paths } from '../../paths'
import { mkdirp, sizeOf, exists } from '../../utils/fs'
import { getJson } from '../../utils/http'
import { logger } from '../../logs/logger'
import { runDownloadBatch, type DownloadItem } from '../downloader'
import { mavenPathFromName, versionManager } from '../version-manager'

const FABRIC_META = 'https://meta.fabricmc.net/v2'
const LEGACY_FABRIC_META = 'https://meta.legacyfabric.net/v2'
const FABRIC_MAVEN = 'https://maven.fabricmc.net'

/**
 * v1.0.50 — Legacy Fabric ecosystem detection. Mainline Fabric Loader only
 * exists for Minecraft 1.14+; older versions (1.13.2 and below — the exact
 * range Legacy Fabric publishes) use the separate Legacy Fabric meta API,
 * whose response shape is identical to mainline's. The launcher decides
 * internally which implementation a Fabric profile needs.
 */
export function isLegacyFabricMc(mcVersion: string): boolean {
  const m = /^1\.(\d+)/.exec(mcVersion)
  if (!m) return false
  return Number(m[1]) < 14
}

function fabricMetaBase(mcVersion: string): string {
  return isLegacyFabricMc(mcVersion) ? LEGACY_FABRIC_META : FABRIC_META
}

interface FabricLoaderMeta {
  loader: { version: string; stable?: boolean }
  intermediary: { version: string }
  launcherMeta: unknown
}

interface FabricInstallResponse {
  loader: { version: string }
  intermediary: { version: string }
  launcherMeta: {
    /** The Fabric meta API returns libraries grouped by side — a client needs
     * the `client` + `common` groups, NOT a flat array. */
    libraries:
      | { name: string; url?: string }[]
      | { client?: { name: string; url?: string }[]; common?: { name: string; url?: string }[]; server?: { name: string; url?: string }[] }
    mainClass: { client?: string; server?: string }
  }
}

/** Normalize launcherMeta.libraries (object keyed by side, or a flat array). */
function fabricLibrariesForClient(meta: FabricInstallResponse['launcherMeta']): { name: string; url?: string }[] {
  const libs = meta.libraries
  if (Array.isArray(libs)) return libs
  return [...(libs.client ?? []), ...(libs.common ?? [])]
}

export async function getFabricLoaders(mcVersion: string): Promise<string[]> {
  // The game-version-scoped endpoint returns install objects shaped like
  // { loader: { version, stable }, intermediary, launcherMeta } — the loader
  // version lives under `.loader.version`, not on the item itself.
  const loaders = await getJson<FabricLoaderMeta[]>(`${fabricMetaBase(mcVersion)}/versions/loader/${mcVersion}`, {
    timeoutMs: 20_000
  })
  // Prefer stable, newest first
  return loaders
    .sort((a, b) => (a.loader.stable === b.loader.stable ? 0 : a.loader.stable ? -1 : 1))
    .slice(0, 40)
    .map((l) => l.loader.version)
    .filter(Boolean)
}

export async function latestFabricLoader(mcVersion: string): Promise<string> {
  const list = await getFabricLoaders(mcVersion)
  if (list.length === 0) {
    const eco = isLegacyFabricMc(mcVersion) ? 'Legacy Fabric' : 'Fabric'
    throw new Error(
      `No ${eco} loader version exists for Minecraft ${mcVersion} — this Minecraft version is not supported by ${eco}.`
    )
  }
  return list[0]
}

/**
 * v1.0.79 — resolve the loader version to USE for a Minecraft version.
 * A profile-pinned loader version is only honored when the Fabric meta API
 * actually lists it FOR THAT Minecraft version; a stale pin (e.g. copied from
 * another profile, or the user edited the profile's MC version without
 * touching the loader) falls back to the latest valid loader instead of
 * launching a broken environment. This is the guard that prevents the
 * classTweaker namespace crash class before it starts.
 */
export async function resolveFabricLoader(mcVersion: string, preferred?: string | null): Promise<string> {
  const loaders = await getFabricLoaders(mcVersion)
  if (loaders.length === 0) {
    const eco = isLegacyFabricMc(mcVersion) ? 'Legacy Fabric' : 'Fabric'
    throw new Error(
      `No ${eco} loader version exists for Minecraft ${mcVersion} — this Minecraft version is not supported by ${eco}.`
    )
  }
  if (preferred && loaders.includes(preferred)) return preferred
  if (preferred) {
    logger.warn(`Fabric loader ${preferred} is not valid for Minecraft ${mcVersion} — using ${loaders[0]} instead.`)
  }
  return loaders[0]
}

export interface InstalledFabric {
  versionId: string
  mainClass: string
  loaderVersion: string
}

/**
 * Install the Fabric loader for a Minecraft version.
 * Returns the synthetic version id, e.g. `1.21.4-fabric-0.16.9`.
 */
export async function installFabric(mcVersion: string, loaderVersion: string): Promise<InstalledFabric> {
  if (!loaderVersion) {
    throw new Error(`No Fabric loader version was resolved for Minecraft ${mcVersion}.`)
  }
  const versionId = `${mcVersion}-fabric-${loaderVersion}`
  const versionDir = path.join(paths.versions, versionId)

  // v1.0.28 — launch-time regression fix: on every launch this function
  // re-fetched the Fabric meta API AND re-downloaded/re-verified the loader
  // libraries even when the loader was already installed. When the version
  // JSON + the cached install metadata exist, reuse them (the loader jar is
  // verified on disk) — zero network on the cached path. Falls through to a
  // real install only when something is genuinely missing.
  const metaPath = path.join(versionDir, 'fabric-meta.json')
  const jsonPath = path.join(versionDir, `${versionId}.json`)
  if (exists(jsonPath) && exists(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as {
        loader?: { version?: string }
        launcherMeta?: {
          mainClass?: { client?: string }
          libraries?:
            | { name: string; url?: string }[]
            | { client?: { name: string; url?: string }[]; common?: { name: string; url?: string }[]; server?: { name: string; url?: string }[] }
        }
      }
      const clientMain = meta.launcherMeta?.mainClass?.client
      // Every library the loader needs must still be on disk — including the
      // loader artifact itself (KnotClient). If ANY is missing we fall through
      // to a full install that re-downloads it (old behavior self-healed).
      const libNames = fabricLibrariesForClient((meta.launcherMeta ?? { libraries: [] }) as FabricInstallResponse['launcherMeta']).map((l) => l.name)
      libNames.push(`net.fabricmc:fabric-loader:${loaderVersion}`)
      const rels = libNames.map((n) => mavenPathFromName(n)).filter((r): r is string => r !== null)
      const allPresent = rels.length > 0 && rels.every((rel) => exists(path.join(paths.libraries, rel)))
      if (clientMain && allPresent) {
        logger.info(`Fabric ${loaderVersion} already installed for ${mcVersion} (${versionId})`)
        return { versionId, mainClass: clientMain, loaderVersion: meta.loader?.version ?? loaderVersion }
      }
    } catch {
      /* cache unreadable — fall through to a full install */
    }
  }

  const res = await getJson<FabricInstallResponse>(
    `${fabricMetaBase(mcVersion)}/versions/loader/${mcVersion}/${loaderVersion}`,
    { timeoutMs: 20_000 }
  )
  const clientMain = res.launcherMeta.mainClass.client
  if (!clientMain) throw new Error(`Fabric loader ${loaderVersion} has no client main class`)

  mkdirp(versionDir)

  // 1) Cache the fabric install metadata locally.
  fs.writeFileSync(
    path.join(versionDir, 'fabric-meta.json'),
    JSON.stringify({ ...res, mcVersion, installedAt: new Date().toISOString() }, null, 2),
    'utf-8'
  )

  // 2) Download the loader's dependency libraries.
  const items: DownloadItem[] = []
  const clientLibs = fabricLibrariesForClient(res.launcherMeta)

  // The meta API's `launcherMeta.libraries` only lists the loader's
  // DEPENDENCIES — the `fabric-loader` artifact itself (which contains
  // KnotClient) is NOT included and must be added explicitly, exactly like
  // the official fabric-installer does. Without it Java fails with
  // "Could not find or load main class …KnotClient".
  const loaderLib = { name: `net.fabricmc:fabric-loader:${loaderVersion}`, url: FABRIC_MAVEN }
  // Drop any duplicate the meta response might ever include, then add ours.
  const deps = clientLibs.filter((l) => l.name !== loaderLib.name)
  const allLoaderLibs = [...deps, loaderLib]

  for (const lib of allLoaderLibs) {
    const rel = mavenPathFromName(lib.name)
    if (!rel) continue
    const base = (lib.url ?? FABRIC_MAVEN).replace(/\/$/, '')
    const dest = path.join(paths.libraries, rel)
    items.push({ url: `${base}/${rel}`, dest })
  }
  await runDownloadBatch(items, { kind: 'loader', label: `Fabric loader ${loaderVersion}` })

  // 3) Verify the loader jar actually landed on disk — a silent miss would
  // make the game exit with code 1 (missing KnotClient) with no useful log.
  const loaderRel = mavenPathFromName(loaderLib.name)
  if (loaderRel && !exists(path.join(paths.libraries, loaderRel))) {
    throw new Error(`Fabric loader ${loaderVersion} jar was not downloaded (${loaderRel})`)
  }

  // 4) Build a patched version JSON based on the vanilla one.
  const vanilla = (await versionManager.getVersionJson(mcVersion)) as unknown as Record<string, unknown>

  const patched = {
    ...vanilla,
    id: versionId,
    mainClass: clientMain,
    libraries: [
      ...(vanilla.libraries as unknown[]),
      ...deps.map((l) => ({ name: l.name, url: l.url ?? FABRIC_MAVEN })),
      loaderLib
    ]
  } as Record<string, unknown>

  fs.writeFileSync(path.join(versionDir, `${versionId}.json`), JSON.stringify(patched, null, 2), 'utf-8')
  logger.info(`Fabric ${loaderVersion} installed for ${mcVersion} (${versionId})`)
  return { versionId, mainClass: clientMain, loaderVersion: res.loader.version }
}
