import type { ReactNode } from 'react'

type Props = {
  label: string
  value: string
  /** Text color class for the value, e.g. from pnlColor */
  valueClass?: string
  detail?: ReactNode
}

function StatCard({ label, value, valueClass = '', detail }: Props) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={`mt-1 truncate text-xl font-semibold tabular-nums ${valueClass}`}>{value}</dd>
      {detail && <dd className="mt-0.5 truncate text-xs text-muted tabular-nums">{detail}</dd>}
    </div>
  )
}

/** Titled card that holds a chart or breakdown on the Stats screen. */
export function ChartCard({
  title,
  aside,
  children,
}: {
  title: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-3">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="font-medium">{title}</h2>
        {aside && <span className="truncate text-sm text-muted tabular-nums">{aside}</span>}
      </div>
      {children}
    </section>
  )
}

export default StatCard
