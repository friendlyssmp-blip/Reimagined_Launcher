import { useCallback, useEffect, useRef, useState } from 'react'
import { AppProvider, useApp } from './state/AppContext'
import { ContentOverlay } from './components/ContentOverlay'
import { Sidebar } from './components/Sidebar'
import { DownloadFlyover } from './components/DownloadFlyover'
import { TitleBar } from './components/TitleBar'
import { TopBar } from './components/TopBar'
import { Toasts } from './components/ui'
import { LoginModal } from './components/LoginModal'
import { ProfileModal } from './components/ProfileModal'
import { DuplicateModal } from './components/DuplicateModal'
import { ShareModal } from './components/ShareModal'
import { ExportZipModal } from './components/ExportZipModal'
import { ImportModal } from './components/ImportModal'
import { UpdateModal } from './components/UpdateModal'
import { CheckUpdatesModal } from './components/CheckUpdatesModal'
import { CrashModal } from './components/CrashModal'
import { ConfirmDialog } from './components/ConfirmDialog'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ProgressOverlay } from './components/ProgressOverlay'
import { api } from './lib/api'
import { sound } from './lib/sound'
import { setMusicMode, setMusicEnsureEnabled } from './lib/music'
import { setLanguage } from './lib/i18n'
import { setStreaming } from './lib/streaming'
import { SplashScreen } from './components/SplashScreen'
import { BrandLogo } from './components/BrandLogo'
import { HomePage } from './pages/HomePage'
import { PlayPage } from './pages/PlayPage'
import { ProfilesPage } from './pages/ProfilesPage'
import { ModsPage } from './pages/ModsPage'
import { ModsBrowsePage } from './pages/ModsBrowsePage'
import { ModpacksPage } from './pages/ModpacksPage'
import { ServersPage } from './pages/ServersPage'
import { SettingsPage } from './pages/SettingsPage'
import { DownloadsPage } from './pages/DownloadsPage'
import { LogsPage } from './pages/LogsPage'
import { AccountPage } from './pages/AccountPage'

/* Launcher navigation — global destinations at the top level, content
 * (mods/skins) reachable through their own sections and profile context. */
export type Page =
  | 'home'
  | 'play'
  | 'profiles'
  | 'mods'
  | 'browse'
  | 'modpacks'
  | 'servers'
  | 'downloads'
  | 'settings'
  | 'account'
  | 'logs'

function Shell() {
  const { ready, modals, theme, settings, setModals, account, closeContent, popContent, contentStack, updateSettings, activeProfile, running } = useApp()
  const [page, setPage] = useState<Page>('home')
  /* v1.0.53 — a quick, purposeful breath between pages: the current content
   * dips for ~120ms, the new page mounts and rises in (page-enter), landing
   * well under the 450ms target. Removes the hard cut without heavy work. */
  const [switching, setSwitching] = useState(false)
  const switchTimer = useRef(0)
  /* v1.0.86 — universal page history: the back arrow reverses the real
   * navigation path (never a hardcoded Home). */
  const [pageHistory, setPageHistory] = useState<Page[]>([])
  /* v1.0.86 — per-page scroll snapshots so Back lands where the user was
   * (spec: restore scroll position when returning to a previous page). */
  const pageScroll = useRef<Partial<Record<Page, number>>>({})
  const snapshotScroll = (): void => {
    if (!page) return
    const el = document.querySelector<HTMLElement>('.content')
    if (el) pageScroll.current[page] = el.scrollTop
  }
  const restoreScroll = (target: Page): void => {
    const saved = pageScroll.current[target]
    if (saved == null) return
    window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>('.content')
      if (el) el.scrollTop = saved
    }, 60)
  }
  /* v1.0.41 — login gate: without a signed-in account the launcher only shows
   * Home (login), Settings and Account. Play, Instances, Modpacks, Downloads
   * and Logs require a session — navigating to them redirects home. */
  // 'expired' (session expired) counts as NOT logged in - only a live
  // 'online' session unlocks Play/Instances/Modpacks/Downloads/Logs.
  const loggedIn = account.status === 'online'
  /* Live snapshot of the login state so the delayed page switch re-checks it. */
  const loggedInRef = useRef(loggedIn)
  loggedInRef.current = loggedIn
  const navigate = (p: Page): void => {
    closeContent()
    const locked = p === 'play' || p === 'profiles' || p === 'mods' || p === 'browse' || p === 'modpacks' || p === 'downloads' || p === 'logs'
    const next = locked && !loggedIn ? 'home' : p
    if (next === page) return
    setSwitching(true)
    window.clearTimeout(switchTimer.current)
    switchTimer.current = window.setTimeout(() => {
      /* v1.0.53 — re-check the login gate at fire time (logout during the
       * 120ms window must never land on a locked page). */
      const target = locked && !loggedInRef.current ? 'home' : next
      snapshotScroll()
      setPage(target)
      setPageHistory((h) => (h[h.length - 1] === target ? h : [...h, target]))
      restoreScroll(target)
      window.setTimeout(() => setSwitching(false), 300)
    }, 120)
  }
  useEffect(() => () => window.clearTimeout(switchTimer.current), [])

  /* v1.0.86 — Back reverses the real navigation path. */
  const goBackPage = (): void => {
    setPageHistory((h) => {
      if (h.length <= 1) return h
      const prev = h[h.length - 2]
      snapshotScroll()
      setSwitching(true)
      window.clearTimeout(switchTimer.current)
      switchTimer.current = window.setTimeout(() => {
        setPage(prev)
        restoreScroll(prev)
        setSwitching(false)
      }, 110)
      return h.slice(0, -1)
    })
  }
  /* If the account signs out while a locked page is open, drop back home. */
  useEffect(() => {
    if (!loggedIn && page !== 'home' && page !== 'settings' && page !== 'account') {
      setPage('home')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn])
  /* Share code arriving via a reimagined://share/<CODE> link (v1.0.19). */
  const [importCode, setImportCode] = useState<string | null>(null)
  /* Splash shows once per session (skippable, never blocks init). */
  const [splash, setSplash] = useState(() => sessionStorage.getItem('reimagined:splash') !== '1')

  /* v1.0.36 — Startup Animation off: skip the splash entirely and remember it
   * so toggling the animation back on mid-session never flashes the sequence. */
  useEffect(() => {
    if (splash && settings.startupAnimation === false) {
      setSplash(false)
      sessionStorage.setItem('reimagined:splash', '1')
    }
  }, [splash, settings.startupAnimation])

  /* v1.0.54 — stable identities for the splash callbacks. SplashScreen reads
   * them through refs and its effect runs once, so no parent re-render can
   * re-fire the startup sound (the inline-arrow props caused it to play
   * twice) or reset the splash finish state. */
  const startSplashSound = useCallback(() => {
    if (settings.startupSound !== false) sound.startup()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const finishSplash = useCallback(() => {
    setSplash(false)
    sessionStorage.setItem('reimagined:splash', '1')
  }, [])

  /* UI is permanently rendered at 100% logical scale (V2) — no user-facing
   * scale option. The layout stays responsive and adapts to the window size;
   * zoom-based scaling was removed so nothing ever blurs or clips.
   */
  useEffect(() => {
    localStorage.removeItem('reimagined:ui-scale')
  }, [])

  /* v1.0.19: reimagined://share/<CODE> deep links open the Import modal with
   * the code ready to preview — whether the link arrived before the UI was
   * ready (pending code) or while the launcher was already running (event). */
  useEffect(() => {
    if (!ready) return
    const openImport = (code: string) => {
      setImportCode(code)
      setModals({ importShare: true })
    }
    api.share
      .pendingCode()
      .then((c) => c && openImport(c))
      .catch(() => {})
    const off = api.onEvent((e) => {
      if (e.type === 'share:deep-link') {
        const code = (e.payload as { code?: string } | null)?.code
        if (code) openImport(code)
      }
      /* v1.0.88 — streaming/recording detection → smart background behavior. */
      if (e.type === 'streaming:changed') {
        setStreaming((e.payload as { active?: boolean; tools?: string[] } | null) ?? { active: false, tools: [] })
      }
    })
    return off
  }, [ready, setModals])

  /* Wire the premium sound library to the launcher's audio settings — every
   * change in Settings applies immediately. */
  useEffect(() => {
    sound.configure({
      enabled: settings?.audioEnabled ?? true,
      volume: settings?.audioVolume ?? 0.7,
      hover: settings?.audioHover ?? true,
      click: settings?.audioClick ?? true,
      notify: settings?.audioNotify ?? true,
      download: settings?.audioDownload ?? true,
      success: settings?.audioSuccess ?? true,
      error: settings?.audioError ?? true,
      // v1.0.94 — "Menu music" removed from Settings: the bundled menu loop
      // is always off. Only user-imported tracks (title bar / Settings
      // player) produce music, and they play regardless of this flag.
      music: false
    })
    sound.setMusicVolume(settings?.audioVolume ?? 0.7)
    /* v1.0.87 — keep the shared music controller's play-mode in sync so
       auto-advance honors shuffle/repeat even from the title-bar mini player. */
    setMusicMode(settings?.audioMusicShuffle ?? false, settings?.audioMusicRepeat ?? 'all')
    if (!(settings?.audioEnabled ?? true)) {
      sound.musicStop()
    } else {
      /* v1.0.94 — musicStart() is a no-op without a loaded track (menu loop
         off); it only starts custom library tracks. */
      sound.musicStart()
    }
  }, [settings])

  /* v1.0.88 — apply the saved language (and future re-applies when changed). */
  useEffect(() => {
    if (settings?.language) setLanguage(settings.language)
  }, [settings?.language])

  /* v1.0.88 — Discord Rich Presence: browsing the launcher vs playing.
   * Fails silently when Discord is not running or no client id is set. */
  const [presenceStarted, setPresenceStarted] = useState<number | null>(null)
  useEffect(() => {
    if (!settings?.discordPresence) {
      void api.presence.clear()
      return
    }
    if (running && activeProfile) {
      const st = presenceStarted ?? Date.now()
      if (presenceStarted === null) setPresenceStarted(st)
      void api.presence.set({
        details: 'Playing Minecraft',
        state: `${activeProfile.name} · ${activeProfile.minecraftVersion}`,
        largeImageKey: 'reimagined',
        smallImageKey: activeProfile.loader.type !== 'vanilla' ? activeProfile.loader.type : undefined,
        startTimestamp: st
      })
    } else {
      if (presenceStarted !== null) setPresenceStarted(null)
      void api.presence.set({
        details: 'Managing profiles in Reimagined',
        largeImageKey: 'reimagined',
        startTimestamp: undefined
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, page, activeProfile, settings?.discordPresence])

  /* v1.0.87 — starting a local track from anywhere (title bar / Settings)
     enables the music setting live so playback always works first try. */
  useEffect(() => {
    /* v1.0.94 — no music setting to enable anymore; just make sure the
       audio engine itself is on before a custom track starts. */
    setMusicEnsureEnabled(() => {
      if (!sound.isEnabled()) sound.setEnabled(true)
    })
    return () => setMusicEnsureEnabled(null)
  }, [])

  /* Global Minecraft-style UI sounds — delegated at the document level so
   * every button / nav item in the app gets the hover tick + click blip
   * without per-component wiring, and never double-fires on the same target. */
  useEffect(() => {
    /* Module-level last-hovered interactive element: moving between a button's
     * children (icon -> label) stays a single hover tick. */
    let lastHovered: HTMLElement | null = null
    const onOver = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null
      if (!t) return
      const el = t.closest<HTMLElement>('button, .nav-item, .chip, [role="button"]')
      if (el && el !== lastHovered) {
        lastHovered = el
        sound.hover()
      }
    }
    const onOut = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null
      if (t && t instanceof HTMLElement && t.closest('button, .nav-item, .chip, [role="button"]')) {
        lastHovered = null
      }
    }
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (!t) return
      /* v1.0.53 — elements that play their own cue (tabs, overflow menus) are
       * excluded so the generic click never double-fires or starves them. */
      if (t.closest('.tab, .overflow-menu, .modal-overlay')) return
      /* Navigation items get the connected tab cue; everything else the click. */
      if (t.closest('button, .nav-item, .chip, [role="button"]')) {
        if (t.closest('.nav-item')) sound.tab()
        else sound.click()
      }
    }
    /* Menu music starts on the first user gesture (autoplay policies). */
    const startMusic = () => {
      sound.musicStart()
      window.removeEventListener('pointerdown', startMusic)
      window.removeEventListener('keydown', startMusic)
    }
    window.addEventListener('pointerdown', startMusic)
    window.addEventListener('keydown', startMusic)
    document.addEventListener('pointerover', onOver, true)
    document.addEventListener('pointerout', onOut, true)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('pointerdown', startMusic)
      window.removeEventListener('keydown', startMusic)
      document.removeEventListener('pointerover', onOver, true)
      document.removeEventListener('pointerout', onOut, true)
      document.removeEventListener('click', onClick, true)
    }
  }, [])

  if (!ready) {
    return (
      <div className="boot-screen">
        <div className="boot-logo">
          <BrandLogo height={44} />
          <p>Minecraft, rebuilt around the player.</p>
        </div>
        <div className="boot-spinner" />
      </div>
    )
  }

  /* v1.0.53 — living background: CSS-only slow purple orbs + sparse dust, GPU
   * cheap, and it steps down on weak machines (≤4 threads or potato preset)
   * so the launcher stays light while Minecraft runs. */
  const liteBg =
    (typeof navigator !== 'undefined' && navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4) ||
    settings?.preset === 'potato'

  return (
    <div className="app" data-theme={theme} data-bg-lite={liteBg ? '1' : undefined}>
      <div className="bg-live" aria-hidden="true">
        <span className="bg-orb bg-orb-1" />
        <span className="bg-orb bg-orb-2" />
        <span className="bg-orb bg-orb-3" />
        {BG_DOTS.map((d, i) => (
          <span
            key={i}
            className="bg-dot"
            style={{
              left: `${d.left}%`,
              top: `${d.top}%`,
              width: d.size,
              height: d.size,
              animationDelay: `${d.delay}s`,
              animationDuration: `${d.dur}s`
            }}
          />
        ))}
      </div>
      <Sidebar page={page} onNavigate={navigate} />
      <div className={`main ${switching ? 'switching' : ''}`}>
        <TitleBar />
        {/* v1.0.54 — the global top-bar search is redundant on screens that
            have their own page-level search directly below it (Mods browse,
            Modpacks) — hide it there, keep it everywhere else. */}
        <TopBar
          onNavigate={navigate}
          hideSearch={page === 'mods' || page === 'modpacks' || page === 'browse'}
          onBack={pageHistory.length > 1 ? goBackPage : undefined}
        />
        {/* The scroll surface is NOT keyed (scroll position survives nav); the
           keyed ErrorBoundary remounts the page subtree, so .page-enter inside
           replays the page-level entrance animation on every section switch. */}
        <main className="content">
          <ErrorBoundary key={page} onHome={() => setPage('home')}>
            <div className="page-enter">
              {page === 'home' && <HomePage onNavigate={navigate} />}
              {page === 'play' && <PlayPage onNavigate={navigate} />}
              {page === 'profiles' && <ProfilesPage onNavigate={navigate} />}
              {page === 'mods' && <ModsPage />}
              {page === 'browse' && <ModsBrowsePage />}
              {page === 'modpacks' && <ModpacksPage />}
              {page === 'servers' && <ServersPage />}
              {page === 'settings' && <SettingsPage />}
              {page === 'downloads' && <DownloadsPage />}
              {page === 'logs' && <LogsPage />}
              {page === 'account' && <AccountPage onNavigate={navigate} />}
            </div>
          </ErrorBoundary>
        </main>
      </div>

      {/* Overlays */}
      <ProgressOverlay />
      <DownloadFlyover />
      {modals.login && <LoginModal />}
      {modals.profile && <ProfileModal mode={modals.profile.mode} profile={modals.profile.profile} />}
      {modals.duplicate && <DuplicateModal profile={modals.duplicate.profile} />}
      {modals.share && <ShareModal profile={modals.share.profile} />}
      {modals.exportZip && <ExportZipModal profile={modals.exportZip.profile} />}
      {modals.importShare && <ImportModal initialCode={importCode} />}
      {modals.update && <UpdateModal />}
      {modals.checkUpdates && <CheckUpdatesModal />}
      {modals.crash && <CrashModal />}
      {modals.confirm && <ConfirmDialog {...modals.confirm} />}
      <ContentOverlay />
      <Toasts />
      {splash && settings.startupAnimation !== false && (
        <SplashScreen onStart={startSplashSound} onDone={finishSplash} />
      )}

    </div>
  )
}

/* Deterministic sparse dust for the living background — pure transform/opacity. */
const BG_DOTS = Array.from({ length: 12 }, (_, i) => {
  const seed = ((i * 1301 + 5731) % 233280) / 233280
  return {
    left: 2 + seed * 96,
    top: 4 + ((i * 53) % 92),
    size: 1 + ((i * 3) % 2),
    delay: (i % 6) * 7,
    dur: 26 + ((i * 17) % 30)
  }
})

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
