import { useState } from 'react'
import { useApp } from '../state/AppContext'
import { SkinHeadPreview } from './SkinHead'
import { BrandLogo } from './BrandLogo'
import {
  IconHome,
  IconPlay,
  IconPuzzle,
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
      { id: 'mods', label: 'Mods', icon: IconPuzzle },
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
  const { account, running, stopLaunch, setModals, settings, updateInfo } = useApp()
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
        <div
          className="status-pill"
          onClick={() => (account.status === 'offline' ? setModals({ login: true }) : onNavigate('account'))}
          title={account.profile ? `${account.profile.name} — click to open Account` : 'Not signed in'}
        >
          <span className={`status-dot ${account.status === 'online' ? 'online' : ''}`} />
          {account.profile?.skins?.[0]?.url ? <SkinHeadPreview url={account.profile?.skins?.[0]?.url} size={26} /> : <IconUser style={{ width: 17, height: 17, flex: '0 0 auto' }} />}
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {account.profile ? account.profile.name : account.status === 'expired' ? 'Re-login' : 'Sign in'}
          </span>
          {!collapsed && <span className="badge" style={{ fontSize: 10, flex: '0 0 auto' }}>{settings.memory}MB</span>}
        </div>
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
