/**
 * Central renderer state.
 *
 * Holds settings, account, profiles, launch state, console stream and the
 * global modal/toast system. Subscribes to the main-process event channel
 * and keeps the UI in sync automatically.
 */
import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import { api, ApiError, friendlyError } from '../lib/api'
import type {
  AppInfo,
  LauncherSettings,
  AccountPublic,
  Profile,
  LaunchProgress,
  ThemeId,
  LaunchHandle,
  UpdateInfo
} from '@shared/types'
import type { AppEvent } from '@shared/ipc'

export type LaunchUiState = {
  phase: 'idle' | 'preparing' | 'downloading' | 'launching' | 'running' | 'error'
  message: string
  percent: number | null
  pid?: number
  profileId?: string
}

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  title: string
  desc?: string
}

export interface ModalState {
  login: boolean
  profile: { mode: 'create' | 'edit'; profile?: Profile } | null
  duplicate: { profile: Profile } | null
  share: { profile: Profile } | null
  importShare: boolean
  update: boolean
  confirm: {
    title: string
    message: string
    confirmLabel?: string
    danger?: boolean
    /** Optional checkbox shown above the actions (e.g. "also delete game files"). */
    option?: { label: string; defaultChecked?: boolean }
    onConfirm: (opts: { optionChecked: boolean }) => void
  } | null
}

/** Live profile create/delete operation shown as a progress overlay. */
export interface ProfileOp {
  action: 'create' | 'delete' | 'duplicate' | 'prepare' | 'import'
  name: string
  message: string
  percent: number | null
}

interface AppContextValue {
  ready: boolean
  info: AppInfo | null
  theme: ThemeId
  settings: LauncherSettings
  account: AccountPublic
  profiles: Profile[]
  activeProfile: Profile | null
  launch: LaunchUiState
  running: boolean
  toasts: Toast[]
  modals: ModalState
  profileOp: ProfileOp | null
  setPage: (p: string) => void
  refreshProfiles: () => Promise<void>
  setActiveProfile: (id: string | null) => void
  updateSettings: (patch: Partial<LauncherSettings>) => Promise<void>
  refreshAccount: () => Promise<void>
  logout: () => Promise<void>
  launchProfile: (profileId: string) => Promise<void>
  stopLaunch: () => Promise<void>
  notify: (kind: Toast['kind'], title: string, desc?: string) => void
  setModals: (patch: Partial<ModalState>) => void
  runGuarded: (label: string, fn: () => Promise<unknown>) => Promise<void>
  updateInfo: UpdateInfo | null
  checkForUpdates: (silent?: boolean) => Promise<UpdateInfo | null>
}

const AppContext = createContext<AppContextValue | null>(null)

let toastId = 0

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [settings, setSettings] = useState<LauncherSettings | null>(null)
  const [account, setAccount] = useState<AccountPublic>({ profile: null, status: 'offline', lastRefreshedAt: null })
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [activeProfileId, setActiveProfileId] = useState<string | null>(
    () => localStorage.getItem('reimagined:active') ?? null
  )
  const [launch, setLaunch] = useState<LaunchUiState>({ phase: 'idle', message: '', percent: null })
  const [toasts, setToasts] = useState<Toast[]>([])
  const [modals, setModalsState] = useState<ModalState>({
    login: false,
    profile: null,
    duplicate: null,
    share: null,
    importShare: false,
    update: false,
    confirm: null
  })
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const notifiedVersionRef = useRef<string | null>(null)
  const [profileOp, setProfileOp] = useState<ProfileOp | null>(null)

  const notifyTimer = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const setModals = useCallback((patch: Partial<ModalState>) => {
    setModalsState((prev) => ({ ...prev, ...patch }))
  }, [])

  const notify = useCallback((kind: Toast['kind'], title: string, desc?: string) => {
    const id = ++toastId
    setToasts((prev) => [...prev.slice(-4), { id, kind, title, desc }])
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
      notifyTimer.current.delete(id)
    }, 5200)
    notifyTimer.current.set(id, timer)
  }, [])

  const refreshProfiles = useCallback(async () => {
    try {
      setProfiles(await api.profiles.list())
    } catch (err) {
      console.error('profiles refresh failed', err)
    }
  }, [])

  const refreshAccount = useCallback(async () => {
    try {
      setAccount(await api.auth.getAccount())
    } catch (err) {
      // Never crash, but never hide it either — surface to the log so a
      // stuck "logged out" UI can be diagnosed (Part 13).
      console.error('account refresh failed', err)
      void api.logs.write('error', `Account refresh failed: ${err instanceof Error ? err.message : String(err)}`).catch(() => {})
    }
  }, [])

  const updateSettings = useCallback(async (patch: Partial<LauncherSettings>) => {
    const next = await api.settings.set(patch)
    setSettings(next)
    if (patch.theme) localStorage.setItem('reimagined:theme', patch.theme)
  }, [])

  const logout = useCallback(async () => {
    await api.auth.logout()
    await refreshAccount()
    notify('info', 'Signed out')
  }, [notify, refreshAccount])

  /** GitHub update check (official repo only) — silent on startup, toast when found.
   *
   * `force` bypasses the 30-minute cache: the manual "Check for updates"
   * button always passes force so users never see a stale "up to date".
   */
  const checkForUpdates = useCallback(
    async (silent = true, force = false): Promise<UpdateInfo | null> => {
      try {
        const info = await api.update.check(force)
        setUpdateInfo(info)
        if (info.hasUpdate && info.latestVersion !== notifiedVersionRef.current) {
          notifiedVersionRef.current = info.latestVersion
          notify('info', 'Update available', `Reimagined v${info.latestVersion} is ready — check the Update panel.`)
        }
        return info
      } catch {
        if (!silent) notify('error', 'Update check failed', 'Could not reach GitHub. Check your connection and try again.')
        return null
      }
    },
    [notify]
  )

  /** Run an action, converting failures into toasts. */
  const runGuarded = useCallback(
    async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn()
      } catch (err) {
        const message = friendlyError(err)
        const hint = err instanceof ApiError && err.hint ? ` ${err.hint}` : ''
        notify('error', `${label} failed`, message + hint)
        throw err
      }
    },
    [notify]
  )

  const launchProfile = useCallback(
    async (profileId: string) => {
      // Open the detached game console window BEFORE the pipeline runs so the
      // user sees download/install progress live (launch:start only resolves
      // after the game process spawns).
      if (settings?.showConsoleOnLaunch !== false) void api.console.open().catch(() => {})
      setLaunch({ phase: 'preparing', message: 'Preparing launch…', percent: 0, profileId })
      await runGuarded('Launch', async () => {
        const handle = await api.launch.start(profileId)
        setLaunch({ phase: 'running', message: `Starting ${handle.pid ? 'game' : ''}…`, percent: null, pid: handle.pid, profileId })
        setModals({ profile: null })
      })
    },
    [runGuarded, setModals, settings]
  )

  const stopLaunch = useCallback(async () => {
    try {
      await api.launch.stop()
    } catch {
      /* non-fatal */
    }
  }, [])

  /* ------------------------- initial load + events ------------------------- */

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [i, s, acc, profs] = await Promise.all([
          api.getInfo(),
          api.settings.get(),
          api.auth.getAccount(),
          api.profiles.list()
        ])
        if (cancelled) return
        setInfo(i)
        setSettings(s)
        setAccount(acc)
        setProfiles(profs)
        document.documentElement.dataset.theme = s.theme
        setReady(true)
      } catch (err) {
        console.error('bootstrap failed', err)
        setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    const off = api.onEvent((e: AppEvent) => {
      switch (e.type) {
        case 'settings:changed':
          setSettings(e.payload as LauncherSettings)
          break
        case 'auth:code': {
          const p = e.payload as { userCode: string; verificationUri: string; message: string }
          setModals({ login: true })
          break
        }
        case 'auth:state': {
          const p = e.payload as { phase: string }
          if (p.phase === 'success') {
            void refreshAccount()
            void refreshProfiles()
            setModals({ login: false })
            notify('success', 'Signed in successfully')
          } else if (p.phase === 'refreshed') {
            void refreshAccount()
          } else if (p.phase === 'expired') {
            // Session is dead and silent refresh failed — mark the account
            // as needing a re-login instead of leaving a ghost account.
            void refreshAccount()
            notify('error', 'Session expired', 'Your Microsoft session expired. Sign in again to continue.')
          }
          break
        }
        case 'auth:error': {
          const p = e.payload as { message: string; hint?: string }
          setModals({ login: false })
          notify('error', 'Sign-in failed', p.message + (p.hint ? ` ${p.hint}` : ''))
          // The account may already be saved even though an error followed
          // (e.g. bookkeeping failed after the write) — re-check the real
          // state so the UI is never stuck logged-out (Part 13).
          void refreshAccount()
          break
        }
        case 'launch:progress': {
          const p = e.payload as LaunchProgress
          setLaunch((prev) => ({
            ...prev,
            phase: p.stage === 'running' ? 'running' : p.stage === 'launching' ? 'launching' : p.stage === 'installing-loader' || p.stage === 'downloading' || p.stage === 'preparing' || p.stage === 'resolving' ? 'preparing' : 'running',
            message: p.message,
            percent: p.percent ?? null
          }))
          break
        }
        case 'download:progress': {
          const p = e.payload as { percent: number; label: string; currentFile: string }
          setLaunch((prev) => ({
            ...prev,
            phase: 'preparing',
            message: `${p.label}${p.currentFile ? ` — ${p.currentFile}` : ''}`,
            percent: p.percent
          }))
          break
        }
        case 'launch:status': {
          const p = e.payload as { running: boolean; error?: string; pid?: number; code?: number | null }
          if (!p.running) {
            setLaunch((prev) => ({
              ...prev,
              phase: prev.phase === 'running' || prev.phase === 'launching' ? 'idle' : prev.phase,
              running: false,
              pid: undefined
            }))
            if (p.error) notify('error', 'Launch failed', p.error)
          } else {
            setLaunch((prev) => ({ ...prev, phase: 'running', pid: p.pid }))
          }
          break
        }
        case 'launch:exit': {
          const p = e.payload as { code: number | null; duration: number }
          if (p.code !== 0) notify('info', 'Game closed', `Exited with code ${p.code ?? 'unknown'}`)
          else notify('success', 'Game closed', `Played for ${Math.round(p.duration)}s`)
          setLaunch((prev) => ({ ...prev, phase: 'idle', percent: null }))
          void refreshProfiles()
          break
        }
        case 'profile:changed':
          void refreshProfiles()
          break
        case 'profile:progress': {
          const p = e.payload as { action: 'create' | 'delete' | 'duplicate' | 'prepare' | 'import'; name: string; phase: string; percent: number | null; done: boolean }
          if (p.done) {
            setProfileOp(null)
          } else {
            setProfileOp({ action: p.action, name: p.name, message: p.phase, percent: p.percent })
          }
          break
        }
        case 'mods:changed':
          void refreshProfiles()
          break
        default:
          break
      }
    })
    return off
  }, [ready, notify, refreshAccount, refreshProfiles, setModals])

  // Silent startup update check against the official repository (forced, so
  // a fresh launch always sees the truth — no stale 30-min cache result).
  useEffect(() => {
    if (!ready) return
    if (!settings?.autoCheckUpdates) return
    const t = setTimeout(() => void checkForUpdates(true, true), 4000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, settings?.autoCheckUpdates])

  // Re-check every 30 min while the launcher stays open, so a running
  // launcher notices a new release without needing a restart.
  useEffect(() => {
    if (!ready) return
    if (!settings?.autoCheckUpdates) return
    const iv = setInterval(() => void checkForUpdates(true, true), 30 * 60_000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, settings?.autoCheckUpdates])

  // Keep active profile valid.
  useEffect(() => {
    if (!ready) return
    if (activeProfileId && !profiles.some((p) => p.id === activeProfileId)) {
      const next = profiles[0]?.id ?? null
      setActiveProfileId(next)
      localStorage.setItem('reimagined:active', next ?? '')
    }
  }, [ready, profiles, activeProfileId])

  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0] ?? null
  const running = launch.phase === 'running' || launch.phase === 'launching'

  if (!settings) {
    return <div className="boot-screen"><div className="boot-spinner" /></div>
  }

  const value: AppContextValue = {
    ready,
    info,
    theme: settings.theme,
    settings,
    account,
    profiles,
    activeProfile,
    launch,
    running,
    toasts,
    modals,
    profileOp,
    setPage: () => {},
    refreshProfiles,
    setActiveProfile: (id) => {
      setActiveProfileId(id)
      localStorage.setItem('reimagined:active', id ?? '')
    },
    updateSettings,
    refreshAccount,
    logout,
    launchProfile,
    stopLaunch,
    notify,
    setModals,
    runGuarded,
    updateInfo,
    checkForUpdates
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}

export function useActiveProfile(): Profile | null {
  return useApp().activeProfile
}
