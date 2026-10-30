import { Link } from 'react-router-dom'
import type { Trade } from '../db/schema.ts'
import { useAmounts } from '../lib/amounts.ts'
import type { LivePrice } from '../lib/extended.ts'
import { formatClock, formatDateRange, formatPrice, formatSignedPercent } from '../lib/format.ts'
import { priceSessionShort } from '../lib/market.ts'
import { isClosed, returnPct, tradePnl, unrealizedPnl } from '../lib/pnl.ts'
import { SideBadge, StatusBadge } from './Badges.tsx'
import { pnlColor } from './styles.ts'

type Props = {
  trade: Trade
  currency: string
  /** The last saved price, for an open trade's unrealized P&L */
  live?: LivePrice
  /** True when the price may be out of date, e.g. it's old or the device is offline */
  liveStale: boolean
  onQuickClose: (trade: Trade) => void
}

function TradeRow({ trade, currency, live, liveStale, onQuickClose }: Props) {
  const amounts = useAmounts()
  const closed = isClosed(trade)
  const pnl = tradePnl(trade)
  const pct = returnPct(trade)
  const unrealized = !closed && live ? unrealizedPnl(trade, live.price) : null
  const extendedSession = live?.session === 'pre' || live?.session === 'post' ? live.session : null
  // Entry → exit date, then strategy and tags
  const details = [
    formatDateRange(trade.entryDate, trade.exitDate),
    trade.partOf && 'Partial close',
    trade.strategy,
    trade.tags.map((t) => `#${t}`).join(' '),
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <li className="flex items-stretch rounded-xl border border-border bg-surface">
      <Link
        to={`/trade/${trade.id}`}
        className="flex min-w-0 flex-1 items-center gap-3 py-3 pr-2 pl-3"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{trade.symbol}</span>
            <SideBadge side={trade.side} />
            <StatusBadge open={!closed} />
          </div>
          <p className="mt-0.5 truncate text-sm text-muted tabular-nums">
            {amounts.quantity(trade.quantity)} @ {formatPrice(trade.entryPrice)}
            {closed && ` → ${formatPrice(trade.exitPrice)}`}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted">{details}</p>
        </div>
        {pnl !== null && (
          <div className="shrink-0 text-right tabular-nums">
            <p className={`font-semibold ${pnlColor(pnl)}`}>{amounts.signedMoney(pnl, currency)}</p>
            {pct !== null && (
              <p className={`text-xs ${pnlColor(pnl)}`}>{formatSignedPercent(pct)}</p>
            )}
          </div>
        )}
        {unrealized !== null && live && (
          <div className="shrink-0 text-right tabular-nums">
            <p className={`font-medium ${pnlColor(unrealized)}`}>
              {amounts.signedMoney(unrealized, currency)}
            </p>
            {liveStale ? (
              <p className="text-xs text-amber-300">as of {formatClock(live.fetchedAt)}</p>
            ) : extendedSession ? (
              <p className="text-xs text-open">{priceSessionShort[extendedSession]}</p>
            ) : (
              <p className="text-xs text-muted">unrealized</p>
            )}
          </div>
        )}
      </Link>
      {!closed && (
        <button
          type="button"
          onClick={() => onQuickClose(trade)}
          aria-label={`Close ${trade.symbol} trade`}
          className="my-2 mr-2 shrink-0 self-center rounded-lg bg-accent/15 px-3 py-2 text-sm font-semibold text-accent"
        >
          Close
        </button>
      )}
    </li>
  )
}

export default TradeRow
