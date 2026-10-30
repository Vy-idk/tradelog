import type { Settings } from '../db/schema.ts'
import { useAmounts } from '../lib/amounts.ts'
import { cashNotes, moveCash } from '../lib/cash.ts'
import { TRADE_CURRENCY, type FxRates } from '../lib/fx.ts'

type Props = {
  /** Dollars the change adds to cash; negative takes them out */
  delta: number
  settings: Pick<Settings, 'cashBalances'>
  rates: FxRates | null | undefined
}

/** What a save will do to cash, before it happens. Renders nothing if cash won't move. */
function CashPreview({ delta, settings, rates }: Props) {
  const amounts = useAmounts()
  if (delta === 0) return null
  const move = moveCash(settings.cashBalances, delta, rates, () => '')
  return (
    <div className="rounded-lg bg-bg px-3 py-2.5" aria-live="polite">
      <p className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-muted">{delta < 0 ? 'Uses from cash' : 'Adds to cash'}</span>
        <span className="font-semibold tabular-nums">
          {amounts.money(Math.abs(delta), TRADE_CURRENCY)}
        </span>
      </p>
      {cashNotes(move, amounts.money, false).map((note, i) => (
        <p key={i} className="mt-1 text-sm text-muted">
          {note}
        </p>
      ))}
    </div>
  )
}

export default CashPreview
