import { api } from '../lib/api'
import { BrandLogo } from './BrandLogo'

export function TitleBar() {
  return (
    <div className="titlebar">
      <div className="titlebar-brand">
        <BrandLogo height={13} />
      </div>
      <div className="titlebar-btns">
      <button className="titlebar-btn" onClick={() => api.window.minimize()}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14"/></svg>
      </button>
      <button className="titlebar-btn" onClick={() => api.window.toggleMaximize()}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>
      </button>
      <button className="titlebar-btn close" onClick={() => api.window.close()}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
      </div>
    </div>
  )
}
