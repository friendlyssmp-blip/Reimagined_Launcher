import { useEffect, useRef, useState } from 'react'
import { useApp } from '../state/AppContext'
import { Modal, Button, Field, TextInput, Badge, Spinner } from './ui'
import { api, friendlyError, ApiError } from '../lib/api'
import { IconArchive, IconGlobe, IconChevronLeft, IconX } from './icons'
import type { ShareSnapshot } from '@shared/types'

type Stage = 'choose' | 'zip' | 'code' | 'preview'

const TYPE_LABELS: Record<string, string> = {
  mod: 'Mods',
  resourcepack: 'Resource Packs',
  datapack: 'Data Packs',
  shader: 'Shader Packs',
  modpack: 'Modpacks'
}

/** 123456 → “120.6 KB” / “18.4 MB” / “1.2 GB”. */
function fmtBytes(b: number): string {
  if (!b || b <= 0) return '0 B'
  if (b < 1024) return `${Math.round(b)} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/** Seconds → “1.2s” / “45s” / “2m 5s”. */
function fmtEta(sec: number): string {
  if (!sec || !isFinite(sec) || sec < 0) return ''
  if (sec < 60) return `${sec.toFixed(1)}s`
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${s}s`
}

/**
 * Import Profile.
 *
 * Two entry paths — “Import from .zip” and “Import with Code” — both lead to
 * the same preview screen showing exactly what will be created, then run the
 * full install pipeline into a brand-new independent profile with real,
 * cancellable progress (v1.0.19). `initialCode` comes from a
 * `reimagined://share/<CODE>` deep link.
 */
export function ImportModal({ initialCode }: { initialCode?: string | null }) {
  const { setModals, notify, refreshProfiles } = useApp()
  const [stage, setStage] = useState<Stage>('choose')
  const [code, setCode] = useState(initialCode ?? '')
  const [zipPath, setZipPath] = useState<string | null>(null)
  const [preview, setPreview] = useState<ShareSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [importBusy, setImportBusy] = useState(false)
  const [progress, setProgress] = useState<{ phase: string; percent: number | null } | null>(null)
  /* Live byte-level download state (from download:progress) — real MB/s + ETA. */
  const [dl, setDl] = useState<{ label: string; received: number; total: number; speed: number } | null>(null)
  const dlSample = useRef({ at: 0, received: 0, speed: 0 })

  /* Deep link: a reimagined://share/<CODE> arrived → jump straight to preview. */
  useEffect(() => {
    if (!initialCode) return
    setCode(initialCode)
    setStage('code')
    setBusy(true)
    api.share
      .resolve(initialCode)
      .then((snap) => {
        setPreview(snap)
        setStage('preview')
      })
      .catch((err) => setError(friendlyError(err)))
      .finally(() => setBusy(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode])

  /* Live import progress from the main process (real per-item phases + bytes). */
  useEffect(() => {
    return api.onEvent((e) => {
      if (e.type === 'download:progress') {
        const p = e.payload as { label?: string; received?: number; totalBytes?: number } | null
        if (!p?.label) return
        const now = performance.now()
        const prev = dlSample.current
        const received = p.received ?? 0
        const speed =
          prev.at > 0 && now - prev.at >= 500 ? Math.max(0, (received - prev.received) / ((now - prev.at) / 1000)) : prev.speed
        dlSample.current = { at: now, received, speed }
        setDl({ label: p.label, received, total: p.totalBytes ?? 0, speed })
        return
      }
      if (e.type !== 'profile:progress') return
      const p = e.payload as { action?: string; phase?: string; percent?: number; done?: boolean } | null
      if (p?.action !== 'import') return
      if (p.done) {
        setProgress(null)
        setDl(null)
      } else {
        setProgress({ phase: p.phase ?? 'Working…', percent: p.percent ?? null })
      }
    })
  }, [])

  const close = () => setModals({ importShare: false })

  const pickZip = async () => {
    setError(null)
    try {
      const p = await api.share.pickZip()
      if (!p) return
      setBusy(true)
      try {
        const snap = await api.share.readZip(p)
        setZipPath(p)
        setPreview(snap)
        setStage('preview')
      } catch (err) {
        setError(friendlyError(err))
      } finally {
        setBusy(false)
      }
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  const resolveCode = async () => {
    const c = code.trim()
    if (!c) return
    setError(null)
    setBusy(true)
    try {
      const snap = await api.share.resolve(c)
      setPreview(snap)
      setStage('preview')
    } catch (err) {
      setError(friendlyError(err))
      setPreview(null)
    } finally {
      setBusy(false)
    }
  }

  const cancelImport = async () => {
    try {
      await api.share.cancelImport()
    } catch {
      /* the import may already be finishing — the main process still cleans up */
    }
  }

  const doImport = async () => {
    setImportBusy(true)
    setProgress({ phase: 'Starting import…', percent: 0 })
    try {
      const res = zipPath ? await api.share.importZip(zipPath) : await api.share.importCode(code.trim())
      await refreshProfiles()
      close()
      notify(
        res.skipped.length ? 'info' : 'success',
        res.skipped.length ? 'Profile imported with warnings' : 'Profile imported',
        res.skipped.length
          ? `“${res.name}” created — ${res.skipped.length} item(s) could not be restored and were skipped.`
          : `“${res.name}” is ready to play.`
      )
    } catch (err) {
      if (err instanceof ApiError && err.code === 'IMPORT_CANCELLED') {
        notify('info', 'Import cancelled', 'The partially-created profile was removed — your other profiles are untouched.')
        close()
      } else {
        notify('error', 'Could not import profile', friendlyError(err))
      }
    } finally {
      setImportBusy(false)
      setProgress(null)
      setDl(null)
    }
  }

  const grouped = new Map<string, number>()
  for (const item of preview?.items ?? []) {
    const key = TYPE_LABELS[item.projectType ?? 'mod'] ?? 'Content'
    grouped.set(key, (grouped.get(key) ?? 0) + 1)
  }

  return (
    <Modal title="Import Profile" onClose={close} size="lg">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '4px 2px' }}>
        {stage === 'choose' && (
          <>
            <p style={{ color: 'var(--text-2)', fontSize: 13.5, lineHeight: 1.55 }}>
              Import a shared profile setup into a brand-new local profile. Everything is downloaded
              fresh from its original source — version, loader and content.
            </p>
            <div className="share-actions">
              <button className="share-action clickable" onClick={pickZip}>
                <div className="share-action-icon"><IconArchive style={{ width: 20, height: 20 }} /></div>
                <div style={{ textAlign: 'left' }}>
                  <div className="share-action-title">Import from .zip</div>
                  <div className="share-action-sub">Pick a Reimagined export package saved on your PC.</div>
                </div>
                {busy ? <Spinner /> : <span className="share-action-arrow">→</span>}
              </button>
              <button className="share-action clickable" onClick={() => setStage('code')}>
                <div className="share-action-icon"><IconGlobe style={{ width: 20, height: 20 }} /></div>
                <div style={{ textAlign: 'left' }}>
                  <div className="share-action-title">Import with Code</div>
                  <div className="share-action-sub">Paste a share code (valid for 7 days after generation).</div>
                </div>
                <span className="share-action-arrow">→</span>
              </button>
            </div>
          </>
        )}

        {stage === 'code' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Button variant="ghost" size="sm" onClick={() => { setStage('choose'); setError(null) }}>
                <IconChevronLeft style={{ width: 14, height: 14 }} /> Back
              </Button>
              <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Import with Code</span>
            </div>
            <Field label="Share Code">
              <div style={{ display: 'flex', gap: 8 }}>
                <TextInput
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Paste the share code here"
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && resolveCode()}
                  style={{ flex: 1 }}
                />
                <Button onClick={resolveCode} disabled={!code.trim() || busy}>
                  {busy ? <Spinner /> : 'Preview'}
                </Button>
              </div>
            </Field>
            {error && <p style={{ color: 'var(--error)', fontSize: 13 }}>{error}</p>}
          </>
        )}

        {stage === 'preview' && preview && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Button variant="ghost" size="sm" onClick={() => { setStage(zipPath ? 'choose' : 'code'); setError(null) }}>
                <IconChevronLeft style={{ width: 14, height: 14 }} /> Back
              </Button>
              <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
                {zipPath ? `From .zip: ${zipPath.split(/[\\/]/).pop()}` : `Code: ${code.trim().toUpperCase()}`}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 17, fontWeight: 650 }}>{preview.name}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Badge variant="accent">Minecraft {preview.minecraftVersion}</Badge>
                  <Badge variant="accent">Loader: {preview.loader.type}</Badge>
                  <Badge>RAM: {preview.memory} MB</Badge>
                </div>
              </div>

              <div>
                <div className="share-card-title" style={{ marginBottom: 8 }}>
                  Content ({preview.items.length})
                </div>
                {preview.items.length === 0 ? (
                  <p style={{ color: 'var(--text-3)', fontSize: 13 }}>No content in this share.</p>
                ) : (
                  <ul className="share-list" style={{ maxHeight: 200, overflowY: 'auto' }}>
                    {preview.items.map((item, i) => (
                      <li key={i}>
                        {item.title}{' '}
                        <span style={{ color: 'var(--text-3)' }}>
                          · {item.source}{item.versionNumber ? ` ${item.versionNumber}` : ''}
                        </span>
                        {item.disabled && (
                          <span style={{ marginLeft: 6 }}><Badge variant="warn">disabled</Badge></span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {grouped.size > 1 && (
                  <p style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 6 }}>
                    {[...grouped.entries()].map(([k, v]) => `${v} ${k}`).join(' · ')}
                  </p>
                )}
              </div>

              <p style={{ color: 'var(--text-3)', fontSize: 12.5, lineHeight: 1.5 }}>
                This will download Minecraft {preview.minecraftVersion} with the {preview.loader.type} loader
                and re-resolve every item from its original source. No worlds or account data are transferred.
              </p>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Button variant="primary" onClick={doImport} disabled={importBusy} style={{ alignSelf: 'flex-start' }}>
                  {importBusy ? <><Spinner /> Importing…</> : `Create “${preview.name}”`}
                </Button>
                {importBusy && (
                  <Button variant="danger" size="sm" onClick={cancelImport} style={{ alignSelf: 'flex-start' }}>
                    <IconX style={{ width: 13, height: 13 }} /> Cancel
                  </Button>
                )}
              </div>
              {importBusy && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                    <span style={{ color: 'var(--text-2)', fontSize: 13 }}>{progress?.phase ?? 'Working…'}</span>
                    {progress?.percent != null && (
                      <span style={{ color: 'var(--accent)', fontSize: 13, fontFamily: 'var(--mono)' }}>{progress.percent}%</span>
                    )}
                  </div>
                  <div
                    style={{
                      height: 6,
                      borderRadius: 4,
                      background: 'var(--bg-4)',
                      overflow: 'hidden',
                      border: '1px solid var(--border)'
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.min(100, Math.max(0, progress?.percent ?? 0))}%`,
                        borderRadius: 4,
                        background: 'linear-gradient(90deg, var(--accent), var(--accent-2, var(--accent)))',
                        transition: 'width .25s ease'
                      }}
                    />
                  </div>
                  {dl && dl.received > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 2 }}>
                      <span
                        style={{
                          color: 'var(--text-2)',
                          fontSize: 12,
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        Downloading {dl.label}
                      </span>
                      <span style={{ color: 'var(--text-2)', fontSize: 12, fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>
                        {fmtBytes(dl.received)} / {dl.total > 0 ? fmtBytes(dl.total) : '…'}
                        {dl.speed > 0 && ` · ${fmtBytes(dl.speed)}/s`}
                        {dl.speed > 0 && dl.total > dl.received && ` · ETA ${fmtEta((dl.total - dl.received) / dl.speed)}`}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
