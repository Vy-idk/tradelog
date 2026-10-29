import { useEffect, useId, useRef, type ReactNode } from 'react'

type Props = {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** Top keeps dialogs with inputs clear of the on-screen keyboard */
  align?: 'center' | 'top'
}

/** Native <dialog>: focus trap, Escape to close and an inert background for free. */
function Modal({ open, onClose, title, children, align = 'center' }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      // A click on the dialog element itself (not its content) is a backdrop click
      onClick={(e) => e.target === ref.current && onClose()}
      className={`mx-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-border bg-surface p-0 text-inherit backdrop:bg-black/60 ${
        align === 'top' ? 'mt-[calc(env(safe-area-inset-top)+4rem)]' : 'my-auto'
      }`}
    >
      {open && (
        <div className="p-5">
          <h2 id={titleId} className="mb-3 text-lg font-semibold">
            {title}
          </h2>
          {children}
        </div>
      )}
    </dialog>
  )
}

export default Modal
