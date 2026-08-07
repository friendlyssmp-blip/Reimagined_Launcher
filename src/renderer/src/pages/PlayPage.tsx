import { useApp } from '../state/AppContext'
import { Button, Badge, Spinner, ProfileGlyph } from '../components/ui'
import { api } from '../lib/api'
import { IconPlay, IconStop, IconTerminal, IconLog, IconFolder } from '../components/icons'
import { humanDuration, timeAgo } from '../lib/format'
import type { Page } from '../App'

/** The primary launch experience — big play button, live launch progress,
 *  and the selected instance's full setup at a glance. */
export function PlayPage({ onNavigate }: { onNavigate: (p: Page) => void }) {
  const { profiles, activeProfile, setActiveProfile, launchProfile, stopLaunch, launch, running, settings, refreshProfiles, notify } = useApp()

  /* Real launch state (v1.0.16): busy = actually starting; playing = the
   * process is confirmed up. Never a stale/false launching state. */
  const busy = launch.phase === 'preparing' || launch.phase === 'downloading' || launch.phase === 'launching'

  const setRam = async (v: number) => {
    if (!activeProfile) return
    try {
      await api.profiles.update(activeProfile.id, { memory: v })
      await refreshProfiles()
    } catch {
      /* non-fatal */
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="section-head">
        <div>
          <h2 className="page-title">Play</h2>
          <p className="page-sub">Choose an instance and press play — the game runs in the background and the launcher stays usable.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="ghost" onClick={() => void api.console.open()}><IconTerminal /> Console</Button>
          <Button variant="ghost" onClick={() => onNavigate('logs')}><IconLog /> Logs</Button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">Instance</div>
        <div className="profile-switch" style={{ marginTop: 12 }}>
          {profiles.length === 0 && (
            <span className="muted" style={{ fontSize: 12 }}>No instances yet — create one from Instances.</span>
          )}
          {profiles.map((p) => (
            <button key={p.id} className={`chip ${activeProfile?.id === p.id ? 'active' : ''}`} onClick={() => setActiveProfile(p.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <span className="chip-glyph"><ProfileGlyph icon={p.icon} name={p.name} /></span>
              {p.name}
              <Badge variant={p.loader.type !== 'vanilla' ? 'accent' : 'default'}>{p.loader.type}</Badge>
            </button>
          ))}
        </div>
      </div>

      <div className="card" style={{ padding: '26px 28px', display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
        {/* Part 6 (V2) — the instance card shows the icon the user chose in
            Edit/creation (ProfileGlyph handles preset icons + uploaded photos);
            never a generic launcher logo or letter. */}
        <div className={`profile-avatar instance-avatar ${activeProfile?.icon ? '' : 'plain'}`}>
          {activeProfile ? <ProfileGlyph icon={activeProfile.icon} name={activeProfile.name} /> : '?'}
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="hero-tagline">Ready to play</div>
          <h2 style={{ fontSize: 24, color: '#fff', textShadow: '2px 2px 0 #3a3a3a, 4px 4px 0 rgba(0,0,0,0.5)' }}>
            {activeProfile ? activeProfile.name : 'No instance selected'}
          </h2>
          <div className="profile-meta" style={{ marginTop: 8 }}>
            {activeProfile && (
              <>
                <Badge>{activeProfile.minecraftVersion}</Badge>
                <Badge variant="accent">
                  {activeProfile.loader.type}
                  {activeProfile.loader.version ? ` ${activeProfile.loader.version}` : ''}
                </Badge>
                <Badge>{activeProfile.memory}MB</Badge>
              </>
            )}
          </div>
        </div>
        <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'stretch', minWidth: 200 }}>
          {running ? (
            <Button variant="danger" onClick={() => void stopLaunch()}><IconStop /> Stop game</Button>
          ) : (
            <Button variant="play" disabled={!activeProfile || busy} onClick={() => activeProfile && void launchProfile(activeProfile.id)}>
              {busy ? <><Spinner /> Launching…</> : <><IconPlay style={{ width: 18, height: 18 }} /> Play</>}
            </Button>
          )}
          {activeProfile && (
            <Button variant="ghost" size="sm" onClick={() => void api.content.openFolder(activeProfile.id)}>
              <IconFolder /> Open folder
            </Button>
          )}
        </div>
      </div>

      {(busy || running) && (
        <div className="panel dl-active">
          <div className="dl-active-head">
            <div className="dl-icon"><IconPlay /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{launch.message || (running ? 'Running' : 'Working…')}</b>
              <small>{running ? 'Minecraft is running — keep using the launcher freely.' : 'Downloading and preparing files…'}</small>
            </div>
          </div>
          {!running && (
            <>
              <div className="progress" style={{ marginTop: 12 }}><span style={{ width: `${Math.max(3, launch.percent ?? 0)}%` }} /></div>
              <div className="dl-meta"><span>Progress {Math.round(launch.percent ?? 0)}%</span></div>
            </>
          )}
        </div>
      )}

      {activeProfile && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
          <div className="panel">
            <div className="panel-title">Setup</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 12 }}>
              {[
                ['Minecraft', activeProfile.minecraftVersion],
                ['Loader', activeProfile.loader.type + (activeProfile.loader.version ? ` · ${activeProfile.loader.version}` : '')],
                ['Java', settings.javaPath || 'Auto (latest installed)'],
                ['Resolution', `${activeProfile.resolution.width}×${activeProfile.resolution.height}${activeProfile.resolution.fullscreen ? ' · fullscreen' : ''}`],
                ['Installed mods', String(activeProfile.mods.length)],
                ['Playtime', activeProfile.playtimeSeconds > 0 ? humanDuration(activeProfile.playtimeSeconds) : 'Not played yet'],
                ['Last played', timeAgo(activeProfile.lastLaunched)]
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
                  <span className="muted">{k}</span>
                  <b style={{ textAlign: 'right' }}>{v}</b>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-title">Memory</div>
            <p className="panel-sub">RAM allocated to this instance. Too much can hurt — 4–8 GB is the sweet spot for most setups.</p>
            <div style={{ marginTop: 16 }}>
              <div className="row">
                <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>Allocation</span>
                <Badge variant="accent">{activeProfile.memory}MB</Badge>
              </div>
              <input
                type="range"
                className="slider"
                min={1024}
                max={Math.max(activeProfile.memory, 16384)}
                step={512}
                value={activeProfile.memory}
                onChange={(e) => void setRam(Number(e.target.value))}
              />
              <div className="row" style={{ justifyContent: 'space-between', color: 'var(--text-3)', fontSize: 11 }}>
                <span>1 GB</span>
                <span>{(Math.max(activeProfile.memory, 16384) / 1024).toFixed(0)} GB</span>
              </div>
            </div>
            <div className="divider" />
            <div className="panel-title">Launch arguments</div>
            <p className="panel-sub">Custom JVM / game arguments for this instance (edit in Instances).</p>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {activeProfile.extraJvmArgs.trim() ? (
                <code className="mono" style={{ fontSize: 11, color: 'var(--text-2)', wordBreak: 'break-all' }}>{activeProfile.extraJvmArgs}</code>
              ) : (
                <span className="muted" style={{ fontSize: 12 }}>No custom JVM arguments.</span>
              )}
              {activeProfile.extraGameArgs.trim() ? (
                <code className="mono" style={{ fontSize: 11, color: 'var(--text-2)', wordBreak: 'break-all' }}>{activeProfile.extraGameArgs}</code>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
