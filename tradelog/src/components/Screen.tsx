import type { ReactNode } from 'react'

type Props = {
  title: string
  /** A button beside the title, e.g. refresh */
  action?: ReactNode
  children?: ReactNode
}

function Screen({ title, action, children }: Props) {
  return (
    <section className="px-safe pb-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="py-4 text-2xl font-semibold">{title}</h1>
        {action}
      </div>
      {children}
    </section>
  )
}

type EmptyStateProps = {
  title: string
  text: string
  icon?: ReactNode
  /** A next step, e.g. a link styled with emptyActionClass */
  action?: ReactNode
}

/** What a screen shows when it has nothing to list yet, and what to do about it. */
export function EmptyState({ title, text, icon, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-border bg-surface px-6 py-8 text-center">
      {icon && (
        <div className="mb-3 grid size-12 place-items-center rounded-full bg-accent/10 text-accent">
          {icon}
        </div>
      )}
      <p className="font-medium">{title}</p>
      <p className="mt-1 max-w-xs text-sm text-muted">{text}</p>
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  )
}

export default Screen
