import { Link } from 'react-router-dom'
import type { Trade } from '../db/schema.ts'
import {
  formatDateRange,
  formatPrice,
  formatQuantity,
  formatSignedMoney,
  formatSignedPercent,
} from '../lib/format.ts'
import { isClosed, returnPct, tradePnl } from '../lib/pnl.ts'
import { SideBadge, StatusBadge } from './Badges.tsx'
import { pnlColor } from './styles.ts'

type Props = {
  trade: Trade
  currency: string
  onQuickClose: (trade: Trade) => void
}

function TradeRow({ trade, currency, onQuickClose }: Props) {
  const closed = isClosed(trade)
  const pnl = tradePnl(trade)
  const pct = returnPct(trade)
  // Entry → exit date, then strategy and tags
  const details = [
    formatDateRange(trade.entryDate, trade.exitDate),
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
            {formatQuantity(trade.quantity)} @ {formatPrice(trade.entryPrice)}
            {closed && ` → ${formatPrice(trade.exitPrice)}`}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted">{details}</p>
        </div>
        {pnl !== null && (
          <div className="shrink-0 text-right tabular-nums">
            <p className={`font-semibold ${pnlColor(pnl)}`}>{formatSignedMoney(pnl, currency)}</p>
            {pct !== null && (
              <p className={`text-xs ${pnlColor(pnl)}`}>{formatSignedPercent(pct)}</p>
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
