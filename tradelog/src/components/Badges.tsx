import type { Side } from '../db/schema.ts'

const base = 'rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide'

export function SideBadge({ side }: { side: Side }) {
  return (
    <span className={`${base} bg-border text-muted`}>{side === 'long' ? 'Long' : 'Short'}</span>
  )
}

export function StatusBadge({ open }: { open: boolean }) {
  return open ? (
    <span className={`${base} bg-open/15 text-open`}>Open</span>
  ) : (
    <span className={`${base} bg-border text-muted`}>Closed</span>
  )
}
