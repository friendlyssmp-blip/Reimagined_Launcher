import { useState, useEffect } from 'react'
import { useApp } from '../state/AppContext'
import { Modal, Button, Spinner } from './ui'
import { BrandLogo } from './BrandLogo'
import { api, friendlyError } from '../lib/api'
import { IconCopy, IconCheck } from './icons'

export function LoginModal() {
  const { setModals, account, refreshAccount } = useApp()
  const [step, setStep] = useState<'choose' | 'waiting' | 'error'>('choose')
  const [code, setCode] = useState('')
  const [uri, setUri] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [copied, setCopied] = useState(false)

  /** Copy the verification code to the clipboard with inline feedback. */
  const copyCode = async () => {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      // Fallback for restricted webviews.
      const ta = document.createElement('textarea')
      ta.value = code
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
      } catch {
        /* ignore */
      }
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Part 13 — the login screen reads the SAME account source as the rest of
  // the app (AppContext.account). The moment the account flips to logged-in
  // (via the push event OR the fallback poll below), close the modal
  // automatically. The account state update is what re-renders Home,
  // TopBar and Sidebar — one shared source of truth.
  useEffect(() => {
    if (account.status !== 'offline' && account.profile) {
      setModals({ login: false })
    }
  }, [account, setModals])

  // Fallback: while waiting for the device code, refresh the shared account
  // state every 3s. If the success event was ever dropped or raced, this
  // still flips the UI to logged-in (the reactive effect above closes the
  // modal once account becomes available) — no manual refresh or retry.
  useEffect(() => {
    if (step !== 'waiting') return
    let alive = true
    const poll = async () => {
      if (!alive) return
      await refreshAccount()
    }
    void poll()
    const t = setInterval(poll, 3000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [step, refreshAccount])

  const startLogin = async () => {
    try {
      setStep('waiting')
      const r = await api.auth.start()
      setCode(r.userCode)
      setUri(r.verificationUri)
    } catch (err) {
      setStep('error')
      setErrorMsg(friendlyError(err))
    }
  }

  const close = () => setModals({ login: false })

  return (
    <Modal title="Sign in with Microsoft" onClose={close}>
      {step === 'choose' && (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <BrandLogo height={26} style={{ margin: '0 auto 20px' }} />
          <div className="empty-illustration" style={{ margin: '0 auto 18px', width: 76, height: 76 }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 2v6M3 2v6M21 14v8H3v-8M3 8h18M3 14h18" />
              <rect x="5" y="4" width="4" height="3" /><rect x="9" y="4" width="4" height="3" />
            </svg>
          </div>
          <h3 style={{ fontSize: 18, marginBottom: 8 }}>Login with Microsoft</h3>
          <p style={{ color: 'var(--text-2)', marginBottom: 22, fontSize: 14, maxWidth: 380, marginInline: 'auto', lineHeight: 1.55 }}>
            Sign in with your Microsoft account to play Minecraft. Your password never touches this launcher — authentication happens on Microsoft's official servers.
          </p>
          <Button variant="primary" onClick={startLogin} style={{ padding: '12px 28px', fontSize: 14 }}>
            Continue with Microsoft
          </Button>
        </div>
      )}
      {step === 'waiting' && (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <p style={{ color: 'var(--text-2)', marginBottom: 14, fontSize: 14 }}>
            Open{' '}
            <a href={uri} target="_blank" rel="noreferrer" className="link">{uri}</a>{' '}
            in your browser and enter this code:
          </p>
          <div className="auth-code" onClick={copyCode} title="Click to copy">{code}</div>
          <div style={{ marginTop: 10 }}>
            <Button size="sm" variant="ghost" onClick={copyCode} disabled={copied}>
              {copied
                ? <><IconCheck style={{ width: 13, height: 13 }} /> Copied!</>
                : <><IconCopy style={{ width: 13, height: 13 }} /> Copy code</>}
            </Button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 14, color: 'var(--text-3)', fontSize: 13 }}>
            <Spinner lg /> Waiting for sign-in…
          </div>
          <div style={{ marginTop: 16 }}>
            <Button variant="ghost" onClick={() => { api.auth.cancel().catch(() => {}); setStep('choose') }}>Cancel</Button>
          </div>
        </div>
      )}
      {step === 'error' && (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div className="banner" style={{ marginBottom: 18 }}>{errorMsg}</div>
          <Button onClick={startLogin}>Try again</Button>
        </div>
      )}
    </Modal>
  )
}
