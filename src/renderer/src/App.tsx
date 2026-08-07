import { useEffect, useState } from 'react'
import { AppProvider, useApp } from './state/AppContext'
import { Sidebar } from './components/Sidebar'
import { DownloadFlyover } from './components/DownloadFlyover'
import { TitleBar } from './components/TitleBar'
import { TopBar } from './components/TopBar'
import { Toasts } from './components/ui'
import { LoginModal } from './components/LoginModal'
import { ProfileModal } from './components/ProfileModal'
import { DuplicateModal } from './components/DuplicateModal'
import { ShareModal } from './components/ShareModal'
import { ImportModal } from './components/ImportModal'
import { UpdateModal } from './components/UpdateModal'
import { CrashModal } from './components/CrashModal'
import { ConfirmDialog } from './components/ConfirmDialog'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ProgressOverlay } from './components/ProgressOverlay'
import { api } from './lib/api'
import { sound } from './lib/sound'
import { SplashScreen } from './components/SplashScreen'
import { BrandLogo } from './components/BrandLogo'
import { HomePage } from './pages/HomePage'
import { PlayPage } from './pages/PlayPage'
import { ProfilesPage } from './pages/ProfilesPage'
import { ModsPage } from './pages/ModsPage'
import { ModpacksPage } from './pages/ModpacksPage'
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
  | 'modpacks'
  | 'downloads'
  | 'settings'
  | 'account'
  | 'logs'

function Shell() {
  const { ready, modals, theme, settings, setModals } = useApp()
  const [page, setPage] = useState<Page>('home')
  /* Share code arriving via a reimagined://share/<CODE> link (v1.0.19). */
  const [importCode, setImportCode] = useState<string | null>(null)
  /* Splash shows once per session (skippable, never blocks init). */
  const [splash, setSplash] = useState(() => sessionStorage.getItem('reimagined:splash') !== '1')

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
      // Menu music is opt-in (off by default) — the Settings toggle controls
      // it live; the first pointerdown gesture unlocks the audio context.
      music: settings?.audioMusic ?? false,
      pack: settings?.audioPack ?? 'aurora'
    })
    sound.setMusicVolume(settings?.audioVolume ?? 0.7)
    if (!(settings?.audioEnabled ?? true) || !(settings?.audioMusic ?? false)) {
      sound.musicStop()
    } else {
      sound.musicStart()
    }
  }, [settings])

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
      if (t && t.closest('button, .nav-item, .chip, [role="button"]')) sound.click()
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

  return (
    <div className="app" data-theme={theme}>
      <Sidebar page={page} onNavigate={setPage} />
      <div className="main">
        <TitleBar />
        <TopBar onNavigate={setPage} />
        {/* The scroll surface is NOT keyed (scroll position survives nav); the
           keyed ErrorBoundary remounts the page subtree, so .page-enter inside
           replays the page-level entrance animation on every section switch. */}
        <main className="content">
          <ErrorBoundary key={page} onHome={() => setPage('home')}>
            <div className="page-enter">
              {page === 'home' && <HomePage onNavigate={setPage} />}
              {page === 'play' && <PlayPage onNavigate={setPage} />}
              {page === 'profiles' && <ProfilesPage onNavigate={setPage} />}
              {page === 'mods' && <ModsPage />}
              {page === 'modpacks' && <ModpacksPage />}
              {page === 'settings' && <SettingsPage />}
              {page === 'downloads' && <DownloadsPage />}
              {page === 'logs' && <LogsPage />}
              {page === 'account' && <AccountPage onNavigate={setPage} />}
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
      {modals.importShare && <ImportModal initialCode={importCode} />}
      {modals.update && <UpdateModal auto={modals.update === 'auto'} />}
      {modals.crash && <CrashModal />}
      {modals.confirm && <ConfirmDialog {...modals.confirm} />}
      <Toasts />
      {splash && (
        <SplashScreen
          onDone={() => {
            setSplash(false)
            sessionStorage.setItem('reimagined:splash', '1')
          }}
        />
      )}
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
