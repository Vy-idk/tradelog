import type { ReactNode } from 'react'

type Props = {
  title: string
  /** A button beside the title, e.g. refresh */
  action?: ReactNode
  children?: ReactNode
}

function Screen({ title, action, children }: Props) {
  return (
    <section className="px-4 pb-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="py-4 text-2xl font-semibold">{title}</h1>
        {action}
      </div>
      {children}
    </section>
  )
}

export function EmptyState({ text }: { text: string }) {
  return (
    <p className="rounded-xl border border-border bg-surface p-6 text-center text-muted">
      {text}
    </p>
  )
}

export default Screen
