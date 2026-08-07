/** Small formatting / misc helpers. */

export function uuid(): string {
  // crypto.randomUUID is available in Node >= 19
  return globalThis.crypto.randomUUID()
}

export function timestamp(ms = Date.now()): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function dateStamp(ms = Date.now()): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function iso(ms = Date.now()): string {
  return new Date(ms).toISOString()
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/**
 * Human-readable duration, the same format everywhere playtime/durations are
 * shown (V2 pass): `45s` → `5m` → `15h 4m` → `1d 8h 6m`. Zero units are
 * never rendered, and durations are rounded up to the nearest minute so a
 * 1-second session never shows a confusing "0m".
 */
export function formatDuration(seconds: number): string {
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

export function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'profile'
}

export function timeAgo(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
