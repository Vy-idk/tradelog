import { useEffect, useState, type FormEvent } from 'react'
import { refreshQuotes, usePriceStatus, useQuotes } from '../db/quotes.ts'
import type { Trade } from '../db/schema.ts'
import { useSettings } from '../db/settings.ts'
import { closeTrade } from '../db/trades.ts'
import { today } from '../lib/dates.ts'
import { formatAge, formatPrice, formatQuantity } from '../lib/format.ts'
import { isStale } from '../lib/prices.ts'
import { draftFromTrade, validateDraft } from '../lib/tradeDraft.ts'
import { useOnline } from '../lib/useOnline.ts'
import Field from './Field.tsx'
import Modal from './Modal.tsx'
import PnlPreview from './PnlPreview.tsx'
import { chipClass, fieldA11y, inputClass } from './styles.ts'

type Props = {
  /** The open trade to close; null hides the dialog */
  trade: Trade | null
  currency: string
  onClose: () => void
}

function QuickCloseDialog({ trade, currency, onClose }: Props) {
  return (
    <Modal open={trade !== null} onClose={onClose} title="Close trade" align="top">
      {trade && (
        <QuickCloseForm key={trade.id} trade={trade} currency={currency} onDone={onClose} />
      )}
    </Modal>
  )
}

function QuickCloseForm({
  trade,
  currency,
  onDone,
}: {
  trade: Trade
  currency: string
  onDone: () => void
}) {
  const [exitPrice, setExitPrice] = useState('')
  const [exitDate, setExitDate] = useState(today())
  const [fees, setFees] = useState(() => draftFromTrade(trade).fees)
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const { finnhubApiKey } = useSettings()
  const quote = useQuotes([trade.symbol])?.get(trade.symbol)
  const { refreshing, failures } = usePriceStatus()
  const online = useOnline()

  // Closing "at current price" deserves a current price: one request for this
  // symbol, through the shared cache and rate limit
  useEffect(() => {
    if (finnhubApiKey) void refreshQuotes([trade.symbol], finnhubApiKey)
  }, [trade.symbol, finnhubApiKey])
  const currentPrice = quote ? String(quote.price) : ''
  const priceStale =
    quote !== undefined && isStale(quote, online ? failures[trade.symbol] : 'offline')

  // Reuse the full trade validation so the rules match the edit form exactly
  const result = validateDraft({ ...draftFromTrade(trade), exitPrice, exitDate, fees })
  const errors = result.ok ? {} : result.errors
  const exitPriceError = exitPrice.trim() === '' ? 'Exit price is required' : errors.exitPrice

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    if (!result.ok || saving) return
    setSaving(true)
    try {
      const { exitPrice, exitDate, fees } = result.value
      await closeTrade(trade.id, { exitPrice: exitPrice!, exitDate: exitDate!, fees })
      onDone()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  return (
    <form noValidate onSubmit={onSubmit} className="space-y-4">
      <p className="-mt-1 text-sm text-muted">
        {trade.symbol} {trade.side} · {formatQuantity(trade.quantity)} @{' '}
        {formatPrice(trade.entryPrice)}
      </p>
      {saveError && (
        <p role="alert" className="text-sm text-loss">
          Couldn't save: {saveError}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field
          id="close-exitPrice"
          label="Exit price"
          error={submitted ? exitPriceError : undefined}
        >
          <input
            {...fieldA11y('close-exitPrice', submitted ? exitPriceError : undefined)}
            className={inputClass}
            value={exitPrice}
            onChange={(e) => setExitPrice(e.target.value)}
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="done"
            placeholder="0.00"
          />
        </Field>
        <Field
          id="close-exitDate"
          label="Exit date"
          error={submitted ? errors.exitDate : undefined}
        >
          <input
            {...fieldA11y('close-exitDate', submitted ? errors.exitDate : undefined)}
            type="date"
            className={inputClass}
            value={exitDate}
            onChange={(e) => setExitDate(e.target.value)}
            min={trade.entryDate}
            max={today()}
          />
        </Field>
      </div>
      {quote ? (
        <button
          type="button"
          aria-pressed={exitPrice.trim() === currentPrice}
          onClick={() => setExitPrice(currentPrice)}
          className={`${chipClass} -mt-1 tabular-nums`}
        >
          Use {priceStale ? 'last' : 'current'} price {formatPrice(quote.price)} ·{' '}
          {formatAge(quote.fetchedAt)}
        </button>
      ) : (
        finnhubApiKey &&
        refreshing && <p className="-mt-1 text-sm text-muted">Getting the current price…</p>
      )}
      <Field
        id="close-fees"
        label="Fees"
        hint="Round trip total, including the exit"
        error={submitted ? errors.fees : undefined}
      >
        <input
          {...fieldA11y('close-fees', submitted ? errors.fees : undefined)}
          className={inputClass}
          value={fees}
          onChange={(e) => setFees(e.target.value)}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
        />
      </Field>
      {result.ok && <PnlPreview trade={result.value} currency={currency} />}
      <div className="grid grid-cols-2 gap-3 pt-1">
        <button
          type="button"
          onClick={onDone}
          className="rounded-xl border border-border py-3 font-medium"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-accent py-3 font-semibold text-bg disabled:opacity-50"
        >
          Close trade
        </button>
      </div>
    </form>
  )
}

export default QuickCloseDialog
