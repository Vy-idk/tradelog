import { formatSignedMoney, formatSignedPercent } from '../lib/format.ts'
import { returnPct, tradePnl } from '../lib/pnl.ts'
import type { TradeInput } from '../db/schema.ts'
import { pnlColor } from './styles.ts'

type Props = {
  trade: Pick<TradeInput, 'side' | 'quantity' | 'entryPrice' | 'exitPrice' | 'fees'>
  currency: string
}

/** "P&L +$120.00 (+4.00%)" for a closed trade; renders nothing while open. */
function PnlPreview({ trade, currency }: Props) {
  const pnl = tradePnl(trade)
  const pct = returnPct(trade)
  if (pnl === null) return null
  return (
    <p
      className="flex items-baseline justify-between rounded-lg bg-bg px-3 py-2.5"
      aria-live="polite"
    >
      <span className="text-sm text-muted">P&amp;L after fees</span>
      <span className={`font-semibold tabular-nums ${pnlColor(pnl)}`}>
        {formatSignedMoney(pnl, currency)}
        {pct !== null && <span className="ml-1.5 text-sm">({formatSignedPercent(pct)})</span>}
      </span>
    </p>
  )
}

export default PnlPreview
