import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { SideBadge } from '../components/Badges.tsx'
import Field from '../components/Field.tsx'
import Modal from '../components/Modal.tsx'
import { PriceCell, StaleLabel } from '../components/Price.tsx'
import PullToRefresh from '../components/PullToRefresh.tsx'
import Screen, { EmptyState } from '../components/Screen.tsx'
import { chipClass, fieldA11y, inputClass, pnlColor } from '../components/styles.ts'
import { refreshQuotes, usePriceStatus, useQuotes, type PriceStatus } from '../db/quotes.ts'
import type { Quote, Trade, WatchItem } from '../db/schema.ts'
import { useLoadedSettings } from '../db/settings.ts'
import { useTrades } from '../db/trades.ts'
import {
  addWatchSymbol,
  removeWatchSymbol,
  updateWatchItem,
  useWatchlist,
} from '../db/watchlist.ts'
import {
  formatAge,
  formatClock,
  formatPrice,
  formatQuantity,
  formatSignedMoney,
  formatSignedPercent,
  formatSignedPrice,
} from '../lib/format.ts'
import { distinctSorted } from '../lib/journal.ts'
import { isClosed, openPositions, unrealizedPnl, unrealizedReturnPct } from '../lib/pnl.ts'
import { MANUAL_REFRESH_AGE, QUOTE_TTL, quoteErrorLong, type QuoteError } from '../lib/prices.ts'
import { parseNumber } from '../lib/tradeDraft.ts'
import { useNow } from '../lib/useNow.ts'
import { useOnline } from '../lib/useOnline.ts'

/** Just past the cache period, so every quote is due when the timer fires */
const AUTO_REFRESH_MS = QUOTE_TTL + 1000

const sectionHeading = 'text-sm font-medium tracking-wide text-muted uppercase'

/**
 * Keeps prices fresh while this screen is open: once on arrival, then every
 * minute while the app is in the foreground and online, and as soon as a
 * rate-limit back-off ends. Returns a manual refresh for pull-to-refresh and
 * the refresh button.
 */
function usePriceRefresh(
  symbols: string[],
  apiKey: string,
  online: boolean,
  retryAt: number | null,
) {
  const key = symbols.join(',')
  const refresh = useCallback(
    (maxAge?: number) => refreshQuotes(key ? key.split(',') : [], apiKey, { maxAge }),
    [key, apiKey],
  )

  useEffect(() => {
    if (!key || !apiKey || !online) return
    void refresh()
    const tick = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const timer = setInterval(tick, AUTO_REFRESH_MS)
    // Coming back to the app refreshes right away instead of on the next tick
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [refresh, key, apiKey, online])

  useEffect(() => {
    if (!retryAt || !key || !apiKey || !online) return
    // A moment past the end, so the client is no longer backing off
    const timer = setTimeout(() => void refresh(), Math.max(0, retryAt - Date.now()) + 250)
    return () => clearTimeout(timer)
  }, [retryAt, refresh, key, apiKey, online])

  return refresh
}

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

function OpenPositionRow({
  trade,
  quote,
  failure,
  loading,
  currency,
  now,
}: {
  trade: Trade
  quote: Quote | undefined
  failure: QuoteError | undefined
  loading: boolean
  currency: string
  now: number
}) {
  const pnl = quote ? unrealizedPnl(trade, quote.price) : null
  const pct = quote ? unrealizedReturnPct(trade, quote.price) : null
  return (
    <li>
      <Link
        to={`/trade/${trade.id}`}
        className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-3"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{trade.symbol}</span>
            <SideBadge side={trade.side} />
          </div>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted tabular-nums">
            <span className="truncate">
              {formatQuantity(trade.quantity)} @ {formatPrice(trade.entryPrice)}
              {quote && ` → ${formatPrice(quote.price)}`}
            </span>
            {quote && <StaleLabel quote={quote} failure={failure} now={now} />}
          </p>
        </div>
        {pnl !== null ? (
          <div className="shrink-0 text-right tabular-nums">
            <p className={`font-semibold ${pnlColor(pnl)}`}>{formatSignedMoney(pnl, currency)}</p>
            {pct !== null && (
              <p className={`text-xs ${pnlColor(pnl)}`}>{formatSignedPercent(pct)}</p>
            )}
          </div>
        ) : (
          <PriceCell quote={undefined} failure={failure} loading={loading} now={now} />
        )}
      </Link>
    </li>
  )
}

function OpenPositionsSection({
  trades,
  quotes,
  failures,
  loading,
  currency,
  now,
}: {
  trades: Trade[]
  quotes: ReadonlyMap<string, Quote>
  failures: Readonly<Record<string, QuoteError>>
  loading: boolean
  currency: string
  now: number
}) {
  const summary = useMemo(
    () => openPositions(trades, new Map([...quotes].map(([s, q]) => [s, q.price]))),
    [trades, quotes],
  )
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
              {formatSignedMoney(summary.unrealizedPnl, currency)}
              {totalPct !== null && ` (${formatSignedPercent(totalPct)})`}
            </span>
          </p>
        )}
      </div>
      <ul className="space-y-2">
        {trades.map((t) => (
          <OpenPositionRow
            key={t.id}
            trade={t}
            quote={quotes.get(t.symbol)}
            failure={failures[t.symbol]}
            loading={loading}
            currency={currency}
            now={now}
          />
        ))}
      </ul>
      {summary.priced > 0 && summary.priced < summary.count && (
        <p className="mt-2 text-xs text-muted">
          The total covers the {summary.priced} of {summary.count} open trades that have a price.
        </p>
      )}
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

function targetText(item: WatchItem, quote: Quote | undefined): string {
  if (item.targetPrice === undefined) return ''
  const away = quote
    ? ` (${formatSignedPercent(((item.targetPrice - quote.price) / quote.price) * 100)})`
    : ''
  return `Target ${formatPrice(item.targetPrice)}${away}`
}

function WatchRow({
  item,
  quote,
  failure,
  loading,
  now,
  onOpen,
}: {
  item: WatchItem
  quote: Quote | undefined
  failure: QuoteError | undefined
  loading: boolean
  now: number
  onOpen: (symbol: string) => void
}) {
  const detail = [targetText(item, quote), item.note].filter(Boolean).join(' · ')
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
        </div>
        <PriceCell quote={quote} failure={failure} loading={loading} now={now} />
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

function WatchItemDetails({
  item,
  quote,
  failure,
  now,
  onDone,
}: {
  item: WatchItem
  quote: Quote | undefined
  failure: QuoteError | undefined
  now: number
  onDone: () => void
}) {
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
      {quote ? (
        <div tabIndex={-1} className="outline-none">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="text-3xl font-semibold tabular-nums">{formatPrice(quote.price)}</p>
            <p className={`tabular-nums ${pnlColor(quote.change)}`}>
              {formatSignedPrice(quote.change)} ({formatSignedPercent(quote.changePct)}) today
            </p>
          </div>
          <dl className="mt-3 grid grid-cols-4 gap-2">
            <Stat label="Open" value={quote.open} />
            <Stat label="High" value={quote.high} />
            <Stat label="Low" value={quote.low} />
            <Stat label="Prev close" value={quote.prevClose} />
          </dl>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            {quote.priceTime > 0 && <span>Price from {formatClock(quote.priceTime)}</span>}
            <span>Checked {formatAge(quote.fetchedAt, now)}</span>
            <StaleLabel quote={quote} failure={failure} now={now} />
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
  const quotes = useQuotes(symbols)
  const apiKey = settings?.finnhubApiKey ?? ''
  const refresh = usePriceRefresh(symbols, apiKey, online, status.retryAt)
  const canRefresh = Boolean(apiKey) && online && symbols.length > 0

  // Symbols you've traded but don't watch, most recent first
  const suggestions = useMemo(() => {
    const watched = new Set((watchlist ?? []).map((w) => w.symbol))
    return [...new Set((trades ?? []).map((t) => t.symbol))]
      .filter((s) => !watched.has(s))
      .slice(0, 6)
  }, [trades, watchlist])

  const newest = useMemo(() => {
    let latest: number | null = null
    for (const q of quotes?.values() ?? []) latest = Math.max(latest ?? 0, q.fetchedAt)
    return latest
  }, [quotes])

  const selectedItem = watchlist?.find((w) => w.symbol === selected) ?? null
  const ready =
    settings !== undefined &&
    watchlist !== undefined &&
    trades !== undefined &&
    quotes !== undefined
  // Rows show a placeholder instead of "—" while their first price is on the way
  const loading = status.refreshing && canRefresh
  // Offline, every price on screen is the last known one
  const failures = useMemo(
    (): Readonly<Record<string, QuoteError>> =>
      online ? status.failures : Object.fromEntries(symbols.map((s) => [s, 'offline'])),
    [online, status.failures, symbols],
  )

  return (
    <>
      <PullToRefresh onRefresh={() => refresh(MANUAL_REFRESH_AGE)} disabled={!canRefresh} />
      <Screen
        title="Watchlist"
        action={
          apiKey ? (
            <button
              type="button"
              onClick={() => refresh(MANUAL_REFRESH_AGE)}
              disabled={!canRefresh}
              aria-label="Refresh prices"
              className="-mr-2 grid size-11 place-items-center rounded-full text-muted disabled:opacity-40"
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

            {openTrades.length > 0 && (
              <OpenPositionsSection
                trades={openTrades}
                quotes={quotes}
                failures={failures}
                loading={loading}
                currency={settings.currency}
                now={now}
              />
            )}

            <section aria-labelledby="watching-heading">
              <h2 id="watching-heading" className={`mb-2 ${sectionHeading}`}>
                Watching
              </h2>
              <AddSymbolForm suggestions={suggestions} />
              {watchlist.length === 0 ? (
                <EmptyState text="Add a symbol to follow its price." />
              ) : (
                <ul className="space-y-2">
                  {watchlist.map((item) => (
                    <WatchRow
                      key={item.symbol}
                      item={item}
                      quote={quotes.get(item.symbol)}
                      failure={failures[item.symbol]}
                      loading={loading}
                      now={now}
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
            quote={quotes?.get(selectedItem.symbol)}
            failure={failures[selectedItem.symbol]}
            now={now}
            onDone={() => setSelected(null)}
          />
        )}
      </Modal>
    </>
  )
}

export default Watchlist
