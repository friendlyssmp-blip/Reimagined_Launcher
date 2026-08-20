/**
 * Keybinds (v2.1.0) — System section.
 *
 * Shows the ACTIVE instance's real in-game keybindings — the same lines
 * Minecraft writes to options.txt, so mod-added keybinds (Xaero's, Jade,
 * Physics Mod…) appear automatically. Click a key to rebind it; changes are
 * written straight into that instance's options.txt (the file the game reads
 * at startup). "Apply to all instances" copies the layout everywhere, and
 * "Save as default" seeds every future instance with it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../state/AppContext'
import { api, friendlyError } from '../lib/api'
import { Button, Spinner, TextInput, EmptyState, Modal } from '../components/ui'
import { IconSearch, IconRefresh, IconFolder, IconCheck } from '../components/icons'
import { useT } from '../lib/i18n'
import type { KeybindEntry } from '@shared/types'

/** KeyboardEvent.code → the raw value Minecraft stores in options.txt. */
const CODE_MAP: Record<string, string> = {
  Space: 'key.keyboard.space', Enter: 'key.keyboard.enter', Tab: 'key.keyboard.tab', Backspace: 'key.keyboard.backspace',
  ArrowUp: 'key.keyboard.up', ArrowDown: 'key.keyboard.down', ArrowLeft: 'key.keyboard.left', ArrowRight: 'key.keyboard.right',
  ShiftLeft: 'key.keyboard.left.shift', ShiftRight: 'key.keyboard.right.shift',
  ControlLeft: 'key.keyboard.left.control', ControlRight: 'key.keyboard.right.control',
  AltLeft: 'key.keyboard.left.alt', AltRight: 'key.keyboard.right.alt', CapsLock: 'key.keyboard.capslock',
  Slash: 'key.keyboard.slash', Backslash: 'key.keyboard.backslash', Period: 'key.keyboard.period', Comma: 'key.keyboard.comma',
  Minus: 'key.keyboard.minus', Equal: 'key.keyboard.equal', Semicolon: 'key.keyboard.semicolon', Quote: 'key.keyboard.quote',
  Backquote: 'key.keyboard.backquote', BracketLeft: 'key.keyboard.left.bracket', BracketRight: 'key.keyboard.right.bracket',
  Delete: 'key.keyboard.delete', Insert: 'key.keyboard.insert', Home: 'key.keyboard.home', End: 'key.keyboard.end',
  PageUp: 'key.keyboard.pageup', PageDown: 'key.keyboard.pagedown', NumLock: 'key.keyboard.num.lock', PrintScreen: 'key.keyboard.print.screen'
}

function codeToRaw(code: string): string | null {
  if (CODE_MAP[code]) return CODE_MAP[code]
  if (/^Key[A-Z]$/.test(code)) return 'key.keyboard.' + code.slice(3).toLowerCase()
  if (/^Digit[0-9]$/.test(code)) return 'key.keyboard.' + code.slice(5)
  if (/^F\d{1,2}$/.test(code)) return 'key.keyboard.' + code.toLowerCase()
  if (/^Numpad[0-9]$/.test(code)) return 'key.keyboard.numpad' + code.slice(6)
  return null
}

const CATEGORY_ORDER = ['Movement', 'Gameplay', 'Inventory', 'Creative', 'Multiplayer', 'Miscellaneous']

export function KeybindsPage() {
  const { profiles, activeProfile, notify } = useApp()
  const t = useT()
  const [profileId, setProfileId] = useState<string>(() => activeProfile?.id ?? profiles[0]?.id ?? '')
  const [entries, setEntries] = useState<KeybindEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [capturing, setCapturing] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmApply, setConfirmApply] = useState(false)
  const [applying, setApplying] = useState(false)

  const load = useCallback(async (id: string) => {
    if (!id) {
      setEntries([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      setEntries(await api.keybinds.list(id))
    } catch (err) {
      notify('error', 'Could not load keybinds', friendlyError(err))
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [notify])

  // Follow the active profile, but let the user pick another instance too.
  useEffect(() => {
    if (activeProfile?.id && activeProfile.id !== profileId) setProfileId(activeProfile.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfile?.id])

  useEffect(() => {
    void load(profileId)
  }, [profileId, load])

  /* Global key capture while rebinding. */
  useEffect(() => {
    if (!capturing) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      let raw: string | null
      if (e.key === 'Escape') {
        raw = 'key.keyboard.unknown'
      } else {
        raw = codeToRaw(e.code)
        if (!raw) return // unsupported key — keep listening
      }
      const target = capturing
      setCapturing(null)
      void rebind(target, raw)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing])

  const rebind = async (key: string, raw: string): Promise<void> => {
    setBusy(key)
    try {
      const fresh = await api.keybinds.set(profileId, key, raw)
      setEntries(fresh)
      notify('success', 'Keybind updated', key)
    } catch (err) {
      notify('error', 'Could not update keybind', friendlyError(err))
    } finally {
      setBusy(null)
    }
  }

  const applyAll = async (): Promise<void> => {
    setApplying(true)
    try {
      const res = await api.keybinds.applyAll(profileId)
      notify('success', t('kb.applyAllDone'), `${res.applied.length} instance(s) updated.`)
      setConfirmApply(false)
    } catch (err) {
      notify('error', 'Could not apply keybinds', friendlyError(err))
    } finally {
      setApplying(false)
    }
  }

  const saveTemplate = async (): Promise<void> => {
    try {
      const res = await api.keybinds.saveTemplate(profileId)
      notify('success', t('kb.templateSaved'), `${res.count} binding(s) saved — new instances will start with them.`)
    } catch (err) {
      notify('error', 'Could not save default keybinds', friendlyError(err))
    }
  }

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = entries.filter(
      (e) =>
        !q ||
        e.label.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q) ||
        e.raw.toLowerCase().includes(q) ||
        e.bound.toLowerCase().includes(q)
    )
    const byCat = new Map<string, KeybindEntry[]>()
    for (const e of filtered) {
      const cat = e.category || t('kb.other')
      if (!byCat.has(cat)) byCat.set(cat, [])
      byCat.get(cat)!.push(e)
    }
    const cats = [...byCat.keys()].sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a)
      const bi = CATEGORY_ORDER.indexOf(b)
      if (ai !== -1 && bi !== -1) return ai - bi
      if (ai !== -1) return -1
      if (bi !== -1) return 1
      if (a === t('kb.other')) return 1
      if (b === t('kb.other')) return -1
      return a.localeCompare(b)
    })
    return cats.map((cat) => ({ cat, items: byCat.get(cat)! }))
  }, [entries, query, t])

  const profileName = profiles.find((p) => p.id === profileId)?.name ?? activeProfile?.name ?? ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="panel">
        <div className="panel-title">{t('page.keybinds')}</div>
        <p className="panel-sub">{t('page.keybinds.sub')}</p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
          <label style={{ fontSize: 12, color: 'var(--text-3)' }}>{t('kb.activeProfile')}</label>
          <select
            className="select sort-select"
            style={{ maxWidth: 300 }}
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
            title={t('kb.activeProfile')}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {profileId && (
            <Button variant="ghost" size="sm" onClick={() => void api.keybinds.openFolder(profileId)}>
              <IconFolder style={{ width: 13, height: 13 }} /> {t('kb.openFolder')}
            </Button>
          )}
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 10, lineHeight: 1.5 }}>
          {t('kb.changesApply')}
        </p>
      </div>

      <div className="panel">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
            <IconSearch style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, opacity: 0.5 }} />
            <TextInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('kb.searchPlaceholder')}
              style={{ paddingLeft: 30 }}
            />
          </div>
          <Button variant="ghost" size="sm" onClick={() => void load(profileId)} disabled={loading || !profileId}>
            {loading ? <Spinner /> : <IconRefresh style={{ width: 13, height: 13 }} />} Refresh
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void saveTemplate()} disabled={!profileId || entries.length === 0}>
            <IconCheck style={{ width: 13, height: 13 }} /> {t('kb.saveTemplate')}
          </Button>
          <Button variant="primary" size="sm" onClick={() => setConfirmApply(true)} disabled={!profileId || entries.length === 0}>
            {t('kb.applyAll')}
          </Button>
        </div>

        <div style={{ marginTop: 16 }}>
          {!profileId ? (
            <EmptyState title={t('kb.noProfile')} />
          ) : loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
              <Spinner />
            </div>
          ) : entries.length === 0 ? (
            <EmptyState title={t('kb.notFound')} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {groups.map(({ cat, items }) => (
                <div key={cat}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent-3)', marginBottom: 6 }}>
                    {cat} · {items.length}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {items.map((e) => {
                      const isCapturing = capturing === e.key
                      const isBusy = busy === e.key
                      return (
                        <div
                          key={e.key}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '7px 10px',
                            borderRadius: 9,
                            background: 'var(--bg-3)',
                            border: '1px solid ' + (isCapturing ? 'var(--accent-3)' : 'var(--border)'),
                            transition: 'border-color 120ms ease'
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.label}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono, monospace)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {e.key}
                            </div>
                          </div>
                          <button
                            type="button"
                            className={isCapturing ? 'key-cap' : 'key-chip'}
                            disabled={isBusy}
                            onClick={() => {
                              if (isCapturing) return
                              setCapturing(e.key)
                            }}
                            title={isCapturing ? t('kb.pressKey') : t('kb.clickToRebind')}
                          >
                            {isBusy ? <Spinner /> : isCapturing ? t('kb.pressKey') : e.bound}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {confirmApply && (
        <Modal
          title={t('kb.applyAll')}
          onClose={() => setConfirmApply(false)}
        >
          <p style={{ color: 'var(--text-2)', fontSize: 13, lineHeight: 1.6, margin: 0 }}>
            Copy the keybind layout of <b>{profileName}</b> into every other instance? Their current keybind lines will be replaced.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            <Button variant="ghost" onClick={() => setConfirmApply(false)} disabled={applying}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void applyAll()} disabled={applying}>
              {applying ? <><Spinner /> Applying…</> : t('kb.applyAll')}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
