import type { LivePrice } from '../lib/extended.ts'
import { formatClock, formatPrice, formatSignedPercent } from '../lib/format.ts'
import { priceSessionShort } from '../lib/market.ts'
import { isStale, quoteErrorShort, type QuoteError } from '../lib/prices.ts'
import { pnlColor } from './styles.ts'

/** "Stale · 10:42 AM" in amber, when a price may be out of date. */
export function StaleLabel({
  price,
  failure,
  now,
}: {
  price: { fetchedAt: number }
  failure: QuoteError | undefined
  now: number
}) {
  if (!isStale(price, failure, now)) return null
  return (
    <span
      title={`Last updated ${formatClock(price.fetchedAt)}`}
      className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-amber-300"
    >
      Stale · {formatClock(price.fetchedAt)}
    </span>
  )
}

/**
 * The one label a row has room for: "Stale" when the price may be out of
 * date, otherwise which session it's from (pre-market, after hours, or the
 * close) unless it's a live regular-session price.
 */
export function PriceLabel({
  live,
  failure,
  now,
}: {
  live: LivePrice
  failure: QuoteError | undefined
  now: number
}) {
  if (isStale(live, failure, now)) return <StaleLabel price={live} failure={failure} now={now} />
  const { session } = live
  if (!session) return null
  return (
    <span
      title={`Price from ${formatClock(live.time)}`}
      className={`rounded px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${
        session === 'close' ? 'bg-border text-muted' : 'bg-open/15 text-open'
      }`}
    >
      {priceSessionShort[session]}
    </span>
  )
}

/**
 * Price and its change for a list row, or what went wrong. A stale price
 * still shows, labelled with its time. Outside regular hours the label says
 * which session the price is from; a pre-market or after-hours change is
 * measured from the last close.
 */
export function PriceCell({
  live,
  failure,
  loading,
  now,
}: {
  live: LivePrice | undefined
  failure: QuoteError | undefined
  loading: boolean
  now: number
}) {
  if (!live) {
    return (
      <div className="shrink-0 text-right text-sm text-muted">
        {failure ? quoteErrorShort[failure] : loading ? <Skeleton /> : '—'}
      </div>
    )
  }
  return (
    <div className="flex shrink-0 flex-col items-end gap-0.5 tabular-nums">
      <span className="font-semibold">{formatPrice(live.price)}</span>
      <span className="flex items-center gap-1.5">
        <PriceLabel live={live} failure={failure} now={now} />
        <span className={`text-sm ${pnlColor(live.changePct)}`}>
          {formatSignedPercent(live.changePct)}
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
