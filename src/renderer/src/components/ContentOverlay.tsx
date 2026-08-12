import { useApp } from '../state/AppContext'
import { AuthorProfileView } from './AuthorProfile'
import { ProjectDetail } from './ProjectDetail'

/**
 * Content stack overlay (v1.0.86).
 *
 * Browser-like navigation for content: every project detail / author profile
 * opened from ANYWHERE is pushed onto a stack rendered here as a full-screen
 * overlay. Only the TOP entry is visible; the entries underneath stay mounted
 * (display:none) so their scroll/search/filter state survives navigating
 * deeper and is restored instantly on Back — arbitrary depth, no limits.
 */
export function ContentOverlay() {
  const { contentStack, popContent } = useApp()

  if (contentStack.length === 0) return null

  return (
    <div className="content-stack">
      {contentStack.map((view, i) => {
        const top = i === contentStack.length - 1
        const inner = view.kind === 'author' ? (
          <AuthorProfileView
            key={`${view.provider}:${view.username}`}
            provider={view.provider}
            username={view.username}
            displayName={view.displayName}
          />
        ) : (
          <ProjectDetail
            key={`${view.provider}:${view.projectId}`}
            provider={view.provider}
            projectId={view.projectId}
            projectType={(view.projectType ?? 'mod') as 'mod' | 'resourcepack' | 'datapack' | 'shader'}
            installed={null}
            onBack={popContent}
            onForward={() => {}}
            canBack={contentStack.length > 1}
            canForward={false}
            onClose={popContent}
            onInstalledChange={() => {}}
            contextLabel="Content"
          />
        )
        return (
          <div key={`${i}:${view.kind}`} className={`content-page${top ? ' content-page-top' : ''}`}>
            {inner}
          </div>
        )
      })}
    </div>
  )
}
