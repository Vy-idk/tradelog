import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigationType, useSearchParams } from 'react-router-dom'
import QuickCloseDialog from '../components/QuickCloseDialog.tsx'
import Screen, { EmptyState } from '../components/Screen.tsx'
import TradeRow from '../components/TradeRow.tsx'
import type { Trade } from '../db/schema.ts'
import { useSettings } from '../db/settings.ts'
import { useTrades } from '../db/trades.ts'
import { distinctSorted, filterTrades, journalScroll, type JournalFilters } from '../lib/journal.ts'

type FilterKey = keyof JournalFilters

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  // Keep the current value selectable even if no trade uses it anymore
  const all = value && !options.includes(value) ? [value, ...options] : options
  return (
    <label
      className={`relative flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-sm ${
        value ? 'border-accent text-accent' : 'border-border text-muted'
      }`}
    >
      <span className="max-w-32 truncate">{value || label}</span>
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        aria-hidden
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
      {/* Invisible native select on top: gets the iOS picker wheel for free */}
      <select
        aria-label={`Filter by ${label.toLowerCase()}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        <option value="">All {label.toLowerCase()}s</option>
        {all.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Remembers the scroll position and restores it when coming back to the journal. */
function useJournalScroll(ready: boolean) {
  const anchor = useRef<HTMLDivElement>(null)
  const navigationType = useNavigationType()
  const restored = useRef(false)

  useEffect(() => {
    const main = anchor.current?.closest('main')
    if (!main) return
    const save = () => (journalScroll.top = main.scrollTop)
    main.addEventListener('scroll', save, { passive: true })
    return () => main.removeEventListener('scroll', save)
  }, [])

  useEffect(() => {
    if (!ready || restored.current) return
    restored.current = true
    const main = anchor.current?.closest('main')
    if (main && navigationType === 'POP') main.scrollTop = journalScroll.top
  }, [ready, navigationType])

  return anchor
}

function Journal() {
  const trades = useTrades()
  const { currency } = useSettings()
  const [params, setParams] = useSearchParams()
  const [closing, setClosing] = useState<Trade | null>(null)
  const anchor = useJournalScroll(trades !== undefined)

  // Filters live in the URL so they survive opening a trade and coming back
  const symbol = params.get('symbol') ?? ''
  const strategy = params.get('strategy') ?? ''
  const tag = params.get('tag') ?? ''
  const filtering = Boolean(symbol || strategy || tag)

  function setFilter(key: FilterKey, value: string) {
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true },
    )
  }

  const options = useMemo(
    () => ({
      symbol: distinctSorted((trades ?? []).map((t) => t.symbol)),
      strategy: distinctSorted((trades ?? []).map((t) => t.strategy)),
      tag: distinctSorted((trades ?? []).flatMap((t) => t.tags)),
    }),
    [trades],
  )
  const shown = useMemo(
    () => filterTrades(trades ?? [], { symbol, strategy, tag }),
    [trades, symbol, strategy, tag],
  )

  return (
    <Screen title="Journal">
      <div ref={anchor} />
      {trades === undefined ? null : trades.length === 0 ? (
        <EmptyState text="No trades yet. Tap + to log your first one." />
      ) : (
        <>
          <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
            <FilterSelect
              label="Symbol"
              value={symbol}
              options={options.symbol}
              onChange={(v) => setFilter('symbol', v)}
            />
            <FilterSelect
              label="Strategy"
              value={strategy}
              options={options.strategy}
              onChange={(v) => setFilter('strategy', v)}
            />
            <FilterSelect
              label="Tag"
              value={tag}
              options={options.tag}
              onChange={(v) => setFilter('tag', v)}
            />
          </div>

          {filtering && (
            <div className="mb-3 flex items-center justify-between text-sm text-muted">
              <span>
                {shown.length} of {trades.length} trades
              </span>
              <button
                type="button"
                onClick={() => setParams(new URLSearchParams(), { replace: true })}
                className="rounded-lg px-2 py-1 font-medium text-accent"
              >
                Clear filters
              </button>
            </div>
          )}

          {shown.length === 0 ? (
            <EmptyState text="No trades match these filters." />
          ) : (
            <ul className="space-y-2 pb-20">
              {shown.map((t) => (
                <TradeRow key={t.id} trade={t} currency={currency} onQuickClose={setClosing} />
              ))}
            </ul>
          )}
        </>
      )}

      <Link
        to="/trade/new"
        aria-label="Add trade"
        className="fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+5rem)] grid size-14 place-items-center rounded-full bg-accent text-bg shadow-lg shadow-black/40 active:scale-95"
      >
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </Link>

      <QuickCloseDialog trade={closing} currency={currency} onClose={() => setClosing(null)} />
    </Screen>
  )
}

export default Journal
