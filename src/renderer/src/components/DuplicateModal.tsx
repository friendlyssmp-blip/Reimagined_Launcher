import { useState } from 'react'
import { useApp } from '../state/AppContext'
import { Modal, Button, Field, TextInput, Toggle } from './ui'
import { api, friendlyError } from '../lib/api'
import type { Profile } from '@shared/types'

/**
 * Duplicate Profile dialog (right-click → Duplicate).
 *
 * Prompts for a new name (pre-filled "<Original> (Copy)") and whether to
 * also copy worlds/saves (default: off — a duplicate is a variant to
 * experiment with, not a backup). Real progress runs in the main process
 * and is shown via the ProgressOverlay.
 */
export function DuplicateModal({ profile }: { profile: Profile }) {
  const { setModals, notify, refreshProfiles } = useApp()
  const [name, setName] = useState(`${profile.name} (Copy)`)
  const [copyWorlds, setCopyWorlds] = useState(false)
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      const copy = await api.profiles.duplicate(profile.id, { name: name.trim(), copyWorlds })
      await refreshProfiles()
      setModals({ duplicate: null })
      notify('success', 'Profile duplicated', `${profile.name} → ${copy.name}`)
    } catch (err) {
      notify('error', 'Could not duplicate profile', friendlyError(err))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Duplicate Profile"
      onClose={() => setModals({ duplicate: null })}
      footer={
        <>
          <Button onClick={() => setModals({ duplicate: null })}>Cancel</Button>
          <Button variant="primary" onClick={run} disabled={!name.trim() || busy}>
            {busy ? 'Duplicating…' : 'Duplicate'}
          </Button>
        </>
      }
    >
      <div style={{ padding: '6px 2px' }}>
        <Field label="New Profile Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="My Variant (Copy)" />
        </Field>
        <p style={{ color: 'var(--text-3)', fontSize: 12.5, lineHeight: 1.5, marginTop: 4 }}>
          Copies the original's setup: Minecraft version, loader, RAM, JVM args and all installed mods
          (resource packs, shaders and config included). A brand-new, fully independent profile is created —
          editing or deleting it never affects the original.
        </p>
        <div style={{ marginTop: 14 }}>
          <Toggle checked={copyWorlds} onChange={setCopyWorlds} label="Also copy worlds / saves" />
          <p style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 6 }}>
            Off by default — a duplicate is meant as a fresh variant to experiment with.
          </p>
        </div>
      </div>
    </Modal>
  )
}
