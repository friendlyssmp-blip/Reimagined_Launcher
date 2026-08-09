import { useApp } from '../state/AppContext'
import { SkinHeadPreview } from './SkinHead'
import { Badge, ProfileGlyph } from './ui'
import { api } from '../lib/api'
import { IconSearch, IconTerminal, IconSettings, IconBell } from './icons'
import type { Page } from '../App'

export function TopBar({ onNavigate, hideSearch = false }: { onNavigate: (p: Page) => void; hideSearch?: boolean }) {
  const { account, activeProfile, running, setModals, notify } = useApp()

  return (
    <div className="topbar">
      <div className="topbar-profile">
        {activeProfile ? (
          <>
            <div className={`tb-icon ${activeProfile.icon ? '' : 'plain'}`}>
              <ProfileGlyph icon={activeProfile.icon} name={activeProfile.name} />
            </div>
            <div>
              <b>{activeProfile.name}</b>
              <small>
                {activeProfile.minecraftVersion}
                <Badge variant={activeProfile.loader.type !== 'vanilla' ? 'accent' : 'default'}>
                  {activeProfile.loader.type}
                </Badge>
                <Badge>{activeProfile.memory}MB</Badge>
              </small>
            </div>
          </>
        ) : (
          <div>
            <b>No profile selected</b>
            <small>Create a profile to start playing</small>
          </div>
        )}
      </div>

      {/* v1.0.54 — hidden on screens that have their own page-level search
          (Mods, Modpacks) so there is never a confusing double search bar. */}
      {!hideSearch && (
        <div className="top-search">
          <IconSearch />
          <input
            className="input"
            placeholder={activeProfile ? `Search ${activeProfile.name}...` : 'Search mods...'}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                onNavigate('mods')
              }
            }}
          />
        </div>
      )}

      <div className="topbar-actions">
        <button
          className="btn-icon"
          title="Notifications"
          onClick={() => notify('info', 'Notifications', 'Updates and alerts will appear here.')}
        >
          <IconBell />
        </button>
        <button className="btn-icon" title={running ? 'Game console' : 'Console'} onClick={() => void api.console.open()}>
          <IconTerminal />
        </button>
        <button className="btn-icon" title="Settings" onClick={() => onNavigate('settings')}>
          <IconSettings />
        </button>
        <div
          className="topbar-account"
          onClick={() => (account.profile ? onNavigate('account') : setModals({ login: true }))}
          title={account.profile ? 'Open Account' : 'Sign in'}
        >
          {account.profile?.id ? (
            <SkinHeadPreview url={account.profile?.skins?.[0]?.url} size={36} />
          ) : (
            <div className="tb-icon plain" style={{ width: 36, height: 36 }}>
              {account.status === 'expired' ? '!' : '?'}
            </div>
          )}
          <div>
            <div className="ta-name">{account.profile?.name ?? (account.status === 'expired' ? 'Re-login' : 'Sign in')}</div>
            <small>{account.status === 'online' ? 'Online' : account.status === 'expired' ? 'Expired session' : 'Offline'}</small>
          </div>
        </div>
      </div>
    </div>
  )
}
