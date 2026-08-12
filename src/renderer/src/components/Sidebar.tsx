import { useState } from 'react'
import { useApp } from '../state/AppContext'
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
  IconChevronLeft,
  IconChevronRight
} from './icons'
import type { Page } from '../App'

type NavSection = { label: string; items: { id: Page; label: string; icon: typeof IconHome }[] }

/* Official-launcher-style navigation: global + account destinations stay at
 * the top level; mod/content destinations live under their own sections. */
const navSections: NavSection[] = [
  {
    label: 'Main',
    items: [
      { id: 'home', label: 'Home', icon: IconHome },
      { id: 'play', label: 'Play', icon: IconPlay }
    ]
  },
  {
    label: 'Games',
    items: [
      /* v1.0.82 — the global content browser lives here: browse Modrinth +
       * CurseForge for ANY Minecraft version/loader (mods, packs, shaders,
       * worlds) and install into any instance. The per-profile mod manager is
       * still reached by clicking an instance card (Library → Instances). */
      { id: 'browse', label: 'Mods', icon: IconPuzzle },
      { id: 'modpacks', label: 'Modpacks', icon: IconArchive }
    ]
  },
  {
    label: 'Library',
    items: [
      /* v1.0.82 — Instances moved here from Games: Library is where your
       * owned content lives (instances + downloads). */
      { id: 'profiles', label: 'Instances', icon: IconGrid },
      { id: 'downloads', label: 'Downloads', icon: IconDownload }
    ]
  },
  {
    label: 'System',
    items: [
      { id: 'settings', label: 'Settings', icon: IconSettings },
      { id: 'account', label: 'Account', icon: IconUser }
    ]
  }
]

export function Sidebar({ page, onNavigate }: { page: Page; onNavigate: (p: Page) => void }) {
  const { running, stopLaunch, setModals, updateInfo } = useApp()
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
          <div key={section.label}>
            <div className="nav-section-label">{section.label}</div>
            {section.items.map(({ id, label, icon: Icon }) => (
              <button key={id} data-nav={id} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => onNavigate(id)} title={label}>
                <Icon />
                <span className="nav-label">{label}</span>
              </button>
            ))}
            {/* v1.0.35 — minimal update control under the Account category: a
             * clean down-arrow icon (no text). Hover shows the version tooltip.
             * Clicking runs the exact same update flow as before. */}
            {section.label === 'System' && updateInfo?.hasUpdate && (
              <button
                className="nav-item update-available"
                onClick={() => setModals({ update: true })}
                aria-label="Update available"
                data-tip={`Update available: v${updateInfo.latestVersion}`}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 4v11" />
                  <path d="m6 11 6 6 6-6" />
                </svg>
                <span className="nav-label">Update available</span>
                <span className="update-dot" />
              </button>
            )}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        {running && (
          <div className="status-pill" onClick={() => stopLaunch()} title="Click to stop">
            <span className="status-dot running" />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>Running — stop</span>
          </div>
        )}
        {/* The account card (face + name) that used to sit above Logs is gone —
         * account lives in the System → Account page and the top bar now. */}
        <button className="nav-item" onClick={() => onNavigate('logs')} title="Logs">
          <IconLog />
          <span className="nav-label">Logs</span>
        </button>
        <button className="nav-item" onClick={toggleCollapse} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <IconChevronRight /> : <IconChevronLeft />}
          <span className="nav-label">Collapse</span>
        </button>
      </div>
    </aside>
  )
}
