/**
 * Asset index + object downloader.
 *
 * Downloads `assets/indexes/<id>.json`, then any missing object files from
 * `assets/objects/<xx>/<hash>` (the layout Minecraft expects for 1.7+).
 */
import path from 'node:path'
import fs from 'node:fs'
import { paths } from '../paths'
import { exists, mkdirp, sizeOf } from '../utils/fs'
import { getJson } from '../utils/http'
import { logger } from '../logs/logger'
import { runDownloadBatch, type DownloadItem } from './downloader'

const RESOURCE_BASE = 'https://resources.download.minecraft.net'

interface AssetIndexJson {
  objects: Record<string, { hash: string; size: number }>
}

export async function ensureAssets(assetIndex: { id: string; url: string }, id: string): Promise<string> {
  const indexFile = path.join(paths.assetsIndexes, `${assetIndex.id}.json`)
  if (!exists(indexFile)) {
    mkdirp(paths.assetsIndexes)
    const index = await getJson<AssetIndexJson>(assetIndex.url, { timeoutMs: 30_000 })
    fs.writeFileSync(indexFile, JSON.stringify(index, null, 2), 'utf-8')
  }

  const index = JSON.parse(fs.readFileSync(indexFile, 'utf-8')) as AssetIndexJson
  const objects = Object.values(index.objects)
  const items: DownloadItem[] = []

  for (const obj of objects) {
    const dest = path.join(paths.assetsObjects, obj.hash.slice(0, 2), obj.hash)
    if ((await sizeOf(dest)) >= obj.size) continue
    items.push({
      url: `${RESOURCE_BASE}/${obj.hash.slice(0, 2)}/${obj.hash}`,
      dest,
      expectedSize: obj.size,
      // The asset hash IS its sha1 — verify after download.
      expectedSha1: obj.hash
    })
  }

  await runDownloadBatch(items, { kind: 'assets', label: `Assets (${assetIndex.id})`, concurrency: 8 })

  // Some older asset indexes are "virtual" — Minecraft resolves them from
  // objects/ directly, which is exactly what we download. Nothing else to do.
  return paths.assets
}

export async function assetIndexIdFor(url: string): Promise<string> {
  // Extract id from url like .../1.21.json
  const match = url.match(/([^/]+)\.json$/)
  return match?.[1] ?? 'legacy'
}

export function assetDownloadCount(): Promise<number> {
  return Promise.resolve(0)
}
