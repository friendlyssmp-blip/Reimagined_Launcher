import { useState } from 'react'
import { useApp } from '../state/AppContext'
import { Button, Badge, Spinner } from '../components/ui'
import { SkinHeadPreview } from '../components/SkinHead'
import { IconUser, IconLog, IconCopy, IconRefresh, IconExternal, IconShield } from '../components/icons'
import type { Page } from '../App'

/** Account — v1.0.85 rebuild. Same sign-in flow, plus real actions:
 *  manual session refresh, copy UUID, open the Microsoft account page. */
export function AccountPage({ onNavigate }: { onNavigate: (p: Page) => void }) {
  const { account, setModals, logout, notify, refreshAccount } = useApp()
  const [refreshing, setRefreshing] = useState(false)
  const signedIn = account.status !== 'offline' && !!account.profile

  if (!signedIn) {
    return (
      <div className="panel" style={{ textAlign: 'center', padding: 52, maxWidth: 460, margin: '60px auto' }}>
        <div className="empty-illustration" style={{ margin: '0 auto 18px', width: 76, height: 76 }}>
          <IconUser style={{ width: 34, height: 34 }} />
        </div>
        <h3 style={{ fontSize: 16, marginBottom: 8 }}>Not signed in</h3>
        <p className="panel-sub" style={{ marginBottom: 20 }}>
          Sign in with Microsoft to launch Minecraft and sync your account across the launcher.
        </p>
        <Button variant="primary" onClick={() => setModals({ login: true })}>Sign in with Microsoft</Button>
      </div>
    )
  }

  const p = account.profile!
  const expired = account.status === 'expired'

  const confirmLogout = () => {
    setModals({
      confirm: {
        title: 'Log out',
        message: `Log out of ${p.name}? You can sign back in at any time.`,
        confirmLabel: 'Log out',
        danger: true,
        onConfirm: async () => {
          try {
            await logout()
            notify('info', 'Signed out', `${p.name} was signed out.`)
          } catch (err) {
            notify('error', 'Could not sign out', err instanceof Error ? err.message : String(err))
          }
        }
      }
    })
  }

  const refreshSession = async () => {
    setRefreshing(true)
    try {
      await refreshAccount()
      notify('success', 'Session refreshed', 'Your Microsoft session is up to date.')
    } catch (err) {
      notify('error', 'Could not refresh session', err instanceof Error ? err.message : String(err))
    } finally {
      setRefreshing(false)
    }
  }

  const copyUuid = async () => {
    try {
      await navigator.clipboard.writeText(p.id)
      notify('success', 'UUID copied', 'Your player UUID is on the clipboard.')
    } catch {
      notify('error', 'Could not copy', 'Clipboard access was blocked.')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 860 }}>
      <div className="section-head">
        <div>
          <h2 className="page-title">Account</h2>
          <p className="page-sub">Your Microsoft account and Minecraft profile</p>
        </div>
      </div>

      <div className="card account-card" style={{ display: 'flex', alignItems: 'center', gap: 22, padding: '26px 28px', flexWrap: 'wrap' }}>
        <div className="hero-face" style={{ width: 104, height: 104 }}>
          {p.id ? <SkinHeadPreview url={p.skins?.[0]?.url} size={88} /> : <IconUser style={{ width: 34, height: 34 }} />}
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="hero-tagline">
            {account.status === 'online' ? 'Online' : account.status === 'expired' ? 'Session expired' : 'Offline'}
          </div>
          <h2 style={{ fontSize: 24, color: 'var(--text-1)', textShadow: '0 2px 14px rgba(0, 0, 0, 0.45)' }}>{p.name}</h2>
          <div className="profile-meta" style={{ marginTop: 8 }}>
            <Badge variant={expired ? 'danger' : account.status === 'online' ? 'success' : 'default'}>
              {account.status === 'online' ? 'Connected' : account.status === 'expired' ? 'Needs re-login' : 'Offline'}
            </Badge>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 200 }}>
          <Button variant="primary" disabled={refreshing} onClick={() => void refreshSession()}>
            {refreshing ? <><Spinner /> Refreshing…</> : <><IconRefresh style={{ width: 14, height: 14 }} /> Refresh session</>}
          </Button>
          <Button variant="ghost" onClick={() => void copyUuid()}>
            <IconCopy style={{ width: 14, height: 14 }} /> Copy UUID
          </Button>
          <Button variant="ghost" onClick={() => window.open('https://account.microsoft.com', '_blank')}>
            <IconExternal style={{ width: 14, height: 14 }} /> Microsoft account
          </Button>
          <Button variant="danger" onClick={confirmLogout}><IconLog style={{ width: 14, height: 14 }} /> Sign out</Button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">Profile details</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
            <span className="muted">Username</span><b>{p.name}</b>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, alignItems: 'center' }}>
            <span className="muted">UUID</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <b className="mono" style={{ fontSize: 11 }}>{p.id}</b>
              <button className="btn btn-icon" title="Copy UUID" aria-label="Copy UUID" onClick={() => void copyUuid()}>
                <IconCopy style={{ width: 13, height: 13 }} />
              </button>
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
            <span className="muted">Last refreshed</span>
            <b>{account.lastRefreshedAt ? new Date(account.lastRefreshedAt).toLocaleString() : '—'}</b>
          </div>
        </div>
      </div>

      <div className="panel" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <IconShield style={{ width: 16, height: 16, color: 'var(--text-3)', flexShrink: 0 }} />
        <p style={{ color: 'var(--text-3)', fontSize: 12, lineHeight: 1.55 }}>
          Your session is stored securely and refreshed automatically when needed.
          If the game ever asks you to sign in again, press <b>Refresh session</b> here first.
        </p>
      </div>
    </div>
  )
}
