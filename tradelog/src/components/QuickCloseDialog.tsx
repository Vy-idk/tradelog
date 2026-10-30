import { useEffect, useState, type FormEvent } from 'react'
import { priceFailure, refreshQuotes, useLivePrices, usePriceStatus } from '../db/quotes.ts'
import type { Trade } from '../db/schema.ts'
import { useSettings } from '../db/settings.ts'
import { closeTrade } from '../db/trades.ts'
import { useAmounts } from '../lib/amounts.ts'
import { today } from '../lib/dates.ts'
import { formatAge, formatPrice } from '../lib/format.ts'
import { isStale } from '../lib/prices.ts'
import { feeShare, sharesLeft } from '../lib/positions.ts'
import { draftFromTrade, parseNumber, validateDraft } from '../lib/tradeDraft.ts'
import { useNow } from '../lib/useNow.ts'
import { useOnline } from '../lib/useOnline.ts'
import Field from './Field.tsx'
import Modal from './Modal.tsx'
import PnlPreview from './PnlPreview.tsx'
import { blurWhenHidden, chipClass, fieldA11y, inputClass } from './styles.ts'

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
  const amounts = useAmounts()
  const [exitPrice, setExitPrice] = useState('')
  const [exitDate, setExitDate] = useState(today())
  const [quantity, setQuantity] = useState(() => draftFromTrade(trade).quantity)
  /** Fees as typed; until then they follow the share of the trade being closed */
  const [typedFees, setTypedFees] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const { finnhubApiKey, priceRelayUrl } = useSettings()
  const status = usePriceStatus()
  const online = useOnline()
  const now = useNow(30_000)
  const quote = useLivePrices([trade.symbol], now)?.prices.get(trade.symbol)

  // Closing "at current price" deserves a current price: one request for this
  // symbol (plus its after-hours price), through the shared caches and rate limits
  useEffect(() => {
    void refreshQuotes([trade.symbol], { apiKey: finnhubApiKey, relayUrl: priceRelayUrl })
  }, [trade.symbol, finnhubApiKey, priceRelayUrl])
  const currentPrice = quote ? String(quote.price) : ''
  const priceStale =
    quote !== undefined && isStale(quote, priceFailure(quote, trade.symbol, status, online))
  const sessionText =
    quote?.session === 'pre' ? ' pre-market' : quote?.session === 'post' ? ' after-hours' : ''

  const closing = parseNumber(quantity) ?? 0
  const left = sharesLeft(trade.quantity, closing)
  const partial = closing > 0 && left > 0
  const fees =
    typedFees ??
    (partial && trade.fees > 0
      ? String(feeShare(trade.fees, closing, trade.quantity))
      : draftFromTrade(trade).fees)

  // Reuse the full trade validation so the rules match the edit form exactly
  const result = validateDraft({ ...draftFromTrade(trade), quantity, exitPrice, exitDate, fees })
  const errors = result.ok ? {} : result.errors
  const exitPriceError = exitPrice.trim() === '' ? 'Exit price is required' : errors.exitPrice
  const quantityError =
    errors.quantity ??
    (closing > trade.quantity ? `This trade holds ${amounts.quantity(trade.quantity)}` : undefined)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    if (!result.ok || quantityError || saving) return
    setSaving(true)
    try {
      const { quantity, exitPrice, exitDate, fees } = result.value
      await closeTrade(trade.id, { quantity, exitPrice: exitPrice!, exitDate: exitDate!, fees })
      onDone()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  return (
    <form noValidate onSubmit={onSubmit} className="space-y-4">
      <p className="-mt-1 text-sm text-muted">
        {trade.symbol} {trade.side} · {amounts.quantity(trade.quantity)} @{' '}
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
          Use {priceStale ? 'last' : 'current'}
          {sessionText} price {formatPrice(quote.price)} · {formatAge(quote.fetchedAt)}
        </button>
      ) : (
        (finnhubApiKey || priceRelayUrl) &&
        status.refreshing && <p className="-mt-1 text-sm text-muted">Getting the current price…</p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field
          id="close-quantity"
          label="Shares to close"
          hint={partial ? `${amounts.quantity(left)} stay open` : 'Lower it to close part'}
          error={quantityError}
        >
          <input
            {...fieldA11y('close-quantity', quantityError)}
            className={`${inputClass} ${blurWhenHidden(amounts.hidden)}`}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            onFocus={(e) => e.target.select()}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
          />
        </Field>
        <Field
          id="close-fees"
          label="Fees"
          hint={partial ? 'For these shares, with the exit' : 'Round trip, with the exit'}
          error={submitted ? errors.fees : undefined}
        >
          <input
            {...fieldA11y('close-fees', submitted ? errors.fees : undefined)}
            className={`${inputClass} ${blurWhenHidden(amounts.hidden)}`}
            value={fees}
            onChange={(e) => setTypedFees(e.target.value)}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
          />
        </Field>
      </div>
      {result.ok && !quantityError && <PnlPreview trade={result.value} currency={currency} />}
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
          {partial ? 'Close part' : 'Close trade'}
        </button>
      </div>
    </form>
  )
}

export default QuickCloseDialog
