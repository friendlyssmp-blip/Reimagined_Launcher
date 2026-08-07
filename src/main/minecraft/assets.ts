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
  const count = objects.length
  const totalSize = objects.reduce((s, o) => s + o.size, 0)

  // v1.0.28 — launch-time regression fix. Every launch used to stat EVERY
  // object AND sha1-hash every present asset file (~1-2k files, ~1 GB of
  // reads) to "verify" them, even on a fully-cached profile. Assets are
  // sha1-verified when downloaded, so a present, full-size file is trusted.
  // A marker keyed to the index id + object count + total size records a
  // fully-verified set; it is re-verified at most weekly (self-heals rare
  // corruption without paying the cost on every single launch).
  const markerFile = path.join(paths.assetsIndexes, `${assetIndex.id}.verified.json`)
  try {
    const marker = JSON.parse(fs.readFileSync(markerFile, 'utf-8')) as { count?: number; totalSize?: number; at?: number }
    if (marker.count === count && marker.totalSize === totalSize && marker.at && Date.now() - marker.at < 7 * 86_400_000) {
      return paths.assets
    }
  } catch {
    /* no marker yet */
  }

  const items: DownloadItem[] = []
  for (const obj of objects) {
    const dest = path.join(paths.assetsObjects, obj.hash.slice(0, 2), obj.hash)
    // Size-only presence check — present/full-size objects are trusted (they
    // were sha1-verified at install time); missing or partial ones are
    // re-downloaded and verified by the batch below.
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

  // Batch succeeded = every object is now on disk and verified — record it.
  try {
    fs.writeFileSync(markerFile, JSON.stringify({ count, totalSize, at: Date.now() }, null, 2), 'utf-8')
  } catch {
    /* marker is best-effort */
  }

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
