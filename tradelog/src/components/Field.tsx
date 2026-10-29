import type { ReactNode } from 'react'

type Props = {
  id: string
  label: string
  error?: string
  hint?: string
  className?: string
  children: ReactNode
}

/** Label + control + error message. Spread fieldA11y(id, error) onto the control. */
function Field({ id, label, error, hint, className, children }: Props) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm text-muted">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-sm text-loss">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1 text-xs text-muted">{hint}</p>
      )}
    </div>
  )
}

export default Field
