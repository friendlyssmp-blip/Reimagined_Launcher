import { useApp } from '../state/AppContext'
import { Button, Badge } from '../components/ui'
import { SkinHeadPreview } from '../components/SkinHead'
import { IconUser, IconLog } from '../components/icons'
import type { Page } from '../App'

/** The Microsoft account page — profile card, UUID, skin preview and logout. */
export function AccountPage({ onNavigate }: { onNavigate: (p: Page) => void }) {
  const { account, setModals, logout, notify } = useApp()
  const signedIn = account.status !== 'offline' && !!account.profile

  if (!signedIn) {
    return (
      <div className="panel" style={{ textAlign: 'center', padding: 52, maxWidth: 460, margin: '60px auto' }}>
        {/* v1.0.60 — was .progress-ring, which SPINS forever (it's the loader
            style) — the idle "Not signed in" screen looked like it was loading
            endlessly. The empty-state badge is a static, polished treatment. */}
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 860 }}>
      <div className="section-head">
        <div>
          <h2 className="page-title">Account</h2>
          <p className="page-sub">Your Microsoft account and Minecraft profile</p>
        </div>
      </div>

      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 22, padding: '24px 28px', flexWrap: 'wrap' }}>
        <div className="hero-face" style={{ width: 100, height: 100 }}>
          {p.id ? <SkinHeadPreview url={p.skins?.[0]?.url} size={84} /> : <IconUser style={{ width: 34, height: 34 }} />}
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="hero-tagline">{account.status === 'online' ? 'Online' : account.status === 'expired' ? 'Session expired' : 'Offline'}</div>
          <h2 style={{ fontSize: 24, color: 'var(--text-1)', textShadow: '0 2px 14px rgba(0, 0, 0, 0.45)' }}>{p.name}</h2>
          <div className="profile-meta" style={{ marginTop: 8 }}>
            <Badge>{account.status === 'online' ? 'Connected' : account.status === 'expired' ? 'Needs re-login' : 'Offline'}</Badge>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 170 }}>
          <Button variant="danger" onClick={confirmLogout}><IconLog style={{ width: 14, height: 14 }} /> Sign out</Button>
        </div>
      </div>

      <div className="panel">
          <div className="panel-title">Profile details</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
              <span className="muted">Username</span><b>{p.name}</b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
              <span className="muted">UUID</span>
              <b className="mono" style={{ fontSize: 11 }}>{p.id}</b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
              <span className="muted">Last refreshed</span>
              <b>{account.lastRefreshedAt ? new Date(account.lastRefreshedAt).toLocaleString() : '—'}</b>
            </div>
          </div>
        </div>
    </div>
  )
}
