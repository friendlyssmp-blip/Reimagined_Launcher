/**
 * v1.0.82 — Instance picker for the Games → Mods global browser.
 *
 * After clicking Install/Download on a browsed item (any content type, any
 * MC version), this modal asks WHICH instance should receive it:
 *   • searchable list of your instances (name, icon, MC version, loader)
 *   • loader gating: a Forge item can never be dropped into a Fabric
 *     instance (and vice versa); Vanilla instances can't take mods at all
 *   • per-instance version resolution: selecting an instance shows the exact
 *     version that WILL be installed for that instance's MC version/loader
 *     (real API resolution, nothing downloaded yet)
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../state/AppContext'
import { Modal, Button, Spinner, Badge, ProfileGlyph, TextInput } from './ui'
import { api, friendlyError } from '../lib/api'
import { sound } from '../lib/sound'
import { normalizeTitle } from '../lib/text'
import { IconCheck } from './icons'
import type { Profile, ProfileMod } from '@shared/types'

/** v1.0.83 — is this item already tracked as installed in a profile? Matches
 *  by real id / slug / normalized title so a Modrinth install is caught when
 *  browsing the same project on CurseForge (and vice versa). */
function matchInstalled(mods: ProfileMod[], t: PickTarget): boolean {
  if (t.projectType === 'world') return false
  return mods.some(
    (m) =>
      m.id === t.projectId ||
      m.slug === t.projectId ||
      (t.title !== undefined && normalizeTitle(m.title) === normalizeTitle(t.title))
  )
}

export type PickTarget = {
  provider: 'modrinth' | 'curseforge'
  projectId: string
  projectType: 'mod' | 'resourcepack' | 'datapack' | 'shader' | 'world'
  title?: string
  iconUrl?: string
  /** The loader facet the browse page was filtered with ('any' = no gate). */
  loaderFilter?: 'any' | 'fabric' | 'forge'
}

/** Why an instance can't take this item (null = allowed by the loader gate). */
function gateReason(target: PickTarget, p: Profile): string | null {
  if (target.projectType !== 'mod') return null // packs / worlds work anywhere
  if (target.loaderFilter && target.loaderFilter !== 'any' && p.loader.type !== target.loaderFilter) {
    return `This is a ${target.loaderFilter} item — "${p.name}" runs ${p.loader.type}.`
  }
  if (p.loader.type === 'vanilla') return 'This instance has no loader — mods need Fabric or Forge.'
  return null
}

export function PickInstanceModal({
  target,
  onClose
}: {
  target: PickTarget
  onClose: () => void
}) {
  const { profiles, activeProfile, notify, runGuarded, refreshProfiles, setModals } = useApp()
  const [q, setQ] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [versionFor, setVersionFor] = useState<Record<string, { versionNumber: string; versionId: string; error?: string }>>({})
  const [resolving, setResolving] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const resolveSeq = useRef(0)
  /* v1.0.86 - no duplicate installs: instances that already have this
     item are shown as Installed and can't be selected again. */
  const [installedIn, setInstalledIn] = useState<Record<string, boolean>>({})
  /* Load each instance's tracked mods once to flag duplicates (worlds skip). */
  useEffect(() => {
    if (target.projectType === 'world') return
    let active = true
    void (async () => {
      const map: Record<string, boolean> = {}
      await Promise.all(
        profiles.map(async (p) => {
          try {
            const mods = await api.mods.list(p.id)
            if (active) map[p.id] = matchInstalled(mods, target)
          } catch {
            /* leave unmarked — the backend still guards duplicates */
          }
        })
      )
      if (active) setInstalledIn(map)
    })()
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles, target.projectId, target.projectType])

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    return term ? profiles.filter((p) => p.name.toLowerCase().includes(term)) : profiles
  }, [profiles, q])

  /** Resolve the exact version for the clicked instance (real API, no download).
   *  A previously-failed resolve re-runs on the next click (retry). */
  const pick = async (p: Profile) => {
    setSelectedId(p.id)
    if (versionFor[p.id] && !versionFor[p.id].error) return
    const seq = ++resolveSeq.current
    setResolving(p.id)
    try {
      const v = await api.mods.previewVersion(p.id, target.provider, target.projectId, target.projectType)
      if (seq === resolveSeq.current) {
        setVersionFor((prev) => ({ ...prev, [p.id]: { versionNumber: v.versionNumber, versionId: v.versionId } }))
      }
    } catch (err) {
      if (seq === resolveSeq.current) {
        setVersionFor((prev) => ({ ...prev, [p.id]: { versionNumber: '', versionId: '', error: friendlyError(err) } }))
      }
    } finally {
      if (seq === resolveSeq.current) setResolving(null)
    }
  }

  /** Resolve (once) and remember the version for an instance. */
  const resolveVersion = async (p: Profile) => {
    const existing = versionFor[p.id]
    if (existing && !existing.error) return existing
    const v = await api.mods.previewVersion(p.id, target.provider, target.projectId, target.projectType)
    const entry = { versionNumber: v.versionNumber, versionId: v.versionId }
    setVersionFor((prev) => ({ ...prev, [p.id]: entry }))
    return entry
  }

  /** v1.0.82 — install into a specific instance (resolves the version first). */
  const installInto = async (p: Profile) => {
    setBusy(true)
    try {
            if (target.projectType === 'world') {
        const res = await api.mods.installWorld(p.id, target.projectId)
        sound.installComplete()
        notify('success', 'World installed', `"${res.title}" was added to "${p.name}".`)
      } else if (target.provider === 'curseforge') {
        const v = await resolveVersion(p)
        if (!v?.versionId) throw new Error('Could not resolve a compatible version.')
        await runGuarded('Install', () =>
          api.mods.installVersion(p.id, 'curseforge', target.projectId, v.versionId, target.projectType, target.title, )
        )
        sound.installComplete()
        notify('success', 'Installed', `Installed into "${p.name}".`)
      } else {
        const v = await resolveVersion(p)
        await runGuarded('Install', () =>
          api.mods.installWithDeps(p.id, target.projectId, v?.versionId, target.projectType, )
        )
        sound.installComplete()
        notify('success', 'Installed', `"${target.title ?? 'Item'}" added to "${p.name}".`)
      }
      void refreshProfiles()
      onClose()
    } catch (err) {
      notify('error', 'Could not install', friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  /* v1.0.86 - already-installed instances are simply not selectable. */
  const isDup = (p: Profile): boolean => target.projectType !== 'world' && installedIn[p.id] === true

  const install = async () => {
    const p = profiles.find((x) => x.id === selectedId)
    if (!p) return
    await installInto(p)
  }

  const selected = profiles.find((p) => p.id === selectedId) ?? null
  const selectedVersion = selectedId ? versionFor[selectedId] : undefined
  const canInstall =
    !!selected &&
    !gateReason(target, selected) &&
    !resolving &&
    !busy &&
    !!selectedVersion &&
    !selectedVersion.error

  return (
    <Modal
      title="Install into an instance"
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
          <div style={{ flex: 1, fontSize: 12, color: 'var(--text-3)', lineHeight: 1.45 }}>
            {selected ? (
              gateReason(target, selected) ? (
                <span style={{ color: 'var(--danger)' }}>{gateReason(target, selected)}</span>
              ) : selectedVersion?.error ? (
                <span style={{ color: 'var(--danger)' }}>{selectedVersion.error}</span>
              ) : resolving === selected.id ? (
                'Resolving the compatible version…'
              ) : selectedVersion?.versionNumber ? (
                <span style={{ color: 'var(--success-2)' }}>
                  <IconCheck style={{ width: 12, height: 12, verticalAlign: -1 }} /> Will install v{selectedVersion.versionNumber} for MC {selected.minecraftVersion} · {selected.loader.type}
                </span>
              ) : (
                'Select an instance above.'
              )
            ) : (
              'Choose which instance should receive this item.'
            )}
          </div>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={() => void install()} disabled={!canInstall}>
            {busy ? <Spinner /> : `Install${selectedVersion?.versionNumber ? ` v${selectedVersion.versionNumber}` : ''}`}
          </Button>
        </div>
      }
    >
      <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 12, lineHeight: 1.5 }}>
        <b>{target.title ?? target.projectId}</b> · {target.projectType === 'world' ? 'World' : target.provider === 'modrinth' ? 'Modrinth' : 'CurseForge'} ·{' '}
        {target.projectType}
        {target.projectType === 'mod' && target.loaderFilter && target.loaderFilter !== 'any' && <> · {target.loaderFilter} only</>}
      </div>

      {/* v1.0.82 — use-the-current-instance shortcut: one click installs into
          the instance you're already working on, skipping the list entirely. */}
      {activeProfile && !gateReason(target, activeProfile) && (
        <button
          className="inst-current-btn"
          onClick={() => {
            // v1.0.86 - already installed here: no duplicates, just blocked.
            if (isDup(activeProfile)) return
            void installInto(activeProfile)
          }}
          disabled={busy || isDup(activeProfile)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            width: '100%',
            padding: '11px 13px',
            marginBottom: 12,
            borderRadius: 11,
            border: '1px solid var(--accent-3)',
            background: 'var(--accent-soft)',
            color: 'var(--text-1)',
            cursor: 'pointer',
            textAlign: 'left'
          }}
        >
          <div
            className="profile-avatar"
            style={{ width: 34, height: 34, borderRadius: 8, background: 'hsl(' + (activeProfile.name.charCodeAt(0) * 37 % 360) + ', 60%, 45%)', flexShrink: 0 }}
          >
            <ProfileGlyph icon={activeProfile.icon} name={activeProfile.name} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>
              Use “{activeProfile.name}” — current instance
              {isDup(activeProfile) && <span style={{ marginLeft: 8 }}><Badge variant="success">Installed</Badge></span>}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
              {activeProfile.minecraftVersion} · {activeProfile.loader.type} — {isDup(activeProfile) ? 'already installed here' : 'installs right away'}
            </div>
          </div>
          {busy ? <Spinner /> : <IconCheck style={{ width: 15, height: 15, color: 'var(--accent-3)', flexShrink: 0 }} />}
        </button>
      )}

      <TextInput
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search your instances…"
        autoFocus
        style={{ marginBottom: 10 }}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 340, overflowY: 'auto' }}>
        {filtered.length === 0 && (
          <p style={{ fontSize: 12.5, color: 'var(--text-3)', padding: '18px 4px' }}>
            {profiles.length === 0 ? 'No instances yet — create one from Library → Instances.' : `No instance matches "${q}".`}
          </p>
        )}
        {filtered.map((p) => {
          const blocked = gateReason(target, p)
          const dup = isDup(p)
          const v = versionFor[p.id]
          const isSel = selectedId === p.id
          return (
            <button
              key={p.id}
              className={`inst-pick-row${isSel ? ' selected' : ''}${blocked ? ' blocked' : ''}`}
              onClick={() => {
                // v1.0.86 - already installed here: not selectable, no duplicates.
                if (dup) return
                void pick(p)
              }}
              disabled={!!blocked || dup || busy}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                padding: '9px 11px',
                borderRadius: 10,
                border: isSel ? '1px solid var(--accent-3)' : '1px solid var(--border)',
                background: isSel ? 'var(--accent-soft)' : 'var(--bg-3)',
                color: 'var(--text-1)',
                textAlign: 'left',
                cursor: blocked ? 'not-allowed' : 'pointer',
                opacity: blocked ? 0.55 : 1
              }}
              title={blocked ?? (dup ? 'Already installed in this instance' : v?.error ? v.error : undefined)}
            >
              <div
                className="profile-avatar"
                style={{ width: 34, height: 34, borderRadius: 8, background: 'hsl(' + (p.name.charCodeAt(0) * 37 % 360) + ', 60%, 45%)', flexShrink: 0 }}
              >
                <ProfileGlyph icon={p.icon} name={p.name} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {p.name}
                  {blocked && <span style={{ marginLeft: 8, fontWeight: 500, fontSize: 11, color: 'var(--danger)' }}>{blocked}</span>}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 3, flexWrap: 'wrap' }}>
                  <Badge>{p.minecraftVersion}</Badge>
                  <Badge variant="accent">{p.loader.type}</Badge>
                  {dup && <Badge variant="success">Installed</Badge>}
                  {isSel && !blocked && (
                    <span style={{ fontSize: 11.5, color: resolving === p.id ? 'var(--text-3)' : v?.error ? 'var(--danger)' : 'var(--success-2)', fontWeight: 600 }}>
                      {resolving === p.id ? (
                        'Resolving…'
                      ) : v?.error ? (
                        `No compatible version`
                      ) : v?.versionNumber ? (
                        `v${v.versionNumber} for MC ${p.minecraftVersion}`
                      ) : (
                        'Click to resolve'
                      )}
                    </span>
                  )}
                </div>
              </div>
              {isSel && !blocked && <IconCheck style={{ width: 15, height: 15, color: 'var(--accent-3)', flexShrink: 0 }} />}
            </button>
          )
        })}
      </div>
    </Modal>
  )
}
