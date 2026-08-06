import { useState } from 'react'
import { useApp } from '../state/AppContext'
import { Modal, Button, Field, TextInput, Badge, Spinner } from './ui'
import { api, friendlyError } from '../lib/api'
import { IconArchive, IconGlobe, IconChevronLeft } from './icons'
import type { ShareSnapshot } from '@shared/types'

type Stage = 'choose' | 'zip' | 'code' | 'preview'

const TYPE_LABELS: Record<string, string> = {
  mod: 'Mods',
  resourcepack: 'Resource Packs',
  datapack: 'Data Packs',
  shader: 'Shader Packs',
  modpack: 'Modpacks'
}

/**
 * Import Profile (Part 1).
 *
 * Two entry paths — “Import from .zip” and “Import with Code” — both lead to
 * the same preview screen showing exactly what will be created, then run the
 * full install pipeline into a brand-new independent profile.
 */
export function ImportModal() {
  const { setModals, notify, refreshProfiles } = useApp()
  const [stage, setStage] = useState<Stage>('choose')
  const [code, setCode] = useState('')
  const [zipPath, setZipPath] = useState<string | null>(null)
  const [preview, setPreview] = useState<ShareSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [importBusy, setImportBusy] = useState(false)

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

  const doImport = async () => {
    setImportBusy(true)
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
      notify('error', 'Could not import profile', friendlyError(err))
    } finally {
      setImportBusy(false)
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

              <Button variant="primary" onClick={doImport} disabled={importBusy} style={{ alignSelf: 'flex-start' }}>
                {importBusy ? <><Spinner /> Importing…</> : `Create “${preview.name}”`}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
