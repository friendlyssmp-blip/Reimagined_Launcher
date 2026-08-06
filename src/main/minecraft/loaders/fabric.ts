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
const FABRIC_MAVEN = 'https://maven.fabricmc.net'

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
  const loaders = await getJson<FabricLoaderMeta[]>(`${FABRIC_META}/versions/loader/${mcVersion}`, {
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
    throw new Error(`No Fabric loader version exists for Minecraft ${mcVersion}.`)
  }
  return list[0]
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
  const res = await getJson<FabricInstallResponse>(
    `${FABRIC_META}/versions/loader/${mcVersion}/${loaderVersion}`,
    { timeoutMs: 20_000 }
  )
  const clientMain = res.launcherMeta.mainClass.client
  if (!clientMain) throw new Error(`Fabric loader ${loaderVersion} has no client main class`)

  const versionId = `${mcVersion}-fabric-${res.loader.version}`
  const versionDir = path.join(paths.versions, versionId)
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
