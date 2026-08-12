import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../state/AppContext'
import { Modal, Button, Spinner } from './ui'
import { api, friendlyError } from '../lib/api'
import { IconArchive, IconCheck } from './icons'
import type { Profile } from '@shared/types'

/**
 * Export profile as .zip (v1.0.81).
 *
 * Lets the user choose which instance folders travel inside the package as
 * REAL files. Mods, resource packs, shaders, data packs and worlds are
 * pre-checked; config, game settings, screenshots and logs are available
 * too. The archive always carries the manifest (setup) + README.
 */
const FOLDERS: { id: string; label: string; hint: string; default: boolean }[] = [
  { id: 'mods', label: 'Mods', hint: 'Installed mod JARs', default: true },
  { id: 'resourcepacks', label: 'Resource Packs', hint: 'Texture / resource packs', default: true },
  { id: 'shaderpacks', label: 'Shader Packs', hint: 'Iris / OptiFine shaders', default: true },
  { id: 'datapacks', label: 'Data Packs', hint: 'Datapacks copied into every world', default: true },
  { id: 'saves', label: 'Worlds (saves)', hint: 'Your singleplayer worlds', default: true },
  { id: 'config', label: 'Config', hint: 'Mod configuration files', default: false },
  { id: 'settings', label: 'Game Settings', hint: 'options.txt + multiplayer server list', default: false },
  { id: 'screenshots', label: 'Screenshots', hint: 'F2 screenshots', default: false },
  { id: 'logs', label: 'Logs', hint: 'Recent game logs', default: false }
]

/** 123456 → “120.6 KB” / “18.4 MB” / “1.2 GB”. */
function fmtBytes(b: number): string {
  if (!b || b <= 0) return ''
  if (b < 1024) return `${Math.round(b)} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function ExportZipModal({ profile }: { profile: Profile }) {
  const { setModals, notify } = useApp()
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(FOLDERS.filter((f) => f.default).map((f) => f.id))
  )
  const [sizes, setSizes] = useState<Record<string, number> | null>(null)
  const [busy, setBusy] = useState(false)
  const [savedPath, setSavedPath] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api.share
      .folderSizes(profile.id)
      .then((s) => {
        if (!cancelled) setSizes(s)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id])

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const allOn = selected.size === FOLDERS.length
  const totalBytes = useMemo(
    () => (sizes ? [...selected].reduce((sum, id) => sum + (sizes[id] ?? 0), 0) : 0),
    [selected, sizes]
  )

  const doExport = async () => {
    setBusy(true)
    try {
      const res = await api.share.exportZip(profile.id, [...selected])
      if ('canceled' in res && res.canceled) {
        notify('info', 'Export cancelled', 'No file was saved.')
      } else {
        const r = res as { path: string; name: string }
        setSavedPath(r.path)
        notify('success', 'Profile exported', `“${r.name}” saved with ${[...selected].length} folder(s) bundled.`)
      }
    } catch (err) {
      notify('error', 'Could not export profile', friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Export profile as .mrpack" onClose={() => setModals({ exportZip: null })} size="lg">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 2px' }}>
        <p style={{ color: 'var(--text-2)', fontSize: 13.5, lineHeight: 1.55 }}>
          Choose which folders of <strong>“{profile.name}”</strong> travel inside the package as real files.
          The result is a <strong>standard Modrinth modpack (.mrpack)</strong> — importable in Reimagined,
          the Modrinth App, Lunar Client, Prism and more. Deselect everything for a lightweight
          setup-only package.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
            {selected.size} of {FOLDERS.length} folders selected
            {totalBytes > 0 && <span style={{ fontFamily: 'var(--mono)' }}> · ≈ {fmtBytes(totalBytes)}</span>}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setSelected(allOn ? new Set() : new Set(FOLDERS.map((f) => f.id)))}>
            {allOn ? 'Clear all' : 'Select all'}
          </Button>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            maxHeight: 300,
            overflowY: 'auto',
            paddingRight: 4
          }}
        >
          {FOLDERS.map((f) => {
            const on = selected.has(f.id)
            const size = sizes ? (sizes[f.id] ?? 0) : null
            return (
              <label
                key={f.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 11,
                  padding: '9px 11px',
                  borderRadius: 10,
                  background: on ? 'var(--bg-3)' : 'transparent',
                  border: '1px solid var(--border)',
                  cursor: 'pointer',
                  transition: 'background .15s var(--ease), border-color .15s var(--ease)',
                  opacity: on ? 1 : 0.72
                }}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(f.id)}
                  style={{ flex: '0 0 auto', width: 16, height: 16, accentColor: 'var(--accent)' }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{f.label}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 1 }}>{f.hint}</div>
                </div>
                <span style={{ fontSize: 11.5, color: 'var(--text-3)', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>
                  {size === null ? '' : size === 0 ? 'empty' : fmtBytes(size)}
                </span>
              </label>
            )
          })}
        </div>

        <p style={{ color: 'var(--text-3)', fontSize: 12, lineHeight: 1.5 }}>
          The receiver imports the .zip and this launcher restores the bundled folders (worlds, mods,
          configs…) and downloads anything else from its original source. Account data is never included.
        </p>

        {savedPath && (
          <p style={{ color: 'var(--success)', fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6 }}>
            <IconCheck style={{ width: 13, height: 13, flex: '0 0 auto' }} />
            Saved to <span style={{ fontFamily: 'var(--mono)' }}>{savedPath}</span>
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 2 }}>
          <Button variant="ghost" onClick={() => setModals({ exportZip: null })} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={doExport} disabled={busy}>
            {busy ? (
              <>
                <Spinner /> Exporting…
              </>
            ) : (
              <>
                <IconArchive style={{ width: 14, height: 14 }} /> Export .mrpack
                {selected.size > 0 ? (
                  <span style={{ opacity: 0.75 }}>({selected.size})</span>
                ) : (
                  <span style={{ opacity: 0.75 }}>(setup only)</span>
                )}
              </>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
