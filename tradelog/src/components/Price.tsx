import type { Quote } from '../db/schema.ts'
import { formatClock, formatPrice, formatSignedPercent } from '../lib/format.ts'
import { isStale, quoteErrorShort, type QuoteError } from '../lib/prices.ts'
import { pnlColor } from './styles.ts'

/** "Stale · 10:42 AM" in amber, when a price may be out of date. */
export function StaleLabel({
  quote,
  failure,
  now,
}: {
  quote: Quote
  failure: QuoteError | undefined
  now: number
}) {
  if (!isStale(quote, failure, now)) return null
  return (
    <span
      title={`Last updated ${formatClock(quote.fetchedAt)}`}
      className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-amber-300"
    >
      Stale · {formatClock(quote.fetchedAt)}
    </span>
  )
}

/**
 * Price and today's change for a list row, or what went wrong. A stale price
 * still shows, labelled with its time.
 */
export function PriceCell({
  quote,
  failure,
  loading,
  now,
}: {
  quote: Quote | undefined
  failure: QuoteError | undefined
  loading: boolean
  now: number
}) {
  if (!quote) {
    return (
      <div className="shrink-0 text-right text-sm text-muted">
        {failure ? quoteErrorShort[failure] : loading ? <Skeleton /> : '—'}
      </div>
    )
  }
  return (
    <div className="flex shrink-0 flex-col items-end gap-0.5 tabular-nums">
      <span className="font-semibold">{formatPrice(quote.price)}</span>
      <span className="flex items-center gap-1.5">
        <StaleLabel quote={quote} failure={failure} now={now} />
        <span className={`text-sm ${pnlColor(quote.changePct)}`}>
          {formatSignedPercent(quote.changePct)}
        </span>
      </span>
    </div>
  )
}

function Skeleton() {
  return (
    <span className="flex flex-col items-end gap-1.5" aria-label="Loading price">
      <span className="block h-4 w-14 animate-pulse rounded bg-border" />
      <span className="block h-3 w-10 animate-pulse rounded bg-border" />
    </span>
  )
}
