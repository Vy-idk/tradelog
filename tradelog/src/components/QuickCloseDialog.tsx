import { useState, type FormEvent } from 'react'
import type { Trade } from '../db/schema.ts'
import { closeTrade } from '../db/trades.ts'
import { today } from '../lib/dates.ts'
import { formatPrice, formatQuantity } from '../lib/format.ts'
import { draftFromTrade, validateDraft } from '../lib/tradeDraft.ts'
import Field from './Field.tsx'
import Modal from './Modal.tsx'
import PnlPreview from './PnlPreview.tsx'
import { fieldA11y, inputClass } from './styles.ts'

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
