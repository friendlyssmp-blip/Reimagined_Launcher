import { useState } from 'react'
import { useApp } from '../state/AppContext'
import { Modal, Button } from './ui'
import type { ModalState } from '../state/AppContext'

export function ConfirmDialog({ title, message, confirmLabel, danger, option, onConfirm }: ModalState['confirm'] & {}) {
  const { setModals } = useApp()
  const [checked, setChecked] = useState(option?.defaultChecked ?? false)
  const confirm = () => {
    try {
      onConfirm({ optionChecked: checked })
    } finally {
      setModals({ confirm: null })
    }
  }
  return (
    <Modal
      title={title}
      onClose={() => setModals({ confirm: null })}
      footer={
        <>
          <Button onClick={() => setModals({ confirm: null })}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={confirm}>
            {confirmLabel ?? 'Confirm'}
          </Button>
        </>
      }
    >
      <p style={{ color: 'var(--text-2)', fontSize: 14, lineHeight: 1.55 }}>{message}</p>
      {option && (
        <label
          className="confirm-option"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginTop: 16,
            padding: '12px 14px',
            background: 'var(--bg-2)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            cursor: 'pointer',
            userSelect: 'none'
          }}
        >
          <span className="switch">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            <span className="track" />
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: danger ? 'var(--danger)' : 'var(--text-1)' }}>
            {option.label}
          </span>
        </label>
      )}
    </Modal>
  )
}
