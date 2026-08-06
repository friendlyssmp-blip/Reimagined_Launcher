import { useEffect, useState } from 'react'
import { useApp } from '../state/AppContext'
import { Modal, Button, Field, Spinner } from './ui'
import { api, friendlyError } from '../lib/api'
import { IconDownload, IconGlobe } from './icons'
import type { Profile, ShareSnapshot } from '@shared/types'

const TYPE_LABELS: Record<string, string> = {
  mod: 'Mods',
  resourcepack: 'Resource Packs',
  datapack: 'Data Packs',
  shader: 'Shader Packs',
  modpack: 'Modpacks'
}

function expiryLabel(expiresAt: string): string {
  const d = new Date(expiresAt)
  return (
    d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  )
}

/**
 * Share Profile panel (Part 2 — redesigned).
 *
 * The profile's setup is prepared once into an immutable snapshot, then the
 * user picks between two outputs built from that same snapshot:
 *   • Export as .zip — a small package saved anywhere on disk.
 *   • Generate Code — a unique code valid for exactly 7 days.
 * Never includes account data, worlds, saves or screenshots.
 */
export function ShareModal({ profile }: { profile: Profile }) {
  const { setModals, notify } = useApp()
  const [snapshot, setSnapshot] = useState<ShareSnapshot | null>(null)
  const [preparing, setPreparing] = useState(true)
  const [busy, setBusy] = useState<string | null>(null) // 'zip' | 'code'
  const [code, setCode] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [exportPath, setExportPath] = useState<string | null>(null)

  // Part 2 — prepare the shareable package once, then offer both outputs.
  useEffect(() => {
    let cancelled = false
    api.share
      .prepare(profile.id)
      .then((s) => {
        if (!cancelled) setSnapshot(s)
      })
      .catch((err) => notify('error', 'Could not prepare profile', friendlyError(err)))
      .finally(() => {
        if (!cancelled) setPreparing(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id])

  const copy = async () => {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      notify('success', 'Share code copied', 'Paste it in another launcher under “Import with Code”.')
    } catch {
      notify('info', 'Share code', code)
    }
  }

  const doExportZip = async () => {
    setBusy('zip')
    try {
      const res = await api.share.exportZip(profile.id)
      if ('canceled' in res && res.canceled) {
        notify('info', 'Export cancelled', 'No file was saved.')
      } else {
        const r = res as { path: string; name: string }
        setExportPath(r.path)
        notify('success', 'Profile exported', `“${r.name}” saved as a .zip package.`)
      }
    } catch (err) {
      notify('error', 'Could not export profile', friendlyError(err))
    } finally {
      setBusy(null)
    }
  }

  const doGenerateCode = async () => {
    setBusy('code')
    try {
      const res = await api.share.create(profile.id)
      setCode(res.code)
      setExpiresAt(res.expiresAt)
      notify('success', 'Share code generated', `Valid until ${expiryLabel(res.expiresAt)}.`)
    } catch (err) {
      notify('error', 'Could not generate share code', friendlyError(err))
    } finally {
      setBusy(null)
    }
  }

  const items = snapshot?.items ?? []
  const grouped = new Map<string, number>()
  for (const item of items) {
    const key = TYPE_LABELS[item.projectType ?? 'mod'] ?? 'Mods'
    grouped.set(key, (grouped.get(key) ?? 0) + 1)
  }

  return (
    <Modal title="Share Profile" onClose={() => setModals({ share: null })} size="lg">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '4px 2px' }}>
        <p style={{ color: 'var(--text-2)', fontSize: 13.5, lineHeight: 1.55 }}>
          Share the <strong>setup</strong> of “{profile.name}” — version, loader and content list —
          with another launcher. Everything is re-resolved from its original source; no files, no
          worlds, no account data.
        </p>

        {preparing && !snapshot ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '26px 0', justifyContent: 'center' }}>
            <Spinner />
            <span style={{ color: 'var(--text-2)', fontSize: 13.5 }}>Preparing your profile…</span>
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="share-card">
                <div className="share-card-title">Included</div>
                <ul className="share-list">
                  <li>Minecraft {profile.minecraftVersion}</li>
                  <li>Loader: {profile.loader.type}{profile.loader.version ? ` (${profile.loader.version})` : ''}</li>
                  <li>
                    {items.length === 0
                      ? 'No content installed'
                      : `${items.length} item(s): ${[...grouped.entries()].map(([k, v]) => `${v} ${k}`).join(', ')}`}
                  </li>
                  <li>RAM suggestion: {profile.memory} MB</li>
                </ul>
              </div>
              <div className="share-card share-card-muted">
                <div className="share-card-title">Never included</div>
                <ul className="share-list">
                  <li>Account credentials or tokens</li>
                  <li>Worlds / saves / screenshots</li>
                  <li>Any personal information</li>
                </ul>
              </div>
            </div>

            {!code ? (
              <div className="share-actions">
                <div className="share-action">
                  <div className="share-action-icon"><IconDownload style={{ width: 20, height: 20 }} /></div>
                  <div>
                    <div className="share-action-title">Export as .zip</div>
                    <div className="share-action-sub">A small package you can send anywhere — Discord, email, USB.</div>
                  </div>
                  <Button variant="primary" onClick={doExportZip} disabled={busy !== null} style={{ flex: '0 0 auto' }}>
                    {busy === 'zip' ? <><Spinner /> Exporting…</> : 'Export .zip'}
                  </Button>
                </div>
                <div className="share-action">
                  <div className="share-action-icon"><IconGlobe style={{ width: 20, height: 20 }} /></div>
                  <div>
                    <div className="share-action-title">Generate Code</div>
                    <div className="share-action-sub">A unique code valid for 7 days — the receiver imports it online.</div>
                  </div>
                  <Button variant="primary" onClick={doGenerateCode} disabled={busy !== null} style={{ flex: '0 0 auto' }}>
                    {busy === 'code' ? <><Spinner /> Generating…</> : 'Generate Code'}
                  </Button>
                </div>
              </div>
            ) : (
              <Field label="Share Code">
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <code className="share-code">{code}</code>
                  <Button onClick={copy}>Copy Code</Button>
                </div>
                <p style={{ color: 'var(--warning)', fontSize: 12, marginTop: 6 }}>
                  ⏳ Expires {expiresAt ? expiryLabel(expiresAt) : 'in 7 days'}
                </p>
                <p style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 4 }}>
                  This code is a fixed snapshot — editing “{profile.name}” later won't change what it resolves to.
                </p>
                <Button variant="ghost" size="sm" onClick={doExportZip} disabled={busy !== null} style={{ marginTop: 10 }}>
                  {busy === 'zip' ? <><Spinner /> Exporting…</> : 'Also export as .zip'}
                </Button>
              </Field>
            )}

            {exportPath && (
              <p style={{ color: 'var(--success)', fontSize: 12.5 }}>
                ✓ Saved to <span style={{ fontFamily: 'var(--mono)' }}>{exportPath}</span>
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
