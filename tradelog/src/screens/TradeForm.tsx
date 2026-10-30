import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import CashPreview from '../components/CashPreview.tsx'
import ConfirmDialog from '../components/ConfirmDialog.tsx'
import Field from '../components/Field.tsx'
import PnlPreview from '../components/PnlPreview.tsx'
import { EmptyState } from '../components/Screen.tsx'
import { SearchIcon } from '../components/icons.tsx'
import { blurWhenHidden, chipClass, fieldA11y, inputClass } from '../components/styles.ts'
import { useFxRates, useFxRefresh } from '../db/fx.ts'
import type { Side, Trade } from '../db/schema.ts'
import { useLoadedSettings } from '../db/settings.ts'
import { checkSymbol } from '../db/symbols.ts'
import { addTrade, deleteTrade, updateTrade, useTrade, useTrades } from '../db/trades.ts'
import { useAmounts } from '../lib/amounts.ts'
import { planDelete, planSave, tracksCash } from '../lib/cash.ts'
import { today } from '../lib/dates.ts'
import { formatPrice } from '../lib/format.ts'
import { accountCurrencies, TRADE_CURRENCY } from '../lib/fx.ts'
import { journalScroll, strategySuggestions, tagSuggestions } from '../lib/journal.ts'
import { uncheckedText, type SymbolCheck } from '../lib/symbols.ts'
import {
  addTag,
  draftFromTrade,
  draftsEqual,
  emptyDraft,
  FIELD_ORDER,
  normalizeSymbol,
  symbolError,
  validateDraft,
  type DraftField,
  type TradeDraft,
} from '../lib/tradeDraft.ts'
import { useGoBack } from '../lib/useGoBack.ts'

const fieldId = (field: DraftField) => `trade-${field}`

/** The company name once a symbol checks out, or why it couldn't be checked. */
function symbolHint(check: SymbolCheck | null, kept: boolean): string | undefined {
  if (kept) return 'Not found on US exchanges; kept as typed'
  if (!check) return undefined
  if (check.status === 'valid') return check.name || 'Listed in the US'
  if (check.status === 'unchecked') return uncheckedText[check.reason]
  return undefined
}

/** Header + scrolling body used by the form and its loading / not-found states. */
function FormShell({
  title,
  onCancel,
  saveDisabled,
  children,
}: {
  title: string
  onCancel: () => void
  saveDisabled?: boolean
  children?: ReactNode
}) {
  return (
    <div className="flex h-full flex-col">
      <header className="touch-none border-b border-border bg-surface pt-[env(safe-area-inset-top)]">
        <div className="grid h-12 grid-cols-[1fr_auto_1fr] items-center px-safe-2">
          <button
            type="button"
            onClick={onCancel}
            className="justify-self-start rounded-lg px-2 py-2 text-muted"
          >
            Cancel
          </button>
          <h1 className="font-semibold">{title}</h1>
          <button
            type="submit"
            form="trade-form"
            disabled={saveDisabled}
            className="justify-self-end rounded-lg px-2 py-2 font-semibold text-accent disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </header>
      <div className="relative flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
        {children}
      </div>
    </div>
  )
}

function TradeForm() {
  const { id } = useParams()
  const live = useTrade(id)
  const goBack = useGoBack()

  // Edit a snapshot taken when the trade first loads, so deleting it (or a
  // change from another tab) doesn't swap the form out from under you
  const [snapshot, setSnapshot] = useState<{ id?: string; trade?: Trade | null }>({ id })
  if (snapshot.id !== id) setSnapshot({ id })
  else if (snapshot.trade === undefined && live !== undefined) setSnapshot({ id, trade: live })
  const trade = snapshot.id === id ? snapshot.trade : undefined

  if (id && trade === undefined) {
    return <FormShell title="Edit trade" onCancel={goBack} saveDisabled />
  }
  if (id && trade === null) {
    return (
      <FormShell title="Edit trade" onCancel={goBack} saveDisabled>
        <div className="px-safe pt-4">
          <EmptyState
            icon={<SearchIcon />}
            title="Trade not found"
            text="This trade doesn't exist anymore. It may have been deleted."
          />
        </div>
      </FormShell>
    )
  }
  return <TradeFormBody key={id ?? 'new'} trade={trade ?? null} />
}

function TradeFormBody({ trade }: { trade: Trade | null }) {
  const goBack = useGoBack()
  const amounts = useAmounts()
  const settings = useLoadedSettings()
  const apiKey = settings?.finnhubApiKey
  const rates = useFxRates()
  const tracking = settings !== undefined && tracksCash(settings)
  useFxRefresh(tracking && accountCurrencies(settings).length > 1)
  const trades = useTrades()
  const isNew = trade === null
  // "Log a trade" on the watchlist opens the form with the symbol filled in
  const [params] = useSearchParams()
  const presetSymbol = isNew ? normalizeSymbol(params.get('symbol') ?? '') : ''

  const initial = useMemo(
    () => (trade ? draftFromTrade(trade) : { ...emptyDraft(today()), symbol: presetSymbol }),
    [trade, presetSymbol],
  )
  const [draft, setDraft] = useState<TradeDraft>(initial)
  const [tagText, setTagText] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [confirm, setConfirm] = useState<'delete' | 'discard' | null>(null)
  const exitPriceRef = useRef<HTMLInputElement>(null)

  // Symbols are checked against US listings a moment after typing stops.
  // A saved trade's own symbol isn't checked again.
  const symbol = normalizeSymbol(draft.symbol)
  const needsCheck = !symbolError(symbol) && symbol !== trade?.symbol
  const [check, setCheck] = useState<SymbolCheck | null>(null)
  const [symbolTouched, setSymbolTouched] = useState(false)
  /** A symbol kept even though it isn't listed, e.g. a delisted stock */
  const [keptSymbol, setKeptSymbol] = useState('')
  useEffect(() => {
    if (!needsCheck || apiKey === undefined) return
    let cancelled = false
    const timer = setTimeout(() => {
      void checkSymbol(symbol, apiKey).then((r) => {
        if (!cancelled) setCheck(r)
      })
    }, 600)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [symbol, needsCheck, apiKey])
  const symbolCheck = needsCheck && check?.symbol === symbol ? check : null
  const unlisted =
    symbolCheck?.status === 'invalid' && keptSymbol !== symbol && (symbolTouched || submitted)

  // Tag text that hasn't been turned into a chip yet still counts on save
  const finalDraft = useMemo(
    () => (tagText.trim() ? { ...draft, tags: addTag(draft.tags, tagText) } : draft),
    [draft, tagText],
  )
  const result = useMemo(() => validateDraft(finalDraft), [finalDraft])
  // Errors appear after the first save attempt, then update as you type
  const errors = submitted && !result.ok ? result.errors : {}
  const dirty = !draftsEqual(finalDraft, initial)

  const otherTrades = useMemo(
    () => (trades ?? []).filter((t) => t.id !== trade?.id),
    [trades, trade],
  )
  const strategies = useMemo(() => strategySuggestions(otherTrades), [otherTrades])
  const knownTags = useMemo(() => tagSuggestions(otherTrades), [otherTrades])
  const recentSymbols = useMemo(
    () => [...new Set((trades ?? []).map((t) => t.symbol))].slice(0, 6),
    [trades],
  )

  function set<K extends DraftField>(field: K, value: TradeDraft[K]) {
    setDraft((d) => ({ ...d, [field]: value }))
  }

  function setExitPrice(value: string) {
    // Typing an exit price on an open trade usually means "closed today"
    setDraft((d) => ({
      ...d,
      exitPrice: value,
      exitDate: d.exitDate || (value.trim() ? today() : ''),
    }))
  }

  function closeToday() {
    setDraft((d) => ({ ...d, exitDate: today() }))
    exitPriceRef.current?.focus()
  }

  function commitTagText(text = tagText) {
    const parts = text.split(',')
    // Everything before the last comma becomes chips; the rest stays in the input
    const pending = parts.pop() ?? ''
    if (parts.length > 0) setDraft((d) => ({ ...d, tags: parts.reduce(addTag, d.tags) }))
    setTagText(pending)
  }

  function onTagKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      // Enter adds the tag instead of submitting the form
      e.preventDefault()
      commitTagText(`${tagText},`)
    } else if (e.key === 'Backspace' && tagText === '' && draft.tags.length > 0) {
      set('tags', draft.tags.slice(0, -1))
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    setSubmitted(true)
    if (!result.ok) {
      const first = FIELD_ORDER.find((f) => result.errors[f])
      if (first) document.getElementById(fieldId(first))?.focus()
      return
    }
    setSaving(true)
    setSaveError('')
    try {
      if (needsCheck && keptSymbol !== symbol) {
        const checked = symbolCheck ?? (await checkSymbol(symbol, apiKey ?? ''))
        setCheck(checked)
        if (checked.status === 'invalid') {
          setSaving(false)
          document.getElementById(fieldId('symbol'))?.focus()
          return
        }
      }
      if (trade) await updateTrade(trade.id, result.value)
      else {
        await addTrade(result.value)
        // Show the new trade at the top of the journal
        journalScroll.top = 0
      }
      goBack()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  async function onDelete() {
    if (!trade) return
    setConfirm(null)
    try {
      await deleteTrade(trade.id)
      goBack()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    }
  }

  function onCancel() {
    if (dirty) setConfirm('discard')
    else goBack()
  }

  const isOpen = draft.exitPrice.trim() === '' && draft.exitDate === ''
  const tagMatches = knownTags
    .filter((t) => !draft.tags.some((s) => s.toLowerCase() === t.toLowerCase()))
    .filter((t) => t.toLowerCase().startsWith(tagText.trim().toLowerCase()))
    .slice(0, 8)

  return (
    <FormShell title={isNew ? 'New trade' : 'Edit trade'} onCancel={onCancel} saveDisabled={saving}>
      <form
        id="trade-form"
        noValidate
        onSubmit={onSubmit}
        className="space-y-5 px-safe pt-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]"
      >
        {saveError && (
          <p
            role="alert"
            className="rounded-lg border border-loss/40 bg-loss/10 p-3 text-sm text-loss"
          >
            Couldn't save: {saveError}
          </p>
        )}

        <div className="grid grid-cols-[1fr_auto] items-start gap-3">
          <Field
            id={fieldId('symbol')}
            label="Symbol"
            error={
              errors.symbol ?? (unlisted ? `${symbol} isn't listed on a US exchange` : undefined)
            }
            hint={symbolHint(symbolCheck, needsCheck && keptSymbol === symbol)}
          >
            <input
              {...fieldA11y(
                fieldId('symbol'),
                errors.symbol ?? (unlisted ? 'unlisted' : undefined),
              )}
              className={`${inputClass} font-semibold uppercase`}
              value={draft.symbol}
              onChange={(e) => set('symbol', e.target.value.toUpperCase())}
              onBlur={() => setSymbolTouched(true)}
              placeholder="AAPL"
              autoFocus={isNew && !presetSymbol}
              autoCapitalize="characters"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="next"
              maxLength={15}
            />
          </Field>
          <fieldset>
            <legend className="mb-1 text-sm text-muted">Side</legend>
            <div className="flex min-h-12 rounded-lg border border-border bg-bg p-1">
              {(['long', 'short'] as Side[]).map((side) => (
                <button
                  key={side}
                  type="button"
                  aria-pressed={draft.side === side}
                  onClick={() => set('side', side)}
                  className="rounded-md px-3.5 text-sm font-semibold text-muted aria-pressed:bg-surface aria-pressed:text-inherit aria-pressed:shadow"
                >
                  {side === 'long' ? 'Long' : 'Short'}
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        {unlisted && !errors.symbol && (
          <button
            type="button"
            onClick={() => setKeptSymbol(symbol)}
            className="-mt-3 text-sm text-muted underline underline-offset-2"
          >
            Delisted? Keep {symbol} anyway
          </button>
        )}

        {isNew && draft.symbol === '' && recentSymbols.length > 0 && (
          <div className="-mt-3 flex flex-wrap gap-2" aria-label="Recent symbols">
            {recentSymbols.map((s) => (
              <button key={s} type="button" className={chipClass} onClick={() => set('symbol', s)}>
                {s}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field id={fieldId('quantity')} label="Quantity" error={errors.quantity}>
            <input
              {...fieldA11y(fieldId('quantity'), errors.quantity)}
              className={`${inputClass} ${blurWhenHidden(amounts.hidden)}`}
              value={draft.quantity}
              onChange={(e) => set('quantity', e.target.value)}
              autoFocus={isNew && Boolean(presetSymbol)}
              inputMode="decimal"
              autoComplete="off"
              enterKeyHint="next"
              placeholder="100"
            />
          </Field>
          <Field id={fieldId('entryPrice')} label="Entry price" error={errors.entryPrice}>
            <input
              {...fieldA11y(fieldId('entryPrice'), errors.entryPrice)}
              className={inputClass}
              value={draft.entryPrice}
              onChange={(e) => set('entryPrice', e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              enterKeyHint="next"
              placeholder="0.00"
            />
          </Field>
          <Field id={fieldId('entryDate')} label="Entry date" error={errors.entryDate}>
            <input
              {...fieldA11y(fieldId('entryDate'), errors.entryDate)}
              type="date"
              className={inputClass}
              value={draft.entryDate}
              onChange={(e) => set('entryDate', e.target.value)}
              max={today()}
            />
          </Field>
          <Field id={fieldId('fees')} label="Fees" error={errors.fees} hint="Round trip total">
            <input
              {...fieldA11y(fieldId('fees'), errors.fees)}
              className={`${inputClass} ${blurWhenHidden(amounts.hidden)}`}
              value={draft.fees}
              onChange={(e) => set('fees', e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
            />
          </Field>
        </div>

        <section
          aria-labelledby="trade-exit-heading"
          className="space-y-3 rounded-xl border border-border bg-surface p-3"
        >
          <div className="flex min-h-8 items-center justify-between gap-3">
            <h2 id="trade-exit-heading" className="font-medium">
              Exit
            </h2>
            {!isNew && isOpen ? (
              <button
                type="button"
                onClick={closeToday}
                className="rounded-lg bg-accent/15 px-3 py-1.5 text-sm font-semibold text-accent"
              >
                Close today
              </button>
            ) : (
              isOpen && <span className="text-xs text-muted">Leave blank while open</span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field id={fieldId('exitPrice')} label="Exit price" error={errors.exitPrice}>
              <input
                {...fieldA11y(fieldId('exitPrice'), errors.exitPrice)}
                ref={exitPriceRef}
                className={inputClass}
                value={draft.exitPrice}
                onChange={(e) => setExitPrice(e.target.value)}
                inputMode="decimal"
                autoComplete="off"
                placeholder="—"
              />
            </Field>
            <Field id={fieldId('exitDate')} label="Exit date" error={errors.exitDate}>
              <input
                {...fieldA11y(fieldId('exitDate'), errors.exitDate)}
                type="date"
                className={inputClass}
                value={draft.exitDate}
                onChange={(e) => set('exitDate', e.target.value)}
                min={draft.entryDate || undefined}
                max={today()}
              />
            </Field>
          </div>
          {!isOpen && (
            <button
              type="button"
              onClick={() => setDraft((d) => ({ ...d, exitPrice: '', exitDate: '' }))}
              className="text-sm text-muted underline underline-offset-2"
            >
              Clear exit (mark as open)
            </button>
          )}
          {result.ok && <PnlPreview trade={result.value} currency={TRADE_CURRENCY} />}
        </section>

        <Field id={fieldId('strategy')} label="Strategy" error={errors.strategy}>
          <input
            {...fieldA11y(fieldId('strategy'), errors.strategy)}
            className={inputClass}
            value={draft.strategy}
            onChange={(e) => set('strategy', e.target.value)}
            placeholder="Pick one below or type your own"
            autoComplete="off"
            maxLength={40}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {strategies.map((s) => {
              const selected = draft.strategy.trim().toLowerCase() === s.toLowerCase()
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={selected}
                  className={chipClass}
                  onClick={() => set('strategy', selected ? '' : s)}
                >
                  {s}
                </button>
              )
            })}
          </div>
        </Field>

        <Field id={fieldId('tags')} label="Tags" hint="Press return or comma to add">
          <div className="flex min-h-12 flex-wrap items-center gap-2 rounded-lg border border-border bg-bg px-2 py-2 focus-within:border-accent">
            {draft.tags.map((tag) => (
              <span
                key={tag}
                className="flex items-center gap-1 rounded-full bg-surface py-1 pr-1 pl-3 text-sm"
              >
                {tag}
                <button
                  type="button"
                  aria-label={`Remove tag ${tag}`}
                  onClick={() =>
                    set(
                      'tags',
                      draft.tags.filter((t) => t !== tag),
                    )
                  }
                  className="grid size-7 place-items-center rounded-full text-muted"
                >
                  ×
                </button>
              </span>
            ))}
            <input
              id={fieldId('tags')}
              className="min-w-28 flex-1 bg-transparent px-1 py-1 outline-none placeholder:text-muted/60"
              value={tagText}
              onChange={(e) => commitTagText(e.target.value)}
              onKeyDown={onTagKeyDown}
              placeholder={draft.tags.length ? '' : 'e.g. A+ setup, mistake'}
              autoComplete="off"
              autoCorrect="off"
              enterKeyHint="done"
            />
          </div>
          {tagMatches.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {tagMatches.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={chipClass}
                  onClick={() => {
                    setDraft((d) => ({ ...d, tags: addTag(d.tags, t) }))
                    setTagText('')
                  }}
                >
                  + {t}
                </button>
              ))}
            </div>
          )}
        </Field>

        <Field id={fieldId('notes')} label="Notes">
          <textarea
            id={fieldId('notes')}
            className={`${inputClass} min-h-28 resize-y`}
            value={draft.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Why you entered, what you learned"
          />
        </Field>

        {settings && result.ok && (
          <CashPreview
            delta={planSave(trade, result.value, tracking).delta}
            settings={settings}
            rates={rates}
          />
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-xl bg-accent py-3.5 font-semibold text-bg disabled:opacity-50"
        >
          {saving ? 'Saving…' : isNew ? 'Add trade' : 'Save changes'}
        </button>

        {trade && (
          <button
            type="button"
            onClick={() => setConfirm('delete')}
            className="w-full rounded-xl border border-loss/40 py-3.5 font-semibold text-loss"
          >
            Delete trade
          </button>
        )}
      </form>

      <ConfirmDialog
        open={confirm === 'delete'}
        title="Delete this trade?"
        confirmLabel="Delete"
        destructive
        onConfirm={onDelete}
        onCancel={() => setConfirm(null)}
      >
        {trade && (
          <p>
            {trade.symbol} {trade.side} · {amounts.quantity(trade.quantity)} @{' '}
            {formatPrice(trade.entryPrice)}. This can't be undone.
          </p>
        )}
        {trade && settings && (
          <div className="mt-3">
            <CashPreview
              delta={planDelete(trade, tracking)}
              settings={settings}
              rates={rates}
            />
          </div>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm === 'discard'}
        title="Discard changes?"
        confirmLabel="Discard"
        destructive
        onConfirm={() => {
          setConfirm(null)
          goBack()
        }}
        onCancel={() => setConfirm(null)}
      >
        <p>Your unsaved changes to this trade will be lost.</p>
      </ConfirmDialog>
    </FormShell>
  )
}

export default TradeForm
