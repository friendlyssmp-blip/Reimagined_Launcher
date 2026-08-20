import { useState } from 'react'
import { useApp } from '../state/AppContext'
import { useT } from '../lib/i18n'
import {
  IconHome,
  IconPlay,
  IconArchive,
  IconGrid,
  IconDownload,
  IconSettings,
  IconUser,
  IconLog,
  IconPuzzle,
  IconGlobe,
  IconKeyboard,
  IconChevronLeft,
  IconChevronRight
} from './icons'
import type { Page } from '../App'

type NavSection = { id: string; labelKey: string; items: { id: Page; labelKey: string; icon: typeof IconHome }[] }

/* Official-launcher-style navigation: global + account destinations stay at
 * the top level; mod/content destinations live under their own sections.
 * v1.0.88 — labels are i18n keys resolved at render time via useT(). */
const navSections: NavSection[] = [
  {
    id: 'main',
    labelKey: 'nav.main',
    items: [
      { id: 'home', labelKey: 'nav.home', icon: IconHome },
      { id: 'play', labelKey: 'nav.play', icon: IconPlay }
    ]
  },
  {
    id: 'games',
    labelKey: 'nav.games',
    items: [
      /* v1.0.82 — the global content browser lives here: browse Modrinth +
       * CurseForge for ANY Minecraft version/loader (mods, packs, shaders,
       * worlds) and install into any instance. The per-profile mod manager is
       * still reached by clicking an instance card (Library → Instances). */
      { id: 'browse', labelKey: 'nav.mods', icon: IconPuzzle },
      { id: 'modpacks', labelKey: 'nav.modpacks', icon: IconArchive },
      /* v1.0.88 — Servers lives in the Games section. */
      { id: 'servers', labelKey: 'nav.servers', icon: IconGlobe }
    ]
  },
  {
    id: 'library',
    labelKey: 'nav.library',
    items: [
      /* v1.0.82 — Instances moved here from Games: Library is where your
       * owned content lives (instances + downloads). */
      { id: 'profiles', labelKey: 'nav.instances', icon: IconGrid },
      { id: 'downloads', labelKey: 'nav.downloads', icon: IconDownload }
    ]
  },
  {
    id: 'system',
    labelKey: 'nav.system',
    items: [
      { id: 'settings', labelKey: 'nav.settings', icon: IconSettings },
      /* v2.1.0 — in-game keybinds manager (reads/writes each instance's options.txt) */
      { id: 'keybinds', labelKey: 'nav.keybinds', icon: IconKeyboard },
      { id: 'account', labelKey: 'nav.account', icon: IconUser }
    ]
  }
]

export function Sidebar({ page, onNavigate }: { page: Page; onNavigate: (p: Page) => void }) {
  const { running, stopLaunch, setModals, updateInfo } = useApp()
  const t = useT()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('reimagined:sidebar-collapsed') === '1')

  const toggleCollapse = () => {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('reimagined:sidebar-collapsed', next ? '1' : '0')
  }

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      {/* v1.0.35 — the sidebar wordmark above MAIN was removed; the sidebar now
       * starts directly with the navigation. The header-bar branding stays. */}
      <nav className="nav">
        {navSections.map((section) => (
          <div key={section.id}>
            <div className="nav-section-label">{t(section.labelKey)}</div>
            {section.items.map(({ id, labelKey, icon: Icon }) => {
              const label = t(labelKey)
              return (
                <button key={id} data-nav={id} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => onNavigate(id)} title={label}>
                  <Icon />
                  <span className="nav-label">{label}</span>
                </button>
              )
            })}
            {/* v1.0.35 — minimal update control under the Account category: a
             * clean down-arrow icon (no text). Hover shows the version tooltip.
             * Clicking runs the exact same update flow as before. */}
            {section.id === 'system' && updateInfo?.hasUpdate && (
              <button
                className="nav-item update-available"
                onClick={() => setModals({ update: true })}
                aria-label={t('update.available')}
                data-tip={`${t('update.available')}: v${updateInfo.latestVersion}`}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 4v11" />
                  <path d="m6 11 6 6 6-6" />
                </svg>
                <span className="nav-label">{t('update.available')}</span>
                <span className="update-dot" />
              </button>
            )}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        {running && (
          <div className="status-pill" onClick={() => stopLaunch()} title={t('tooltip.stop')}>
            <span className="status-dot running" />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t('sidebar.stop')}</span>
          </div>
        )}
        {/* The account card (face + name) that used to sit above Logs is gone —
         * account lives in the System → Account page and the top bar now. */}
        <button className="nav-item" onClick={() => onNavigate('logs')} title={t('nav.logs')}>
          <IconLog />
          <span className="nav-label">{t('nav.logs')}</span>
        </button>
        <button className="nav-item" onClick={toggleCollapse} title={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}>
          {collapsed ? <IconChevronRight /> : <IconChevronLeft />}
          <span className="nav-label">{t('sidebar.collapse')}</span>
        </button>
      </div>
    </aside>
  )
}
