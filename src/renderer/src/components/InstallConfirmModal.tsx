/**
 * Install confirmation dialog (shared by the Mods browser and the detail
 * page). Shown on a plain Install click for ANY content type (mods, resource
 * packs, data packs, shaders) BEFORE anything downloads.
 *
 * It resolves the item's REAL dependency declarations (full tree from
 * Modrinth, de-duplicated), shows each dependency's status — "Already
 * installed" vs "Will be installed" — and adapts its actions to reality:
 *   • No dependencies at all → a single "Install" button.
 *   • Missing dependencies → "Install with Dependencies" (primary) + "Install
 *     Only".
 *   • All dependencies already installed → "Install Only" (the list still
 *     shows exactly what the item depends on).
 * Holding Left Shift on Install bypasses this dialog (see call sites).
 */
import { useEffect, useState } from 'react'
import { useApp } from '../state/AppContext'
import { sound } from '../lib/sound'
import { Button, Spinner, Badge } from './ui'
import { ModIcon } from './ModIcon'
import { api, friendlyError } from '../lib/api'
import { normalizeTitle } from '../lib/text'
import { IconX, IconCheck, IconPuzzle } from './icons'
import type { InstallDepInfo, ProfileMod, ProjectDetail, ProjectVersionInfo } from '@shared/types'

export type InstallTarget = {
  provider: 'modrinth' | 'curseforge'
  projectId: string
  projectType: 'mod' | 'resourcepack' | 'datapack' | 'shader'
  /** Specific version (detail page Versions tab); empty = newest compatible. */
  versionId?: string
}

export function InstallConfirmModal({
  target,
  onClose,
  onInstalled
}: {
  target: InstallTarget
  onClose: () => void
  onInstalled: (mod: ProfileMod | null, summary?: { installed: string[]; skipped: string[] }) => void
}) {
  const { activeProfile, notify } = useApp()
  const [info, setInfo] = useState<{
    detail: ProjectDetail | null
    version: ProjectVersionInfo | null
    deps: InstallDepInfo[]
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'only' | 'deps' | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        if (!activeProfile) throw new Error('No profile selected.')
        const [detail, versions] = await Promise.all([
          api.content.detail({ provider: target.provider, projectId: target.projectId, projectType: target.projectType }),
          api.content.versions({ provider: target.provider, projectId: target.projectId, projectType: target.projectType })
        ])
        // Prefer a version compatible with the profile's MC version + loader
        // (packs aren't loader-specific), so the dialog never offers an
        // incompatible first hit. A pinned version that doesn't fit falls
        // back to the newest compatible one.
        const mc = activeProfile.minecraftVersion
        const loader = activeProfile.loader.type
        const compatible = versions.filter(
          (v) =>
            (v.gameVersions.length === 0 || v.gameVersions.includes(mc)) &&
            (target.projectType !== 'mod' ||
              v.loaders.length === 0 ||
              v.loaders.includes(loader) ||
              v.loaders.includes('any'))
        )
        const pinned = target.versionId ? versions.find((v) => v.id === target.versionId) : null
        const version = (pinned && compatible.some((v) => v.id === pinned.id) ? pinned : compatible[0]) ?? versions[0]
        if (!version) throw new Error('No compatible version of this project exists for this profile.')
        // Dependencies are only resolvable from Modrinth — CurseForge exposes
        // no dependency tree through the proxy, so CF items install alone.
        const deps =
          target.provider === 'modrinth'
            ? await api.mods.dependencies(activeProfile.id, target.projectId, version.id, target.projectType)
            : []
        if (!cancelled) setInfo({ detail, version, deps })
      } catch (err) {
        if (!cancelled) setError(friendlyError(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.projectId, target.versionId, target.projectType])
  const flattenDeps = (list: InstallDepInfo[]): InstallDepInfo[] =>
    list.flatMap((d) => [d, ...(d.children ?? [])])
  const allDeps = flattenDeps(info?.deps ?? [])
  const missing = allDeps.filter((d) => !d.installed)
  const missingRequired = missing.filter((d) => d.dependencyType === 'required')

  // v1.0.51 — cross-provider “already installed”: the same item installed
  // from Modrinth is recognized when browsing CurseForge (and vice versa) by
  // normalized title, so it can never be installed twice.
  const alreadyInstalled =
    activeProfile && info?.detail
      ? (activeProfile.mods.find((m) => {
          if (m.id === target.projectId || m.slug === target.projectId) return true
          const nt = normalizeTitle(info.detail?.title ?? '')
          return nt.length > 0 && normalizeTitle(m.title) === nt
        }) ?? null)
      : null

  const doInstall = async (withDeps: boolean) => {
    if (!activeProfile || !info || !info.version) return
    setBusy(withDeps ? 'deps' : 'only')
    try {
      if (withDeps && target.provider === 'modrinth') {
        const res = await api.mods.installWithDeps(activeProfile.id, target.projectId, info.version.id, target.projectType)
        onInstalled(res.mod, res)
        notify(
          'success',
          'Installed with dependencies',
          res.installed.join(', ') + (res.skipped.length > 0 ? ` — skipped: ${res.skipped.join('; ')}` : '')
        )
      } else {
        // Modrinth = the pinned version; CurseForge = the pinned file id —
        // both go through installVersion with the REAL provider now.
        const mod = await api.mods.installVersion(activeProfile.id, target.provider, target.projectId, info.version!.id, target.projectType, info.detail?.title)
        onInstalled(mod)
        // v1.0.35 — install-complete payoff with the success checkmark.
        sound.installComplete()
        notify('success', 'Installed', mod.title, { silent: true })
      }
      onClose()
    } catch (err) {
      notify('error', 'Could not install', friendlyError(err))
      setBusy(null) // keep the dialog open so the user can retry
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && busy === null && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h3>{loading ? 'Checking install…' : 'Confirm install'}</h3>
          {busy === null && (
            <button className="btn btn-icon" onClick={onClose} aria-label="Close">
              <IconX style={{ width: 16, height: 16 }} />
            </button>
          )}
        </div>
        <div className="modal-body">
          {loading ? (
            <div className="row" style={{ justifyContent: 'center', padding: '28px 0' }}>
              <Spinner lg />
            </div>
          ) : error ? (
            <div style={{ textAlign: 'center', padding: '18px 0' }}>
              <p style={{ color: 'var(--text-2)', fontSize: 13.5, marginBottom: 14 }}>{error}</p>
              <Button variant="ghost" onClick={onClose}>Close</Button>
            </div>
          ) : info ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Item summary */}
              <div className="row" style={{ gap: 12, alignItems: 'center' }}>
                <div className="mod-icon" style={{ width: 46, height: 46 }}>
                  {info.detail?.iconUrl ? (
                    <ModIcon src={info.detail.iconUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <IconPuzzle style={{ width: 20, height: 20 }} />
                  )}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {info.detail?.title ?? target.projectId}
                    {alreadyInstalled && (
                      <Badge variant="success">
                        <IconCheck style={{ width: 10, height: 10 }} /> Already installed with {alreadyInstalled.source === 'curseforge' ? 'CurseForge' : 'Modrinth'}
                      </Badge>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    {info.version?.versionNumber}
                    {info.version?.gameVersions[0] ? ` · MC ${info.version.gameVersions[0]}` : ''}
                    {info.version?.loaders[0] ? ` · ${info.version.loaders[0]}` : ''}
                  </div>
                </div>
              </div>

              {/* Dependencies */}
              <div>
                <div className="panel-title" style={{ fontSize: 12 }}>Dependencies</div>
                {allDeps.length === 0 ? (
                  <p style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 6 }}>
                    {target.provider === 'curseforge'
                      ? 'CurseForge does not expose dependency data — the item installs alone.'
                      : 'No additional dependencies required.'}
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8, maxHeight: 240, overflowY: 'auto' }}>
                    {allDeps.map((d) => (
                      <div key={d.projectId} className="install-dep-row">
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                            {d.title}
                            {d.dependencyType === 'optional' && <Badge>optional</Badge>}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                            {d.installed
                              ? 'Already installed'
                              : d.versionNumber
                                ? `Will be installed · ${d.versionNumber}`
                                : 'No compatible version for this profile'}
                          </div>
                        </div>
                        <Badge variant={d.installed ? 'success' : d.versionNumber ? 'accent' : 'danger'}>
                          {d.installed ? (
                            <><IconCheck style={{ width: 10, height: 10 }} /> Installed</>
                          ) : d.versionNumber ? (
                            'Will install'
                          ) : (
                            'Unavailable'
                          )}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {busy !== null && (
                <div className="row" style={{ gap: 8, color: 'var(--text-2)', fontSize: 12.5 }}>
                  <Spinner />
                  {busy === 'deps' ? 'Installing with dependencies — watch the Downloads section for per-item progress…' : 'Installing…'}
                </div>
              )}
            </div>
          ) : null}
        </div>
        {info && busy === null && (
          <div className="modal-foot">
            {alreadyInstalled ? (
              <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--text-2)' }}>
                This item is already installed in this profile (
                {alreadyInstalled.source === 'curseforge' ? 'CurseForge' : 'Modrinth'}) — installing it again would create a duplicate.
              </div>
            ) : (
              <div style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: 'var(--text-3)' }}>
                {allDeps.length === 0
                  ? target.provider === 'curseforge'
                    ? 'CurseForge does not expose dependency data — the item installs alone.'
                    : 'No additional dependencies required.'
                  : missingRequired.length > 0
                    ? 'Required dependencies are missing — install them for the item to work correctly.'
                    : missing.length > 0
                      ? 'Optional dependencies can be added with “with dependencies”.'
                      : 'All dependencies are already installed — the item installs alone.'}
              </div>
            )}
            <Button variant="ghost" onClick={onClose}>{alreadyInstalled ? 'Close' : 'Cancel'}</Button>
            {allDeps.length === 0 ? (
              /* No dependencies at all — one clean Install action. */
              <Button variant="primary" onClick={() => void doInstall(false)}>
                Install
              </Button>
            ) : missing.length > 0 ? (
              <>
                <Button
                  variant="ghost"
                  onClick={() => void doInstall(false)}
                  title={missingRequired.length > 0 ? 'Install the item alone — it may not work without its required dependencies' : 'Install only the item'}
                >
                  Install Only
                </Button>
                <Button variant="primary" onClick={() => void doInstall(true)}>
                  Install with Dependencies ({missing.length})
                </Button>
              </>
            ) : (
              /* Every dependency is already installed — Install Only is the
                 only action; the list above still shows what it depends on. */
              <Button variant="primary" onClick={() => void doInstall(false)}>
                Install Only
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
