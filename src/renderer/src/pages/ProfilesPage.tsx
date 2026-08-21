import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../state/AppContext'
import { Button, Badge, EmptyState, ProfileGlyph } from '../components/ui'
import { api, friendlyError } from '../lib/api'
import { humanDuration } from '../lib/format'
import { IconFolder, IconPlay, IconStop, IconDots, IconShare, IconPencil, IconCopy, IconTrash, IconArchive, IconRefresh } from '../components/icons'
import type { Page } from '../App'
import type { Profile } from '@shared/types'
import { useT } from '../lib/i18n'

interface CtxMenu {
  x: number
  y: number
  profile: Profile
}

export function ProfilesPage({ onNavigate }: { onNavigate: (p: Page) => void }) {
  const t = useT()
  const { profiles, setModals, launchProfile, stopLaunch, runningProfiles, notify, setActiveProfile } = useApp()
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null)

  // Close the context menu on outside click / Escape.
  useEffect(() => {
    if (!ctxMenu) return
    const close = (): void => setCtxMenu(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setCtxMenu(null)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [ctxMenu])

  const openCtx = (e: React.MouseEvent, p: Profile) => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ x: e.clientX, y: e.clientY, profile: p })
  }

  /** Part 10.3 — card click navigates into that profile's Mods (Installed tab). */
  const openProfileMods = (p: { id: string }) => {
    setActiveProfile(p.id)
    onNavigate('mods')
  }

  const confirmDelete = (p: { id: string; name: string }) => {
    setCtxMenu(null)
    setModals({
      confirm: {
        title: 'Delete profile',
        message: `Delete “${p.name}”? This cannot be undone.`,
        confirmLabel: 'Delete',
        danger: true,
        option: {
          label: 'Also delete game files (mods, saves, config)',
          defaultChecked: true
        },
        onConfirm: async ({ optionChecked }) => {
          try {
            await api.profiles.delete(p.id, optionChecked)
            // Part 6 — never leave a dangling active-profile pointer.
            if (profiles.some((x) => x.id === p.id)) {
              setActiveProfile(profiles.filter((x) => x.id !== p.id)[0]?.id ?? null)
            }
            notify('success', 'Profile deleted', `“${p.name}” was removed.`)
          } catch (err) {
            notify('error', 'Could not delete profile', friendlyError(err))
          }
        }
      }
    })
  }

  const duplicate = (p: Profile) => {
    setCtxMenu(null)
    setModals({ duplicate: { profile: p } })
  }

  /** Part 10.1 — Share opens the share panel (transparency + unique code). */
  const share = (p: Profile) => {
    setCtxMenu(null)
    setModals({ share: { profile: p } })
  }

  const openFolder = async (p: { id: string }) => {
    setCtxMenu(null)
    try {
      await api.content.openFolder(p.id)
    } catch (err) {
      notify('error', 'Could not open folder', friendlyError(err))
    }
  }

  /** v1.0.79 — repair a Fabric profile's environment (loader re-pin,
   *  incompatible-mod quarantine, remap-cache clear). Never touches user data. */
  const repair = async (p: Profile) => {
    setCtxMenu(null)
    setModals({
      confirm: {
        title: 'Repair Fabric instance?',
        message: `Repair “${p.name}” re-checks the Fabric loader for ${p.minecraftVersion}, moves incompatible mods to mods.incompatible/ (nothing is deleted), and clears the stale remap cache. Your worlds, screenshots and config are untouched.`,
        confirmLabel: 'Repair',
        onConfirm: async () => {
          try {
            const res = await api.profiles.repair(p.id)
            notify('success', 'Instance repaired', [...res.fixed, ...(res.moved.length > 0 ? [`Moved ${res.moved.length} incompatible mod(s) to mods.incompatible/`] : [])].join(' · ') || 'The Fabric environment is healthy.')
          } catch (err) {
            notify('error', 'Repair failed', friendlyError(err))
          }
        }
      }
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="section-head">
        <div>
          <h2 className="page-title">{t('page.profiles')}</h2>
          <p className="page-sub">Manage your Minecraft instances — click a card to manage its mods</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button onClick={() => setModals({ importShare: true })} title="Import a shared profile (.zip or code)">
            <IconArchive style={{ width: 14, height: 14 }} /> Import
          </Button>
          <Button variant="primary" onClick={() => setModals({ profile: { mode: 'create' } })}>+ New Profile</Button>
        </div>
      </div>

      {profiles.length === 0 ? (
        <EmptyState
          title="No profiles yet"
          sub="Create your first Minecraft profile to get started."
          action={
            <Button variant="primary" onClick={() => setModals({ profile: { mode: 'create' } })}>
              Create Profile
            </Button>
          }
        />
      ) : (
        <div className="profile-grid">
          {profiles.map((p) => {
            // Multi-instance (v1.0.15): each card tracks ITS OWN profile's
            // running state — Instance A running never makes B show Stop.
            const running = !!runningProfiles[p.id]
            return (
            <div
              key={p.id}
              className="card profile-card card-hover"
              onClick={() => openProfileMods(p)}
              onContextMenu={(e) => openCtx(e, p)}
              title="Click to manage mods · Right-click for more actions"
            >
              <div className="profile-card-head">
                <div
                  className="profile-avatar"
                  style={{ background: p.icon?.startsWith('data:') ? 'transparent' : 'hsl(' + (p.name.charCodeAt(0) * 37 % 360) + ', 60%, 50%)' }}
                >
                  <ProfileGlyph icon={p.icon} name={p.name} />
                </div>
                <div>
                  <div className="profile-name">{p.name}</div>
                  <div className="profile-meta">
                    <Badge>{p.minecraftVersion}</Badge>
                    <Badge variant="accent">{p.loader.type === 'fabric' && /^1\.(\d+)/.exec(p.minecraftVersion) !== null && Number(/^1\.(\d+)/.exec(p.minecraftVersion)![1]) < 14 ? 'Fabric (Legacy)' : p.loader.type}</Badge>
                    {p.mods.length > 0 && <Badge>{p.mods.length} mods</Badge>}
                  </div>
                </div>
              </div>

              {/* Card stats are intentionally minimal: only Playtime lives on
                  the card. RAM and Resolution stay configurable in Edit — they
                  just don't clutter the default card display. */}
              <div className="profile-stats">
                <div className="profile-stat">
                  <b>{p.playtimeSeconds > 0 ? humanDuration(p.playtimeSeconds) : '---'}</b>
                  <span>Playtime</span>
                </div>
              </div>

              <div className="profile-card-actions">
                <Button
                  variant={running ? 'danger' : 'play'}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (running) void stopLaunch(p.id)
                    else void launchProfile(p.id)
                  }}
                >
                  {running ? <><IconStop style={{ width: 14, height: 14 }} /> Stop</> : <><IconPlay style={{ width: 14, height: 14 }} /> Play</>}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    openFolder(p)
                  }}
                  title="Open instance folder"
                >
                  <IconFolder style={{ width: 14, height: 14 }} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    openCtx(e, p)
                  }}
                  title="More actions"
                >
                  <IconDots style={{ width: 14, height: 14 }} />
                </Button>
              </div>
            </div>
            )
          })}
        </div>
      )}

      {/* Custom context menu (Part 10.1).
          v1.0.82 — portaled to <body>: .page-enter keeps `will-change:
          transform`, which turns it into a containing block for position:fixed
          descendants — the menu was being positioned relative to the page
          instead of the viewport, so it appeared in the middle of the launcher
          instead of under the cursor. Portaling escapes that. The position is
          also clamped so the menu never overflows the screen edge. */}
      {ctxMenu &&
        createPortal(
        <div
          className="ctx-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y, transformOrigin: '0 0' }}
          // Keep mousedown inside the menu from reaching the window-level
          // "close on outside click" listener (which would unmount the menu
          // before the button's click event can fire — the buttons' onClick
          // never ran as a result).
          onMouseDown={(e) => e.stopPropagation()}
          ref={(el) => {
            // v1.0.82 — clamp to the viewport so the menu is always fully visible.
            if (!el) return
            const r = el.getBoundingClientRect()
            const pad = 8
            const dx = Math.min(0, window.innerWidth - r.right - pad)
            const dy = Math.min(0, window.innerHeight - r.bottom - pad)
            if (dx || dy) {
              el.style.left = `${Math.max(pad, ctxMenu.x + dx)}px`
              el.style.top = `${Math.max(pad, ctxMenu.y + dy)}px`
            }
          }}
        >
          <button
            onClick={() => {
              setCtxMenu(null)
              setModals({ profile: { mode: 'edit', profile: profiles.find((x) => x.id === ctxMenu.profile.id) } })
            }}
          >
            <IconPencil style={{ width: 14, height: 14 }} /> Edit
          </button>
          <button onClick={() => duplicate(ctxMenu.profile)}>
            <IconCopy style={{ width: 14, height: 14 }} /> Duplicate
          </button>
          <button onClick={() => share(ctxMenu.profile)}>
            <IconShare style={{ width: 14, height: 14 }} /> Share
          </button>
          {ctxMenu.profile.loader.type === 'fabric' && (
            <button onClick={() => repair(ctxMenu.profile)} title="Re-check the Fabric loader, isolate incompatible mods and clear the remap cache">
              <IconRefresh style={{ width: 14, height: 14 }} /> Repair
            </button>
          )}
          <div className="ctx-sep" />
          <button className="danger" onClick={() => confirmDelete(ctxMenu.profile)}>
            <IconTrash style={{ width: 14, height: 14 }} /> Delete
          </button>
        </div>,
        document.body
      )}
    </div>
  )
}
