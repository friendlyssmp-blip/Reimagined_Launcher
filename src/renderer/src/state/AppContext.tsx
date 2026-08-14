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
import { humanDuration } from '../lib/format'
import { sound } from '../lib/sound'
import type {
  AppInfo,
  LauncherSettings,
  AccountPublic,
  Profile,
  LaunchProgress,
  ThemeId,
  LaunchHandle,
  UpdateInfo,
  CrashReport
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
  /** v1.0.35 — true when the caller plays its own more specific sound. */
  silent?: boolean
}

export interface ModalState {
  login: boolean
  profile: { mode: 'create' | 'edit'; profile?: Profile } | null
  duplicate: { profile: Profile } | null
  share: { profile: Profile } | null
  /** v1.0.81 — folder-picker for .zip exports (worlds/mods/config…). */
  exportZip: { profile: Profile } | null
  importShare: boolean
  /** v1.0.34 — the 3-option update prompt (no silent auto-update anymore). */
  update: boolean
  /** v1.0.36 — the enhanced "Check for Updates" modal (checking/available/up-to-date/error). */
  checkUpdates: boolean
  /** Crash Assistant — a game crash report detected after a launch. */
  crash: CrashReport | null
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

export type ContentView =
  | { kind: 'author'; provider: 'modrinth' | 'curseforge'; username: string; displayName?: string }
  | { kind: 'project'; provider: 'modrinth' | 'curseforge'; projectId: string; projectType?: string }

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
  /** profileId → running (multi-instance: each profile tracks its own state). */
  runningProfiles: Record<string, boolean>
  toasts: Toast[]
  modals: ModalState
  profileOp: ProfileOp | null
  refreshProfiles: () => Promise<void>
  setActiveProfile: (id: string | null) => void
  updateSettings: (patch: Partial<LauncherSettings>) => Promise<void>
  refreshAccount: () => Promise<void>
  logout: () => Promise<void>
  launchProfile: (profileId: string) => Promise<void>
  stopLaunch: (profileId?: string) => Promise<void>
  /**
   * Show a toast. `opts.silent` suppresses the automatic success/error/notify
   * cue (used by flows that play a more specific sound themselves, e.g. the
   * install-complete payoff).
   */
  notify: (kind: Toast['kind'], title: string, desc?: string, opts?: { silent?: boolean }) => void
  setModals: (patch: Partial<ModalState>) => void
  /** v1.0.86 — browser-like content stack (projects/authors as overlay pages). */
  contentStack: ContentView[]
  pushContent: (view: ContentView) => void
  popContent: () => void
  closeContent: () => void
  runGuarded: (label: string, fn: () => Promise<unknown>) => Promise<void>
  updateInfo: UpdateInfo | null
  /** silent = no toast on failure; force = bypass the 30-min cache. */
  checkForUpdates: (silent?: boolean, force?: boolean) => Promise<UpdateInfo | null>
  /**
   * v1.0.34 — 3-option prompt bookkeeping (no more silent auto-update):
   * - 'cancel': dismiss now; the next periodic check re-prompts (lighter).
   * - 'later': suppress all auto-prompts for the rest of this session;
   *   the prompt reappears on the next app start.
   */
  dismissUpdatePrompt: (mode: 'cancel' | 'later') => void
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
  /** profileId → running (v1.0.15 multi-instance per-profile state). */
  const [runningMap, setRunningProfiles] = useState<Record<string, boolean>>({})
  /** The profileId of the most recent launch — fallback key for launch events. */
  const launchProfileIdRef = useRef<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [modals, setModalsState] = useState<ModalState>({
    login: false,
    profile: null,
    duplicate: null,
    share: null,
    exportZip: null,
    importShare: false,
    update: false,
    checkUpdates: false,
    crash: null,
    confirm: null
  })
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const notifiedVersionRef = useRef<string | null>(null)
  // v1.0.34 — no more silent auto-update. The update prompt shows once per
  // session by default; Cancel allows one re-prompt on the next periodic
  // check; Remind Me Later suppresses auto-prompts for the whole session.
  const updatePromptShownRef = useRef(false)
  const updateRemindLaterRef = useRef(false)
  const updateCancelRef = useRef(false)
  const [profileOp, setProfileOp] = useState<ProfileOp | null>(null)

  const notifyTimer = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const setModals = useCallback((patch: Partial<ModalState>) => {
    setModalsState((prev) => ({ ...prev, ...patch }))
  }, [])

  /* v1.0.86 — browser-like content stack. pushContent opens an overlay page
   * (project detail / author profile); popContent returns to whatever was
   * underneath — arbitrary depth, no artificial limit. */
  const [contentStack, setContentStack] = useState<ContentView[]>([])
  const pushContent = useCallback((view: ContentView) => {
    setContentStack((prev) => [...prev, view])
  }, [])
  const popContent = useCallback(() => {
    setContentStack((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev))
  }, [])
  const closeContent = useCallback(() => {
    setContentStack([])
  }, [])

  const notify = useCallback((kind: Toast['kind'], title: string, desc?: string, opts?: { silent?: boolean }) => {
    const id = ++toastId
    setToasts((prev) => [...prev.slice(-4), { id, kind, title, desc, silent: opts?.silent }])
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
   *
   * v1.0.34 — the prompt rules (auto-install was removed entirely):
   *  - a MANUAL check (silent=false) always opens the 3-option prompt;
   *  - an AUTO check opens it at most once per session, re-opens it once
   *    after the user clicked Cancel (lighter dismissal), and never re-opens
   *    it after "Remind Me Later" until the next app start.
   */
  const checkForUpdates = useCallback(
    async (silent = true, force = false): Promise<UpdateInfo | null> => {
      try {
        const info = await api.update.check(force)
        // v1.0.25 — skip no-op state writes: a background check that returns
        // the same version must not re-render the whole app tree.
        setUpdateInfo((prev) =>
          prev && prev.latestVersion === info.latestVersion && prev.hasUpdate === info.hasUpdate
            ? prev
            : info
        )
        if (info.hasUpdate) {
          let openPrompt = false
          if (!silent) {
            // Manual "Check for updates" from Settings — always ask. This also
            // counts as the session's one auto-prompt: an X-close must not
            // cause the next periodic check to re-open the modal.
            updatePromptShownRef.current = true
            openPrompt = true
          } else if (updateRemindLaterRef.current) {
            // "Remind Me Later" — no auto-prompt for the rest of the session.
          } else if (updateCancelRef.current) {
            // "Cancel" — lighter dismissal: the next periodic check re-prompts.
            updateCancelRef.current = false
            openPrompt = true
          } else if (!updatePromptShownRef.current) {
            // First detection this session — show the prompt once.
            updatePromptShownRef.current = true
            openPrompt = true
          }
          if (openPrompt) {
            // v1.0.35 — the "update available" cue plays the moment the
            // 3-option prompt appears (gentle, positive — routine news, not
            // an alarm). The prompt itself is the notification, so no extra
            // toast sound doubles up here.
            sound.updateAvailable()
            setModals({ update: true })
          }
        }
        return info
      } catch {
        if (!silent) notify('error', 'Update check failed', 'Could not reach GitHub. Check your connection and try again.')
        return null
      }
    },
    [notify, setModals]
  )

  /** v1.0.34 — user chose Cancel or Remind Me Later in the 3-option prompt. */
  const dismissUpdatePrompt = useCallback(
    (mode: 'cancel' | 'later') => {
      if (mode === 'cancel') updateCancelRef.current = true
      else updateRemindLaterRef.current = true
      setModals({ update: false })
    },
    [setModals]
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

  // v1.0.79 — stable ref so the launch callback can re-invoke itself after a
  // Fabric repair without a self-referential useCallback initializer.
  const launchProfileRef = useRef<(profileId: string) => void>(() => {})
  const launchProfile = useCallback(
    async (profileId: string) => {
      // v1.0.15 multi-instance: remember which profile this launch belongs to
      // so status events are always keyed correctly.
      launchProfileIdRef.current = profileId
      // Open the detached game console window BEFORE the pipeline runs so the
      // user sees download/install progress live (launch:start only resolves
      // after the game process spawns).
      if (settings?.showConsoleOnLaunch !== false) void api.console.open().catch(() => {})
      setLaunch({ phase: 'preparing', message: 'Preparing launch…', percent: 0, profileId })
      try {
        const handle = await api.launch.start(profileId)
        setLaunch({ phase: 'running', message: `Starting ${handle.pid ? 'game' : ''}…`, percent: null, pid: handle.pid, profileId })
        setModals({ profile: null })
      } catch (err) {
        // A failed launch must never leave the UI stuck on "Launching…" — go
        // idle immediately (the launch:status event may never fire when the
        // pipeline rejects before spawning).
        setLaunch({ phase: 'idle', message: '', percent: null, pid: undefined, profileId })
        // v1.0.79 — Fabric environment mismatch: offer Repair right here
        // instead of just a toast. Repair re-resolves the loader, isolates
        // incompatible mods and clears the stale remap cache — user data is
        // never touched.
        if (err instanceof ApiError && err.code === 'FABRIC_ENV_MISMATCH') {
          setModals({
            confirm: {
              title: 'Fabric environment mismatch',
              message: `${friendlyError(err)}\n\nRepair will re-check the Fabric loader for this Minecraft version, move incompatible mods to mods.incompatible/ (nothing is deleted), and clear the stale remap cache. Your worlds, screenshots and config are untouched.`,
              confirmLabel: 'Repair and relaunch',
              onConfirm: async () => {
                try {
                  await api.profiles.repair(profileId)
                  notify('success', 'Instance repaired', 'The Fabric environment was fixed — relaunching…')
                  // Re-trigger the launch through the same pipeline. Using the
                  // ref keeps the callback stable (no self-referential init).
                  void launchProfileRef.current(profileId)
                } catch (repairErr) {
                  notify('error', 'Repair failed', friendlyError(repairErr))
                }
              }
            }
          })
          return
        }
        notify('error', 'Launch failed', friendlyError(err))
      }
    },
    [notify, setModals, settings]
  )
  launchProfileRef.current = launchProfile

  // v1.0.15 multi-instance: Stop targets ONE profile's session (or all when
  // no profile is given, e.g. the sidebar pill).
  const stopLaunch = useCallback(async (profileId?: string) => {
    try {
      await api.launch.stop(profileId)
    } catch {
      /* non-fatal */
    }
  }, [])

  /* ------------------------- initial load + events ------------------------- */

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [i, s, acc, profs, runs] = await Promise.all([
          api.getInfo(),
          api.settings.get(),
          api.auth.getAccount(),
          api.profiles.list(),
          api.launch.list().catch(() => [] as LaunchHandle[])
        ])
        if (cancelled) return
        setInfo(i)
        setSettings(s)
        setAccount(acc)
        setProfiles(profs)
        // Seed per-profile running state (e.g. another launcher window, or a
        // game still running from before a renderer reload).
        const seed: Record<string, boolean> = {}
        for (const h of runs) if (h.profileId) seed[h.profileId] = h.running
        setRunningProfiles(seed)
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
          const p = e.payload as { running: boolean; error?: string; pid?: number; code?: number | null; profileId?: string }
          // Multi-instance: track EVERY profile's own running state so one
          // running game never turns another profile's Play button into Stop.
          const pidKey = p.profileId ?? launchProfileIdRef.current
          if (pidKey) {
            setRunningProfiles((prev) => ({ ...prev, [pidKey]: p.running }))
          }
          if (!p.running) {
            // The launch flow is over — whether the game exited, was stopped,
            // or the launch FAILED. Always go idle and clear the progress so
            // the download panel can never stay stuck at 100% forever.
            setLaunch((prev) => ({
              ...prev,
              phase: 'idle',
              running: false,
              percent: null,
              pid: undefined
            }))
            if (p.error) notify('error', 'Launch failed', p.error)
          } else {
            setLaunch((prev) => ({ ...prev, phase: 'running', percent: null, pid: p.pid }))
          }
          break
        }
        case 'launch:exit': {
          const p = e.payload as { code: number | null; duration: number }
          if (p.code !== 0) notify('info', 'Game closed', `Exited with code ${p.code ?? 'unknown'}`)
          else notify('success', 'Game closed', `Played for ${humanDuration(p.duration)}`)
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
        case 'crash:detected':
          // Crash Assistant — a real crash report was found after the game
          // closed. Surface it immediately with analysis and suggestions.
          setModals({ crash: e.payload as CrashReport })
          break
        case 'launch:fabric-mismatch': {
          // v1.0.79 — the game output revealed a classTweaker namespace crash
          // (runtime-environment mismatch). Surface the clean message with a
          // Repair action instead of a raw Java stack trace.
          const payload = e.payload as { profileId?: string; message?: string }
          setModals({
            confirm: {
              title: 'Fabric environment mismatch',
              message: `${payload.message ?? 'One or more installed components are incompatible with this Minecraft/Fabric runtime.'}\n\nRepair re-checks the Fabric loader, moves incompatible mods to mods.incompatible/ and clears the stale remap cache — nothing is deleted.`,
              confirmLabel: 'Repair instance',
              onConfirm: async () => {
                // v1.0.79 — guard: never repair an empty/unknown profile id.
                if (!payload.profileId) {
                  notify('error', 'Repair unavailable', 'This instance can no longer be identified — open Profiles and use Repair from the profile menu.')
                  return
                }
                try {
                  await api.profiles.repair(payload.profileId)
                  notify('success', 'Instance repaired', 'The Fabric environment was fixed. Try launching again.')
                } catch (repairErr) {
                  notify('error', 'Repair failed', friendlyError(repairErr))
                }
              }
            }
          })
          break
        }
        case 'shaders:auto-disabled':
          // Shader Guard auto-recovery — the previous session crashed with
          // shaders enabled, so this session started with them off. Tell the
          // user clearly so they understand why and can re-enable later.
          {
            const payload = e.payload as { message?: string; profileId?: string }
            notify('info', 'Shaders disabled for this session', payload.message ?? 'Shaders were disabled because the game crashed with them enabled last time.')
          }
          break
        default:
          break
      }
    })
    return off
  }, [ready, notify, refreshAccount, refreshProfiles, setModals])

  // v1.0.34 — startup update check against the official repository (forced, so
  // a fresh launch always sees the truth — no stale cache result). If a newer
  // version exists the 3-option prompt (Update / Cancel / Remind Me Later)
  // appears — the launcher NEVER updates itself without the user choosing
  // "Update". Silent auto-install was removed entirely.
  useEffect(() => {
    if (!ready) return
    const t = setTimeout(() => {
      void checkForUpdates(true, true)
    }, 4000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  // v1.0.96 — Game Mode: never hit the network for update checks while any
  // game is running (multi-instance safe: runningMap holds one entry per
  // profile). The launcher goes fully quiet during a session so it cannot
  // add latency to the game.
  const gameRunningRef = useRef(false)
  useEffect(() => {
    gameRunningRef.current = Object.values(runningMap).some(Boolean)
  }, [runningMap])

  // Re-check while the launcher stays open (configurable, default 5 min) so a
  // running launcher notices a new release — the sidebar Update button appears
  // when one is published. Checks pause entirely while a game is running.
  useEffect(() => {
    if (!ready) return
    const sec = Math.max(15, Math.min(900, settings?.updateCheckIntervalSec ?? 300))
    const iv = setInterval(() => {
      if (gameRunningRef.current) return
      void checkForUpdates(true, true)
    }, sec * 1000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, settings?.updateCheckIntervalSec])

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
  const runningProfiles = runningMap

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
    runningProfiles,
    toasts,
    modals,
    profileOp,
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
    contentStack,
    pushContent,
    popContent,
    closeContent,
    runGuarded,
    updateInfo,
    checkForUpdates,
    dismissUpdatePrompt
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
