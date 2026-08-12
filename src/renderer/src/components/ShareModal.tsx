import { useEffect, useState } from 'react'
import { useApp } from '../state/AppContext'
import { Modal, Button, Field, Spinner } from './ui'
import { api, friendlyError } from '../lib/api'
import { IconDownload, IconGlobe, IconHourglass } from './icons'
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
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState<string | null>(null)
  /* v1.0.85 — self-contained portable code: embeds the whole snapshot, works
     on any PC with no server. The reliable way to share across machines. */
  const [portable, setPortable] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)

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

  const copy = async (what: string, label: string) => {
    if (!what) return
    try {
      await navigator.clipboard.writeText(what)
      notify('success', label + ' copied', 'Paste it in another launcher under “Import with Code”.')
    } catch {
      notify('info', label, what)
    }
  }

  const copyLink = async () => {
    // v1.0.19 + v1.0.85: the link embeds the PORTABLE code, so opening it on
    // any launcher with reimagined:// registered resolves even with no server.
    const target = portable ?? code
    if (!target) return
    const link = `reimagined://share/${target}`
    try {
      await navigator.clipboard.writeText(link)
      notify('success', 'Share link copied', 'Opening it on any launcher with reimagined:// registered imports this profile — it works even without the share server.')
    } catch {
      notify('info', 'Share link', link)
    }
  }

  // v1.0.81 — exporting goes through the folder picker (worlds/mods/config…).
  const openExport = () => setModals({ exportZip: { profile } })

  const doGenerateCode = async () => {
    setBusy(true)
    try {
      const res = await api.share.create(profile.id)
      setCode(res.code)
      setPortable(res.portable)
      setExpiresAt(res.expiresAt)
      notify(
        'success',
        res.serverPublished ? 'Share code generated' : 'Share code generated (offline)',
        res.serverPublished
          ? `Valid until ${expiryLabel(res.expiresAt)} — works on any launcher.`
          : `Valid until ${expiryLabel(res.expiresAt)}. The share server was unreachable, so this code only works on this device for now.`
      )
    } catch (err) {
      notify('error', 'Could not generate share code', friendlyError(err))
    } finally {
      setBusy(false)
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
          Share <strong>“{profile.name}”</strong> with another launcher. A code always re-resolves the
          setup from its original source; a .zip can additionally bundle your real folders (worlds,
          mods, configs…) when you choose them.
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
                  <li>Any personal information</li>
                  <li>Files are only shared when you pick them in Export as .zip</li>
                </ul>
              </div>
            </div>

            {!code ? (
              <div className="share-actions">
                <div className="share-action">
                  <div className="share-action-icon"><IconDownload style={{ width: 20, height: 20 }} /></div>
                  <div>
                    <div className="share-action-title">Export as .mrpack</div>
                    <div className="share-action-sub">A standard Modrinth modpack — importable in Reimagined, the Modrinth App, Lunar Client or Prism. Choose which folders to include.</div>
                  </div>
                  <Button variant="primary" onClick={openExport} style={{ flex: '0 0 auto' }}>Export .mrpack</Button>
                </div>
                <div className="share-action">
                  <div className="share-action-icon"><IconGlobe style={{ width: 20, height: 20 }} /></div>
                  <div>
                    <div className="share-action-title">Generate Code</div>
                    <div className="share-action-sub">A unique code valid for 7 days — the receiver imports it online.</div>
                  </div>
                  <Button variant="primary" onClick={doGenerateCode} disabled={busy} style={{ flex: '0 0 auto' }}>
                    {busy ? <><Spinner /> Generating…</> : 'Generate Code'}
                  </Button>
                </div>
              </div>
            ) : (
              <Field label="Share Code">
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <code className="share-code">{code}</code>
                  <Button onClick={() => copy(code, 'Share code')}>Copy Code</Button>
                  <Button variant="ghost" onClick={copyLink}>Copy Link</Button>
                </div>
                <p style={{ color: 'var(--warning)', fontSize: 12, marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <IconHourglass style={{ width: 13, height: 13, flex: '0 0 auto' }} />
                  Expires {expiresAt ? expiryLabel(expiresAt) : 'in 7 days'}
                </p>
                <p style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 4 }}>
                  This code is a fixed snapshot — editing “{profile.name}” later won't change what it resolves to.
                </p>
                {portable && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 650, color: 'var(--text-1)', marginBottom: 6 }}>
                      Portable code — always works
                    </div>
                    <p style={{ color: 'var(--text-3)', fontSize: 12, lineHeight: 1.5, marginBottom: 8 }}>
                      This longer code contains the whole profile itself. It works on <b>any</b> PC, even
                      offline and even after the share server resets — use it when the short code fails on
                      another launcher, or send it as the <code className="mono">reimagined://</code> link.
                    </p>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <code className="share-code portable" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.5, fontSize: 11, maxHeight: 96, overflow: 'auto', flex: 1 }}>
                        {portable}
                      </code>
                      <Button onClick={() => copy(portable, 'Portable code')} style={{ flex: '0 0 auto' }}>Copy</Button>
                    </div>
                  </div>
                )}
                <Button variant="ghost" size="sm" onClick={openExport} style={{ marginTop: 10 }}>
                  Also export as .mrpack (choose folders)
                </Button>
              </Field>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
