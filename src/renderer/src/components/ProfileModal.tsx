import { useState, useEffect, useRef } from 'react'
import { useApp } from '../state/AppContext'
import { Modal, Button, Field, TextInput, Select, Slider } from './ui'
import { api, friendlyError } from '../lib/api'
import type { Profile, LoaderType } from '@shared/types'

const ICON_CHOICES = ['⛏️', '🏰', '⚔️', '🐉', '🌲', '⛺', '🔮', '⚡', '🎮', '🗺️', '🌟', '🛡️']

export function ProfileModal({ mode, profile }: { mode: 'create' | 'edit'; profile?: Profile }) {
  const { setModals, runGuarded, settings, notify, account } = useApp()
  const [name, setName] = useState(profile?.name ?? 'New Profile')
  const [icon, setIcon] = useState(profile?.icon ?? '')
  const [versions, setVersions] = useState<string[]>([])
  const [mcVersion, setMcVersion] = useState(profile?.minecraftVersion ?? '')
  const [loader, setLoader] = useState<LoaderType>(profile?.loader.type ?? 'vanilla')
  const [memory, setMemory] = useState(profile?.memory ?? 4096)
  const [javaPath, setJavaPath] = useState(settings.javaPath)
  const [extraJvmArgs, setExtraJvmArgs] = useState(profile?.extraJvmArgs ?? '')
  const [gameDir, setGameDir] = useState(profile?.gameDir ?? '')
  const [saving, setSaving] = useState(false)
  const [loadingVersions, setLoadingVersions] = useState(true)
  // Custom profile photo — stored as a data URL in `icon` (shown on cards).
  const [iconPreview, setIconPreview] = useState<string | null>(
    profile?.icon && profile.icon.startsWith('data:') ? profile.icon : null
  )
  const fileRef = useRef<HTMLInputElement | null>(null)
  // Loader VERSION selector — a specific Fabric/Forge build per MC version.
  const [loaders, setLoaders] = useState<{ fabric: string[]; forge: string[]; recommendedFabric: string | null; recommendedForge: string | null } | null>(null)
  const [loaderVersion, setLoaderVersion] = useState(profile?.loader.version ?? '')
  const [loaderVersionsLoading, setLoaderVersionsLoading] = useState(false)
  const [loaderVersionNote, setLoaderVersionNote] = useState<string | null>(null)
  const loaderVersionRef = useRef(loaderVersion)
  loaderVersionRef.current = loaderVersion

  // Edit-diff tracking — used to warn on loader changes and to re-run the
  // install pipeline when version/loader change (per the Edit spec).
  const originalLoader = profile?.loader.type ?? 'vanilla'
  const originalVersion = profile?.minecraftVersion ?? ''
  const versionChanged = mode === 'edit' && mcVersion !== '' && mcVersion !== originalVersion
  const loaderChanged = mode === 'edit' && loader !== originalLoader
  const loaderVersionChanged = mode === 'edit' && loader !== 'vanilla' && (loaderVersion || null) !== (profile?.loader.version || null)

  useEffect(() => {
    const loadDefaults = async () => {
      try {
        const [versionsList, recommendedMemory] = await Promise.all([
          api.versions.list(),
          mode === 'create' ? api.system.getMemory().catch(() => 4096) : Promise.resolve(profile?.memory ?? 4096)
        ])
        setVersions(versionsList)
        if (mode === 'create' && versionsList.length > 0 && !mcVersion) {
          setMcVersion(versionsList[0]) // First version is latest stable (sorted desc)
        }
        if (mode === 'create') {
          setMemory(recommendedMemory)
        }
      } catch {
        // Silently fail
      } finally {
        setLoadingVersions(false)
      }
    }
    loadDefaults()
  }, [mode, profile?.memory])

  // Fetch the loader version list whenever the loader or MC version changes.
  // If the current selection isn't valid for the new Minecraft version, reset
  // it to that version's recommended/latest option and tell the user.
  useEffect(() => {
    if (loader === 'vanilla' || !mcVersion) return
    let cancelled = false
    setLoaderVersionsLoading(true)
    api.versions
      .loadersFor(mcVersion)
      .then((res) => {
        if (cancelled) return
        setLoaders(res)
        const list = loader === 'fabric' ? res.fabric : res.forge
        const recommended = loader === 'fabric'
          ? res.recommendedFabric ?? list[0] ?? ''
          : res.recommendedForge ?? list[0] ?? ''
        const prev = loaderVersionRef.current
        const next = prev && list.includes(prev) ? prev : recommended
        if (next !== prev) {
          if (prev) {
            setLoaderVersionNote(
              `The selected ${loader === 'fabric' ? 'Fabric loader' : 'Forge'} version isn't available for ${mcVersion} — updated to the latest one.`
            )
          }
          setLoaderVersion(next)
        }
      })
      .catch(() => {
        if (!cancelled) setLoaders({ fabric: [], forge: [], recommendedFabric: null, recommendedForge: null })
      })
      .finally(() => {
        if (!cancelled) setLoaderVersionsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [loader, mcVersion])

  const onPickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 512 * 1024) {
      notify('error', 'Image too large', 'Use an image under 512 KB.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result ?? '')
      setIcon(url)
      setIconPreview(url)
    }
    reader.onerror = () => notify('error', 'Could not read image', 'The file could not be decoded.')
    reader.readAsDataURL(file)
  }

  const save = async () => {
    if (!name.trim() || !mcVersion) return
    setSaving(true)
    try {
      // Persist the Java path as the global default so it survives.
      if (javaPath !== settings.javaPath) {
        await runGuarded('Save Java path', () => api.settings.set({ javaPath }))
      }
      const storedLoaderVersion = loader === 'vanilla' ? null : (loaderVersion || null)
      if (mode === 'edit' && profile) {
        await runGuarded('Update profile', () =>
          api.profiles.update(profile.id, {
            name,
            icon: icon || null,
            minecraftVersion: mcVersion,
            loader: { type: loader, version: storedLoaderVersion },
            memory,
            extraJvmArgs
          })
        )
        // Version, loader TYPE or loader VERSION changed → re-run the install
        // pipeline for the NEW configuration into the SAME instance
        // (mods/saves/config untouched) — never leave a mixed loader state.
        if (versionChanged || loaderChanged || loaderVersionChanged) {
          notify(
            'info',
            loaderChanged ? 'Loader changed' : loaderVersionChanged ? 'Loader version changed' : 'Version changed',
            versionChanged
              ? `Preparing ${mcVersion}${loader !== 'vanilla' ? ` (${loader})` : ''} — your mods, saves and config are preserved.`
              : `Preparing ${loader}${loaderVersion ? ' ' + loaderVersion : ''} for ${mcVersion} — your mods, saves and config are preserved.`
          )
          try {
            await api.profiles.prepare(profile.id)
            notify('success', 'Profile ready', `${mcVersion}${loader !== 'vanilla' ? ` + ${loader}` : ''} is installed.`)
          } catch (err) {
            notify('error', 'Could not prepare new version', friendlyError(err))
          }
        }
      } else {
        // A profile can never be played without a session — redirect to sign-in.
        if (account.status === 'offline') {
          notify('info', 'Sign in required', 'Sign in with Microsoft before creating a profile.')
          setModals({ login: true })
          return
        }
        await runGuarded('Create profile', () =>
          api.profiles.create({
            name,
            icon: icon || null,
            minecraftVersion: mcVersion,
            loader: { type: loader, version: storedLoaderVersion },
            memory,
            resolution: { width: 1280, height: 720, fullscreen: false },
            extraJvmArgs
          })
        )
      }
      setModals({ profile: null })
    } catch (err) {
      notify('error', 'Profile save failed', friendlyError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={mode === 'edit' ? 'Edit Profile' : 'New Profile'}
      onClose={() => setModals({ profile: null })}
      size="lg"
      footer={
        <>
          <Button onClick={() => setModals({ profile: null })}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!name.trim() || !mcVersion || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 18px' }}>
        <Field label="Profile Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="My World" autoFocus />
        </Field>

        <Field label="Profile Icon" hint="Pick a preset icon or upload your own image (shown on the profile card).">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: 12,
                background: 'var(--bg-4)',
                border: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 22,
                overflow: 'hidden',
                flex: '0 0 auto'
              }}
            >
              {iconPreview ? (
                <img src={iconPreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : icon ? (
                <span>{icon}</span>
              ) : (
                <span style={{ color: 'var(--text-3)' }}>?</span>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
              <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>
                Upload image…
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setIcon(''); setIconPreview(null) }}>
                Remove
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                style={{ display: 'none' }}
                onChange={onPickImage}
              />
            </div>
          </div>
          <div className="segmented" style={{ flexWrap: 'wrap', gap: 4, padding: 6 }}>
            <button className={icon === '' ? 'active' : ''} onClick={() => setIcon('')}>None</button>
            {ICON_CHOICES.map((c) => (
              <button key={c} className={icon === c ? 'active' : ''} onClick={() => setIcon(c)} style={{ fontSize: 15 }}>{c}</button>
            ))}
          </div>
        </Field>

        <Field label="Minecraft Version">
          {loadingVersions ? (
            <div style={{ padding: '10px', color: 'var(--text-3)', fontSize: 13 }}>Loading versions…</div>
          ) : (
            <Select
              value={mcVersion}
              onChange={(e) => {
                // A loader version valid for the old MC version may not exist
                // for the new one — drop it now so a stale value can never be
                // saved; the effect refills the recommended one immediately.
                setLoaderVersion('')
                loaderVersionRef.current = ''
                setLoaderVersionNote(null)
                setMcVersion(e.target.value)
              }}
            >
              {versions.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Loader">
          <div className="segmented">
            {(['vanilla', 'fabric', 'forge'] as LoaderType[]).map((l) => (
              <button
                key={l}
                className={loader === l ? 'active' : ''}
                onClick={() => {
                  if (l !== loader) {
                    // Never carry a version picked for a different loader type
                    // into the new one (the async fetch would be too late if
                    // the user saves immediately).
                    setLoaderVersion('')
                    loaderVersionRef.current = ''
                    setLoaderVersionNote(null)
                  }
                  setLoader(l)
                }}
              >
                {l.charAt(0).toUpperCase() + l.slice(1)}
              </button>
            ))}
          </div>
        </Field>
      </div>

      {/* Loader version selector — only relevant when a loader is chosen. */}
      {loader !== 'vanilla' && (
        <Field
          label={loader === 'fabric' ? 'Fabric Loader Version' : 'Forge Version'}
          hint="Pick a specific loader build, or Auto for the latest compatible one."
        >
          {loaderVersionsLoading ? (
            <div style={{ padding: '10px', color: 'var(--text-3)', fontSize: 13 }}>Loading loader versions…</div>
          ) : (
            <Select
              value={loaderVersion}
              onChange={(e) => {
                setLoaderVersion(e.target.value)
                setLoaderVersionNote(null)
              }}
            >
              <option value="">Auto (latest {loader === 'fabric' ? 'stable' : 'recommended'})</option>
              {(loader === 'fabric' ? loaders?.fabric ?? [] : loaders?.forge ?? []).map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </Select>
          )}
          {loaderVersionNote && (
            <span className="field-hint" style={{ color: 'var(--warning)', display: 'block', marginTop: 6 }}>{loaderVersionNote}</span>
          )}
          {(loader === 'fabric' ? loaders?.fabric ?? [] : loaders?.forge ?? []).length === 0 && !loaderVersionsLoading && (
            <span className="field-hint" style={{ display: 'block', marginTop: 6 }}>
              No {loader === 'fabric' ? 'Fabric loader' : 'Forge'} versions were found for Minecraft {mcVersion} — the launcher will use the latest available automatically.
            </span>
          )}
        </Field>
      )}

      <div style={{ marginTop: 4 }}>
        <Slider value={memory} min={1024} max={16384} step={512} onChange={setMemory} label={`RAM Allocation (${memory}MB)`} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 18px', marginTop: 8 }}>
        <Field label="Java Path" hint="Optional — the launcher auto-detects the right runtime.">
          <div className="row">
            <TextInput value={javaPath} onChange={(e) => setJavaPath(e.target.value)} placeholder="Auto-detect" style={{ flex: 1 }} />
            <Button onClick={() => api.dialog.pickJava().then((p) => p && setJavaPath(p))}>Browse</Button>
          </div>
        </Field>

        <Field label="Custom JVM Arguments" hint="Advanced — e.g. -XX:+UseG1GC">
          <TextInput value={extraJvmArgs} onChange={(e) => setExtraJvmArgs(e.target.value)} placeholder="Optional JVM flags" />
        </Field>
      </div>

      {mode === 'edit' && gameDir && (
        <Field label="Game Directory" hint="Managed automatically by Reimagined.">
          <TextInput value={gameDir} onChange={(e) => setGameDir(e.target.value)} />
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>data/games/{gameDir}</span>
        </Field>
      )}

      {mode === 'edit' && loaderChanged && (
        <div className="banner" style={{ marginTop: 6 }}>
          Changing the loader from {originalLoader === 'vanilla' ? 'Vanilla' : originalLoader} to{' '}
          {loader === 'vanilla' ? 'Vanilla' : loader} may make currently installed mods incompatible. Your
          mods, saves and config will be kept, but you may need to update or remove mods after the change.
        </div>
      )}

      {loader !== 'vanilla' && (
        <div className="banner banner-info" style={{ marginTop: 4 }}>
          The {loader === 'fabric' ? 'Fabric' : 'Forge'} loader {loaderVersion || '(latest)'} for {mcVersion || 'your version'} will be installed on first launch.
        </div>
      )}
    </Modal>
  )
}
