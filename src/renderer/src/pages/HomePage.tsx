import { useApp } from '../state/AppContext'
import { Button, Badge, Spinner, ProfileGlyph } from '../components/ui'
import { SkinHeadPreview } from '../components/SkinHead'
import { IconPlay, IconGrid, IconPuzzle, IconSparkle, IconGamepad } from '../components/icons'
import type { Page } from '../App'

function Greeting() {
  const h = new Date().getHours()
  if (h < 6) return 'Night owl'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function fmtPlaytime(seconds: number): string {
  if (seconds <= 0) return 'Not played yet'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const activityIcons: Record<string, typeof IconSparkle> = {
  auth: IconSparkle,
  profile_created: IconGrid,
  profile_deleted: IconGrid,
  launch: IconGamepad,
  mods: IconPuzzle,
  system: IconSparkle
}

export function HomePage({ onNavigate }: { onNavigate: (p: Page) => void }) {
  const { account, activeProfile, profiles, launchProfile, running, setModals, setActiveProfile, settings } = useApp()

  const signedIn = account.status !== 'offline'
  const recent = settings.recentActivity ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="hero">
        <div>
          <div className="hero-tagline">Minecraft, rebuilt around the player.</div>
          <h1>{Greeting()}{account.profile ? `, ${account.profile.name}` : ''}</h1>
          <p>Create, manage, and launch your perfect Minecraft experience with a premium launcher built for modders.</p>
          <div className="hero-actions">
            {signedIn && activeProfile ? (
              <Button variant="play" disabled={running} onClick={() => launchProfile(activeProfile.id)}>
                {running ? <><Spinner /> Launching…</> : <><IconPlay style={{ width: 16, height: 16 }} /> Play Minecraft</>}
              </Button>
            ) : signedIn ? (
              // Signed in but no profiles yet — never show a login prompt here.
              <Button variant="primary" onClick={() => onNavigate('profiles')}>Create your first profile</Button>
            ) : (
              <Button variant="primary" onClick={() => setModals({ login: true })}>Sign in with Microsoft</Button>
            )}
            {signedIn && !activeProfile && (
              <Button variant="ghost" onClick={() => onNavigate('profiles')}>Profiles</Button>
            )}
          </div>
        </div>
        {signedIn && account.profile?.id && (
          <div className="hero-stage">
            <div className="hero-face">
              <SkinHeadPreview url={account.profile?.skins?.[0]?.url} size={96} />
            </div>
          </div>
        )}
      </div>

      {signedIn && profiles.length > 0 && (
        <div className="home-grid">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="panel">
              <div className="panel-title">Active Profile</div>
              <div className="profile-switch" style={{ marginTop: 12 }}>
                {profiles.slice(0, 8).map((p) => (
                  <button key={p.id} className={`chip ${activeProfile?.id === p.id ? 'active' : ''}`} onClick={() => setActiveProfile(p.id)}>
                    {p.name}
                    <Badge variant={p.loader.type !== 'vanilla' ? 'accent' : 'default'}>{p.loader.type}</Badge>
                  </button>
                ))}
                <button className="chip" onClick={() => onNavigate('profiles')}>+ All profiles</button>
              </div>
            </div>

            {activeProfile && (
              <div className="stat-grid">
                <div className="stat"><b>{activeProfile.minecraftVersion}</b><span>Version</span></div>
                <div className="stat"><b>{activeProfile.loader.type}</b><span>Loader</span></div>
                <div className="stat"><b>{activeProfile.mods.length}</b><span>Mods</span></div>
                <div className="stat"><b>{activeProfile.memory}MB</b><span>RAM</span></div>
              </div>
            )}

            <div className="panel">
              <div className="panel-title">Recent Activity</div>
              {recent.length === 0 ? (
                <p style={{ color: 'var(--text-3)', fontSize: 13, marginTop: 10 }}>
                  Your actions will appear here — launches, profile changes and more.
                </p>
              ) : (
                <div className="activity-list" style={{ marginTop: 8 }}>
                  {recent.slice(0, 8).map((a, i) => {
                    const Icon = activityIcons[a.type] ?? IconSparkle
                    return (
                      <div key={i} className="activity-item">
                        <div className="activity-icon"><Icon /></div>
                        <div className="activity-text">{a.label}</div>
                        <div className="activity-time">{timeAgo(a.at)}</div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="panel">
              <div className="panel-title">Current Profile</div>
              {activeProfile ? (
                <>
                  <div className="profile-card-head" style={{ marginTop: 10 }}>
                    <div className={`profile-avatar ${activeProfile.icon ? '' : 'plain'}`}>
                      <ProfileGlyph icon={activeProfile.icon} name={activeProfile.name} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div className="profile-name">{activeProfile.name}</div>
                      <div className="profile-meta">
                        <Badge>{activeProfile.minecraftVersion}</Badge>
                        <Badge variant="accent">{activeProfile.loader.type}</Badge>
                      </div>
                    </div>
                  </div>
                  <div className="divider" />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span className="muted">Playtime</span>
                      <b>{fmtPlaytime(activeProfile.playtimeSeconds)}</b>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span className="muted">Last played</span>
                      <b>{activeProfile.lastLaunched ? timeAgo(activeProfile.lastLaunched) : 'Never'}</b>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span className="muted">Installed mods</span>
                      <b>{activeProfile.mods.length}</b>
                    </div>
                  </div>
                  <Button variant="play" style={{ width: '100%', marginTop: 16 }} disabled={running} onClick={() => launchProfile(activeProfile.id)}>
                    {running ? <><Spinner /> Launching…</> : <><IconPlay style={{ width: 15, height: 15 }} /> Play {activeProfile.name}</>}
                  </Button>
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: '18px 0' }}>
                  <p style={{ color: 'var(--text-3)', fontSize: 13, marginBottom: 14 }}>No profile selected yet.</p>
                  <Button variant="primary" onClick={() => onNavigate('profiles')}>Create a profile</Button>
                </div>
              )}
            </div>

            <div className="panel">
              <div className="panel-title">News & Updates</div>
              <p style={{ color: 'var(--text-3)', fontSize: 13, marginTop: 8, lineHeight: 1.5 }}>
                Coming soon — Minecraft news and launcher updates will appear here.
              </p>
            </div>
          </div>
        </div>
      )}

      {!signedIn && (
        <div className="panel" style={{ textAlign: 'center', padding: 44 }}>
          <h3 style={{ marginBottom: 8 }}>Welcome to Reimagined</h3>
          <p style={{ color: 'var(--text-2)', marginBottom: 18, fontSize: 14 }}>Sign in to create profiles, install mods, and launch Minecraft.</p>
          <Button variant="primary" onClick={() => setModals({ login: true })}>Login with Microsoft</Button>
        </div>
      )}
    </div>
  )
}
