import type { ReactNode } from 'react'
import Modal from './Modal.tsx'

type Props = {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  destructive,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <div className="text-muted">{children}</div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <button
          type="button"
          // Cancel gets focus so a stray Enter never confirms a destructive action
          autoFocus
          onClick={onCancel}
          className="rounded-xl border border-border py-3 font-medium"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={`rounded-xl py-3 font-semibold ${
            destructive ? 'bg-loss text-bg' : 'bg-accent text-bg'
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}

export default ConfirmDialog
