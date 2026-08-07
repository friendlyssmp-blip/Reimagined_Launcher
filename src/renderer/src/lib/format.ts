/**
 * Shared renderer formatting helpers.
 *
 * `humanDuration` is THE one place playtime/durations are formatted in the
 * UI (V2 pass): `45s` -> `5m` -> `15h 4m` -> `1d 8h 6m`. Zero units are never
 * rendered, and sub-minute durations round up to a whole minute so a short
 * session never shows a confusing "0m".
 */

export function humanDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s`
  const totalM = Math.ceil(s / 60)
  const totalH = Math.floor(totalM / 60)
  const totalD = Math.floor(totalH / 24)
  if (totalD > 0) {
    const h = totalH % 24
    const m = totalM % 60
    return m > 0 ? `${totalD}d ${h}h ${m}m` : h > 0 ? `${totalD}d ${h}h` : `${totalD}d`
  }
  if (totalH > 0) {
    const m = totalM % 60
    return m > 0 ? `${totalH}h ${m}m` : `${totalH}h`
  }
  return `${totalM}m`
}

export function timeAgo(iso: string | null): string {
  if (!iso) return 'Never'
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function fmtBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`
  return `${bytes} B`
}
