import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { SideBadge } from '../components/Badges.tsx'
import { EarningsNote } from '../components/Earnings.tsx'
import Field from '../components/Field.tsx'
import Modal from '../components/Modal.tsx'
import { PriceCell, PriceLabel, StaleLabel } from '../components/Price.tsx'
import PullToRefresh from '../components/PullToRefresh.tsx'
import QuickCloseDialog from '../components/QuickCloseDialog.tsx'
import Screen, { EmptyState } from '../components/Screen.tsx'
import { ChevronIcon, WatchlistIcon } from '../components/icons.tsx'
import { chipClass, fieldA11y, inputClass, pnlColor } from '../components/styles.ts'
import { useEarnings, useEarningsRefresh } from '../db/earnings.ts'
import {
  priceFailure,
  useLivePrices,
  usePriceRefresh,
  usePriceStatus,
  type PriceStatus,
} from '../db/quotes.ts'
import type { EarningsRow, Quote, Trade, WatchItem } from '../db/schema.ts'
import { useLoadedSettings } from '../db/settings.ts'
import { useTrades } from '../db/trades.ts'
import {
  addWatchSymbol,
  removeWatchSymbol,
  updateWatchItem,
  useWatchlist,
} from '../db/watchlist.ts'
import { useAmounts } from '../lib/amounts.ts'
import { today } from '../lib/dates.ts'
import { earningsDetail } from '../lib/earnings.ts'
import {
  formatAge,
  formatAveragePrice,
  formatClock,
  formatDateRange,
  formatPrice,
  formatSignedPercent,
  formatSignedPrice,
} from '../lib/format.ts'
import type { ExtendedError, LivePrice } from '../lib/extended.ts'
import { TRADE_CURRENCY } from '../lib/fx.ts'
import { distinctSorted } from '../lib/journal.ts'
import { priceSessionLong, sessionAt, type PriceSession } from '../lib/market.ts'
import { isClosed, openPositions, unrealizedPnl, unrealizedReturnPct } from '../lib/pnl.ts'
import { groupPositions, type Position } from '../lib/positions.ts'
import { MANUAL_REFRESH_AGE, quoteErrorLong, type QuoteError } from '../lib/prices.ts'
import { parseNumber } from '../lib/tradeDraft.ts'
import { useNow } from '../lib/useNow.ts'
import { useOnline } from '../lib/useOnline.ts'

const sectionHeading = 'text-sm font-medium tracking-wide text-muted uppercase'

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={spinning ? 'animate-spin' : ''}
    >
      <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  )
}

function Notice({ tone, children }: { tone: 'warn' | 'error' | 'info'; children: ReactNode }) {
  const styles = {
    warn: 'border-amber-400/30 bg-amber-400/10',
    error: 'border-loss/40 bg-loss/10',
    info: 'border-border bg-surface',
  }
  return (
    <div
      role={tone === 'info' ? 'status' : 'alert'}
      className={`mb-4 rounded-xl border p-3 ${styles[tone]}`}
    >
      {children}
    </div>
  )
}

/** What's going on with prices: missing key, offline, rate limited, or when they last updated. */
function PriceBanner({
  apiKey,
  online,
  status,
  newest,
  hasSymbols,
  now,
}: {
  apiKey: string
  online: boolean
  status: PriceStatus
  newest: number | null
  hasSymbols: boolean
  now: number
}) {
  const shownFrom = newest ? ` Showing prices from ${formatClock(newest)}.` : ''

  if (!apiKey) {
    return (
      <Notice tone="info">
        <p className="font-medium">Live prices need a free Finnhub API key</p>
        <p className="mt-0.5 text-sm text-muted">
          It takes a minute to get one, and it stays on this device.
        </p>
        <Link
          to="/settings?focus=api-key"
          className="mt-3 inline-block rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-bg"
        >
          Add API key
        </Link>
      </Notice>
    )
  }
  if (status.problem === 'invalid-key') {
    return (
      <Notice tone="error">
        <p className="font-medium text-loss">Finnhub rejected your API key</p>
        <p className="mt-0.5 text-sm text-muted">
          Prices can't update until it's fixed.{shownFrom}
        </p>
        <Link
          to="/settings?focus=api-key"
          className="mt-3 inline-block rounded-lg border border-border px-3 py-2 text-sm font-medium"
        >
          Check it in Settings
        </Link>
      </Notice>
    )
  }
  if (!online) {
    return (
      <Notice tone="warn">
        <p className="font-medium text-amber-200">You're offline</p>
        <p className="mt-0.5 text-sm text-muted">
          {newest
            ? `Showing the last known prices, from ${formatClock(newest)}.`
            : 'Prices will load when you reconnect.'}
        </p>
      </Notice>
    )
  }
  if (status.problem === 'rate-limited') {
    const seconds = status.retryAt ? Math.ceil((status.retryAt - now) / 1000) : 0
    return (
      <Notice tone="warn">
        <p className="font-medium text-amber-200">Finnhub's rate limit was reached</p>
        <p className="mt-0.5 text-sm text-muted">
          Retrying {seconds > 1 ? `in about ${seconds} seconds` : 'shortly'}.{shownFrom}
        </p>
      </Notice>
    )
  }
  if (!hasSymbols) return null
  return (
    <p role="status" className="-mt-2 mb-4 text-sm text-muted">
      {status.refreshing
        ? newest
          ? 'Updating prices…'
          : 'Loading prices…'
        : newest
          ? `Updated ${formatClock(newest)} · refreshes every minute`
          : 'No prices yet'}
    </p>
  )
}

const extendedProblemText: Record<Exclude<ExtendedError, 'offline'>, string> = {
  'rate-limited':
    'Yahoo is rate limiting the price relay. Pre-market and after-hours prices will retry shortly.',
  failed:
    "Couldn't reach the price relay, so pre-market and after-hours prices may be missing or old.",
  'bad-relay': "The relay URL in Settings doesn't answer like the TradeLog price relay.",
}

/**
 * Outside regular hours, a note when pre-market and after-hours prices are
 * missing: no relay set up yet, or the relay is having trouble.
 */
function ExtendedNote({
  relayUrl,
  problem,
  now,
}: {
  relayUrl: string
  problem: ExtendedError | null
  now: number
}) {
  if (sessionAt(now) === 'regular') return null
  if (!relayUrl) {
    return (
      <p className="-mt-2 mb-4 text-sm text-muted">
        Showing closing prices.{' '}
        <Link to="/settings?focus=relay" className="text-accent underline underline-offset-2">
          Set up the price relay
        </Link>{' '}
        for pre-market and after-hours prices.
      </p>
    )
  }
  if (!problem || problem === 'offline') return null
  return (
    <p role="alert" className="-mt-2 mb-4 text-sm text-amber-200">
      {extendedProblemText[problem]}
    </p>
  )
}

type PositionRowProps = {
  position: Position
  live: LivePrice | undefined
  failure: QuoteError | undefined
  loading: boolean
  currency: string
  now: number
  earnings: EarningsRow | undefined
}

/** A position's P&L for the right of a row, or its price problem. */
function PositionPnl({
  position,
  failure,
  loading,
  currency,
  now,
}: Pick<PositionRowProps, 'position' | 'failure' | 'loading' | 'currency' | 'now'>) {
  const amounts = useAmounts()
  const { unrealizedPnl: pnl, returnPct: pct } = position
  if (pnl === null) {
    return <PriceCell live={undefined} failure={failure} loading={loading} now={now} />
  }
  return (
    <div className="shrink-0 text-right tabular-nums">
      <p className={`font-semibold ${pnlColor(pnl)}`}>{amounts.signedMoney(pnl, currency)}</p>
      {pct !== null && <p className={`text-xs ${pnlColor(pnl)}`}>{formatSignedPercent(pct)}</p>}
    </div>
  )
}

/** Symbol, side and size: the left of a position's row. */
function PositionSummary({
  position,
  live,
  failure,
  now,
  earnings,
}: Pick<PositionRowProps, 'position' | 'live' | 'failure' | 'now' | 'earnings'>) {
  const amounts = useAmounts()
  const { symbol, side, quantity, avgEntry, lots } = position
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <span className="truncate font-semibold">{symbol}</span>
        <SideBadge side={side} />
        {lots.length > 1 && (
          <span className="shrink-0 text-xs text-muted">{lots.length} trades</span>
        )}
      </div>
      <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted tabular-nums">
        <span className="truncate">
          {amounts.quantity(quantity)} @{' '}
          {lots.length > 1 ? `${formatAveragePrice(avgEntry)} avg` : formatPrice(avgEntry)}
          {live && ` → ${formatPrice(live.price)}`}
        </span>
        {live && <PriceLabel live={live} failure={failure} now={now} />}
      </p>
      <EarningsNote row={earnings} today={today(new Date(now))} />
    </div>
  )
}

/** One open trade of a position, with its own P&L and a way to close it. */
function LotRow({
  trade,
  live,
  currency,
  onClose,
}: {
  trade: Trade
  live: LivePrice | undefined
  currency: string
  onClose: (trade: Trade) => void
}) {
  const amounts = useAmounts()
  const pnl = live ? unrealizedPnl(trade, live.price) : null
  const pct = live ? unrealizedReturnPct(trade, live.price) : null
  return (
    <li className="flex items-center">
      <Link
        to={`/trade/${trade.id}`}
        className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pr-2 pl-3"
      >
        <div className="min-w-0 flex-1 text-sm tabular-nums">
          <p className="truncate">
            {amounts.quantity(trade.quantity)} @ {formatPrice(trade.entryPrice)}
          </p>
          <p className="truncate text-xs text-muted">{formatDateRange(trade.entryDate)}</p>
        </div>
        {pnl !== null && (
          <div className="shrink-0 text-right text-sm tabular-nums">
            <p className={pnlColor(pnl)}>{amounts.signedMoney(pnl, currency)}</p>
            {pct !== null && (
              <p className={`text-xs ${pnlColor(pnl)}`}>{formatSignedPercent(pct)}</p>
            )}
          </div>
        )}
      </Link>
      <button
        type="button"
        onClick={() => onClose(trade)}
        aria-label={`Close ${trade.symbol} trade from ${formatDateRange(trade.entryDate)}`}
        className="mr-2 shrink-0 rounded-lg bg-accent/15 px-3 py-2 text-sm font-semibold text-accent"
      >
        Close
      </button>
    </li>
  )
}

/** Several trades in one symbol and direction: one row that opens to show each. */
function GroupedPositionRow({
  onCloseLot,
  ...row
}: PositionRowProps & { onCloseLot: (trade: Trade) => void }) {
  const [open, setOpen] = useState(false)
  const { position, live, currency } = row
  const listId = `lots-${position.key}`
  return (
    <li className="rounded-xl border border-border bg-surface">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-3 py-3 text-left"
      >
        <PositionSummary {...row} />
        <PositionPnl {...row} />
        <span className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}>
          <ChevronIcon size={18} />
        </span>
      </button>
      {open && (
        <ul id={listId} className="divide-y divide-border border-t border-border">
          {position.lots.map((t) => (
            <LotRow key={t.id} trade={t} live={live} currency={currency} onClose={onCloseLot} />
          ))}
        </ul>
      )}
    </li>
  )
}

/** A position of one trade: the row opens that trade. */
function SinglePositionRow(row: PositionRowProps) {
  return (
    <li>
      <Link
        to={`/trade/${row.position.lots[0].id}`}
        className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-3"
      >
        <PositionSummary {...row} />
        <PositionPnl {...row} />
      </Link>
    </li>
  )
}

function OpenPositionsSection({
  trades,
  prices,
  failures,
  loading,
  currency,
  now,
  earnings,
}: {
  trades: Trade[]
  prices: ReadonlyMap<string, LivePrice>
  failures: Readonly<Record<string, QuoteError>>
  loading: boolean
  currency: string
  now: number
  earnings: ReadonlyMap<string, EarningsRow> | undefined
}) {
  const amounts = useAmounts()
  const [closing, setClosing] = useState<Trade | null>(null)
  const lastPrices = useMemo(() => new Map([...prices].map(([s, p]) => [s, p.price])), [prices])
  const summary = useMemo(() => openPositions(trades, lastPrices), [trades, lastPrices])
  const positions = useMemo(() => groupPositions(trades, lastPrices), [trades, lastPrices])
  const totalPct = summary.costBasis ? (summary.unrealizedPnl / summary.costBasis) * 100 : null

  return (
    <section className="mb-6" aria-labelledby="open-positions-heading">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 id="open-positions-heading" className={sectionHeading}>
          Open positions
        </h2>
        {summary.priced > 0 && (
          <p className="truncate text-sm tabular-nums">
            <span className="text-muted">Unrealized </span>
            <span className={`font-semibold ${pnlColor(summary.unrealizedPnl)}`}>
              {amounts.signedMoney(summary.unrealizedPnl, currency)}
              {totalPct !== null && ` (${formatSignedPercent(totalPct)})`}
            </span>
          </p>
        )}
      </div>
      <ul className="space-y-2">
        {positions.map((position) => {
          const row = {
            position,
            live: prices.get(position.symbol),
            failure: failures[position.symbol],
            loading,
            currency,
            now,
            earnings: earnings?.get(position.symbol),
          }
          return position.lots.length > 1 ? (
            <GroupedPositionRow key={position.key} {...row} onCloseLot={setClosing} />
          ) : (
            <SinglePositionRow key={position.key} {...row} />
          )
        })}
      </ul>
      {summary.priced > 0 && summary.priced < summary.count && (
        <p className="mt-2 text-xs text-muted">
          The total covers the {summary.priced} of {summary.count} open trades that have a price.
        </p>
      )}
      <QuickCloseDialog trade={closing} currency={currency} onClose={() => setClosing(null)} />
    </section>
  )
}

function AddSymbolForm({ suggestions }: { suggestions: string[] }) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)

  async function add(value: string) {
    if (adding) return
    setAdding(true)
    try {
      const result = await addWatchSymbol(value)
      if ('error' in result) {
        setError(result.error)
      } else {
        setText('')
        setError('')
      }
    } catch (err) {
      setError(`Couldn't add it: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setAdding(false)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    void add(text)
  }

  return (
    <form noValidate onSubmit={onSubmit} className="mb-3">
      <div className="flex gap-2">
        <label htmlFor="watch-symbol" className="sr-only">
          Symbol to watch
        </label>
        <input
          {...fieldA11y('watch-symbol', error || undefined)}
          className={`${inputClass} flex-1 font-semibold uppercase placeholder:font-normal placeholder:normal-case`}
          value={text}
          onChange={(e) => {
            setText(e.target.value.toUpperCase())
            setError('')
          }}
          placeholder="Add a symbol, e.g. NVDA"
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="done"
          maxLength={15}
        />
        <button
          type="submit"
          disabled={!text.trim() || adding}
          className="shrink-0 rounded-lg bg-accent px-5 font-semibold text-bg disabled:opacity-40"
        >
          Add
        </button>
      </div>
      {error && (
        <p id="watch-symbol-error" className="mt-1 text-sm text-loss">
          {error}
        </p>
      )}
      {!text && suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">From your journal:</span>
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              className={chipClass}
              onClick={() => add(s)}
              aria-label={`Watch ${s}`}
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </form>
  )
}

function targetText(item: WatchItem, live: LivePrice | undefined): string {
  if (item.targetPrice === undefined) return ''
  const away = live
    ? ` (${formatSignedPercent(((item.targetPrice - live.price) / live.price) * 100)})`
    : ''
  return `Target ${formatPrice(item.targetPrice)}${away}`
}

function WatchRow({
  item,
  live,
  failure,
  loading,
  now,
  earnings,
  onOpen,
}: {
  item: WatchItem
  live: LivePrice | undefined
  failure: QuoteError | undefined
  loading: boolean
  now: number
  earnings: EarningsRow | undefined
  onOpen: (symbol: string) => void
}) {
  const detail = [targetText(item, live), item.note].filter(Boolean).join(' · ')
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(item.symbol)}
        className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface px-3 py-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{item.symbol}</p>
          {detail && <p className="mt-0.5 truncate text-xs text-muted tabular-nums">{detail}</p>}
          <EarningsNote row={earnings} today={today(new Date(now))} />
        </div>
        <PriceCell live={live} failure={failure} loading={loading} now={now} />
      </button>
    </li>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-bg px-2 py-1.5">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="truncate text-sm tabular-nums">{value ? formatPrice(value) : '—'}</dd>
    </div>
  )
}

/** What a price's change is measured over, after the numbers. */
const changeSuffix: Record<PriceSession | 'live', string> = {
  live: 'today',
  close: 'at close',
  pre: 'pre-market',
  post: 'after hours',
}

function WatchItemDetails({
  item,
  live,
  quote,
  failure,
  now,
  earnings,
  onDone,
}: {
  item: WatchItem
  live: LivePrice | undefined
  /** Finnhub's regular-session quote, for the day's stats */
  quote: Quote | undefined
  failure: QuoteError | undefined
  now: number
  earnings: EarningsRow | undefined
  onDone: () => void
}) {
  const earningsLine = earningsDetail(earnings, today(new Date(now)))
  const [target, setTarget] = useState(
    item.targetPrice === undefined ? '' : String(item.targetPrice),
  )
  const [note, setNote] = useState(item.note ?? '')
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [busy, setBusy] = useState(false)
  const changed =
    target !== (item.targetPrice === undefined ? '' : String(item.targetPrice)) ||
    note !== (item.note ?? '')

  async function save(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    const text = target.trim()
    const value = parseNumber(text)
    if (value !== null && (/^-/.test(text) || Number.isNaN(value) || value <= 0)) {
      return setError('Enter a price above 0, or leave it blank')
    }
    if (value !== null && value > 1e12) return setError('That number is too large')
    setError('')
    if (!changed) return onDone()
    setBusy(true)
    try {
      await updateWatchItem(item.symbol, { targetPrice: value, note: note.trim() })
      onDone()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      // The dialog closes by itself once the item is gone
      await removeWatchSymbol(item.symbol)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Takes the dialog's initial focus, so opening it doesn't pop up the keyboard */}
      {live ? (
        <div tabIndex={-1} className="outline-none">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="text-3xl font-semibold tabular-nums">{formatPrice(live.price)}</p>
            <p className={`tabular-nums ${pnlColor(live.change)}`}>
              {formatSignedPrice(live.change)} ({formatSignedPercent(live.changePct)}){' '}
              {changeSuffix[live.session ?? 'live']}
            </p>
          </div>
          {live.source === 'yahoo' && quote && (
            <p className="mt-1 text-sm text-muted tabular-nums">
              At close {formatPrice(quote.price)}{' '}
              <span className={pnlColor(quote.changePct)}>
                ({formatSignedPercent(quote.changePct)})
              </span>
            </p>
          )}
          {quote && (
            <dl className="mt-3 grid grid-cols-4 gap-2">
              <Stat label="Open" value={quote.open} />
              <Stat label="High" value={quote.high} />
              <Stat label="Low" value={quote.low} />
              <Stat label="Prev close" value={quote.prevClose} />
            </dl>
          )}
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            {live.time > 0 && (
              <span>
                {priceSessionLong[live.session ?? 'live']} from {formatClock(live.time)}
              </span>
            )}
            <span>Checked {formatAge(live.fetchedAt, now)}</span>
            <StaleLabel price={live} failure={failure} now={now} />
          </p>
          {failure && failure !== 'not-found' && (
            <p className="mt-2 text-sm text-amber-200">{quoteErrorLong[failure]}</p>
          )}
        </div>
      ) : (
        <p tabIndex={-1} className="text-muted outline-none">
          {failure ? quoteErrorLong[failure] : 'No price yet.'}
        </p>
      )}

      {earningsLine && <p className="text-sm text-muted">{earningsLine}</p>}

      <form noValidate onSubmit={save} className="space-y-3">
        {saveError && (
          <p role="alert" className="text-sm text-loss">
            Couldn't save: {saveError}
          </p>
        )}
        <div className="grid grid-cols-[2fr_3fr] gap-3">
          <Field id="watch-target" label="Target price" error={error}>
            <input
              {...fieldA11y('watch-target', error || undefined)}
              className={inputClass}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              placeholder="—"
            />
          </Field>
          <Field id="watch-note" label="Note">
            <input
              id="watch-note"
              className={inputClass}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              autoComplete="off"
              maxLength={80}
              enterKeyHint="done"
              placeholder="e.g. earnings 11/19"
            />
          </Field>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-accent py-3 font-semibold text-bg disabled:opacity-50"
        >
          {changed ? 'Save' : 'Done'}
        </button>
      </form>

      <div className="grid grid-cols-2 gap-3">
        <Link
          to={`/trade/new?symbol=${encodeURIComponent(item.symbol)}`}
          className="rounded-xl border border-border py-3 text-center font-medium"
        >
          Log a trade
        </Link>
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="rounded-xl border border-loss/40 py-3 font-medium text-loss disabled:opacity-50"
        >
          Remove
        </button>
      </div>
    </div>
  )
}

function Watchlist() {
  const settings = useLoadedSettings()
  const watchlist = useWatchlist()
  const trades = useTrades()
  const online = useOnline()
  const status = usePriceStatus()
  // Ticks every second while counting down a rate-limit back-off
  const now = useNow(status.problem === 'rate-limited' ? 1000 : 15_000)
  const [selected, setSelected] = useState<string | null>(null)

  const openTrades = useMemo(() => (trades ?? []).filter((t) => !isClosed(t)), [trades])
  const symbols = useMemo(
    () =>
      distinctSorted([
        ...(watchlist ?? []).map((w) => w.symbol),
        ...openTrades.map((t) => t.symbol),
      ]),
    [watchlist, openTrades],
  )
  const live = useLivePrices(symbols, now)
  const apiKey = settings?.finnhubApiKey ?? ''
  const relayUrl = settings?.priceRelayUrl ?? ''
  const refresh = usePriceRefresh(symbols, { apiKey, relayUrl }, online, status.retryAt)
  const canRefresh = Boolean(apiKey || relayUrl) && online && symbols.length > 0
  const earnings = useEarnings(symbols)
  useEarningsRefresh(symbols, apiKey, online)

  // Symbols you've traded but don't watch, most recent first
  const suggestions = useMemo(() => {
    const watched = new Set((watchlist ?? []).map((w) => w.symbol))
    return [...new Set((trades ?? []).map((t) => t.symbol))]
      .filter((s) => !watched.has(s))
      .slice(0, 6)
  }, [trades, watchlist])

  const newest = useMemo(() => {
    let latest: number | null = null
    for (const p of live?.prices.values() ?? []) latest = Math.max(latest ?? 0, p.fetchedAt)
    return latest
  }, [live])

  const selectedItem = watchlist?.find((w) => w.symbol === selected) ?? null
  const ready =
    settings !== undefined && watchlist !== undefined && trades !== undefined && live !== undefined
  // Rows show a placeholder instead of "—" while their first price is on the way
  const loading = status.refreshing && canRefresh
  // The failure behind each symbol's price, from the source it came from
  const failures = useMemo(() => {
    const out: Record<string, QuoteError> = {}
    for (const s of symbols) {
      const failure = priceFailure(live?.prices.get(s), s, status, online)
      if (failure) out[s] = failure
    }
    return out
  }, [symbols, live, status, online])

  return (
    <>
      <PullToRefresh onRefresh={() => refresh(MANUAL_REFRESH_AGE)} disabled={!canRefresh} />
      <Screen
        title="Watchlist"
        action={
          apiKey || relayUrl ? (
            <button
              type="button"
              onClick={() => refresh(MANUAL_REFRESH_AGE)}
              disabled={!canRefresh}
              aria-label="Refresh prices"
              className="grid size-11 place-items-center rounded-full text-muted disabled:opacity-40"
            >
              <RefreshIcon spinning={status.refreshing} />
            </button>
          ) : null
        }
      >
        {ready && (
          <>
            <PriceBanner
              apiKey={apiKey}
              online={online}
              status={status}
              newest={newest}
              hasSymbols={symbols.length > 0}
              now={now}
            />
            {apiKey && online && status.problem !== 'invalid-key' && symbols.length > 0 && (
              <ExtendedNote relayUrl={relayUrl} problem={status.extendedProblem} now={now} />
            )}

            {openTrades.length > 0 && (
              <OpenPositionsSection
                trades={openTrades}
                prices={live.prices}
                failures={failures}
                loading={loading}
                currency={TRADE_CURRENCY}
                now={now}
                earnings={earnings}
              />
            )}

            <section aria-labelledby="watching-heading">
              <h2 id="watching-heading" className={`mb-2 ${sectionHeading}`}>
                Watching
              </h2>
              <AddSymbolForm suggestions={suggestions} />
              {watchlist.length === 0 ? (
                <EmptyState
                  icon={<WatchlistIcon />}
                  title="Nothing on your watchlist"
                  text="Add a symbol above to follow its price and daily change."
                />
              ) : (
                <ul className="space-y-2">
                  {watchlist.map((item) => (
                    <WatchRow
                      key={item.symbol}
                      item={item}
                      live={live.prices.get(item.symbol)}
                      failure={failures[item.symbol]}
                      loading={loading}
                      now={now}
                      earnings={earnings?.get(item.symbol)}
                      onOpen={setSelected}
                    />
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </Screen>

      <Modal
        open={selectedItem !== null}
        onClose={() => setSelected(null)}
        title={selectedItem?.symbol ?? ''}
        align="top"
      >
        {selectedItem && (
          <WatchItemDetails
            key={selectedItem.symbol}
            item={selectedItem}
            live={live?.prices.get(selectedItem.symbol)}
            quote={live?.quotes.get(selectedItem.symbol)}
            failure={failures[selectedItem.symbol]}
            now={now}
            earnings={earnings?.get(selectedItem.symbol)}
            onDone={() => setSelected(null)}
          />
        )}
      </Modal>
    </>
  )
}

export default Watchlist
