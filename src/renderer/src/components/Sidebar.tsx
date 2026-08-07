import { useState } from 'react'
import { useApp } from '../state/AppContext'
import { BrandLogo } from './BrandLogo'
import {
  IconHome,
  IconPlay,
  IconArchive,
  IconGrid,
  IconDownload,
  IconSettings,
  IconUser,
  IconLog,
  IconChevronLeft,
  IconChevronRight,
  IconRefresh
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
      /* Mods is intentionally NOT here — mods belong to a profile (loader),
       * so the only way in is clicking a profile/instance card. */
      { id: 'modpacks', label: 'Modpacks', icon: IconArchive },
      { id: 'profiles', label: 'Instances', icon: IconGrid }
    ]
  },
  {
    label: 'Library',
    items: [
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
      <div className="sidebar-logo">
        <span className="mark logo-mark">R</span>
        <BrandLogo height={24} className="logo-word" />
      </div>

      <nav className="nav">
        {navSections.map((section) => (
          <div key={section.label}>
            <div className="nav-section-label">{section.label}</div>
            {section.items.map(({ id, label, icon: Icon }) => (
              <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => onNavigate(id)} title={label}>
                <Icon />
                <span className="nav-label">{label}</span>
              </button>
            ))}
            {/* Update notification — sits right under the Account category,
             * only visible while a new GitHub release is available. */}
            {section.label === 'System' && updateInfo?.hasUpdate && (
              <button
                className="nav-item update-available"
                onClick={() => setModals({ update: true })}
                title={`Update available — v${updateInfo.latestVersion}`}
              >
                <IconRefresh />
                <span className="nav-label">Update v{updateInfo.latestVersion}</span>
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
