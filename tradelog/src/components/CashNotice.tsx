import { useEffect } from 'react'
import { useAmounts } from '../lib/amounts.ts'
import { cashNotes } from '../lib/cash.ts'
import { clearCashNotice, useCashNotice } from '../lib/cashNotice.ts'

const SHOWN_MS = 10_000

/** Says what a save did to cash when it was more than a plain add or subtract. */
function CashNotice() {
  const amounts = useAmounts()
  const move = useCashNotice()

  useEffect(() => {
    if (!move) return
    const timer = setTimeout(clearCashNotice, SHOWN_MS)
    return () => clearTimeout(timer)
  }, [move])

  if (!move) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+0.5rem)] z-50 px-safe">
      <button
        type="button"
        role="status"
        onClick={clearCashNotice}
        className="pointer-events-auto w-full rounded-xl border border-border bg-surface p-3 text-left text-sm shadow-lg"
      >
        {cashNotes(move, amounts.money, true).map((note, i) => (
          <span key={i} className="block">
            {note}
          </span>
        ))}
      </button>
    </div>
  )
}

export default CashNotice
