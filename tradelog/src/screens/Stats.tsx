import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { EquityChart, MonthlyPnlChart, PnlBreakdown } from '../components/Charts.tsx'
import { StaleLabel } from '../components/Price.tsx'
import Screen, { EmptyState } from '../components/Screen.tsx'
import StatCard, { ChartCard } from '../components/StatCard.tsx'
import { StatsIcon } from '../components/icons.tsx'
import { chipClass, pnlColor, primaryActionClass } from '../components/styles.ts'
import { useFxRates, useFxRefresh } from '../db/fx.ts'
import { useLivePrices, usePriceRefresh, usePriceStatus } from '../db/quotes.ts'
import type { Settings, StatsRange, Trade } from '../db/schema.ts'
import { updateSettings, useLoadedSettings } from '../db/settings.ts'
import { useTrades } from '../db/trades.ts'
import { useAmounts } from '../lib/amounts.ts'
import { today } from '../lib/dates.ts'
import {
  formatDateRange,
  formatDays,
  formatDaysShort,
  formatFactor,
  formatMoney,
  formatRatioPercent,
  formatSignedPercent,
} from '../lib/format.ts'
import {
  accountCurrencies,
  accountValue,
  convert,
  openCost,
  startingEquity,
  sumBalances,
  tradesIn,
  TRADE_CURRENCY,
  type AccountValue,
  type FxRates,
} from '../lib/fx.ts'
import { distinctSorted } from '../lib/journal.ts'
import {
  closedSince,
  equityCurve,
  equitySince,
  holdingDays,
  isClosed,
  maxDrawdown,
  pnlByMonth,
  pnlBySide,
  pnlByStrategy,
  pnlBySymbol,
  pnlByTag,
  pnlByWeekday,
  rangeStart,
  streaks,
  tradeStats,
  type PnlRow,
  type Streaks,
} from '../lib/pnl.ts'
import { useNow } from '../lib/useNow.ts'
import { useOnline } from '../lib/useOnline.ts'

/** The monthly chart stays readable on a phone with up to a year of bars. */
const MAX_MONTHS = 12

const RANGES: { value: StatsRange; label: string; name: string }[] = [
  { value: '30d', label: '30D', name: 'Last 30 days' },
  { value: '90d', label: '90D', name: 'Last 90 days' },
  { value: 'ytd', label: 'YTD', name: 'This year' },
  { value: '1y', label: '1Y', name: 'Last 12 months' },
  { value: 'all', label: 'All', name: 'All time' },
]

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

const currencyNames = new Intl.DisplayNames(undefined, { type: 'currency' })
const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const weekdayName = new Intl.DateTimeFormat(undefined, { weekday: 'long' })

/** "₪" for ILS, or the code when the currency has no symbol of its own. */
function currencySymbol(code: string): string {
  try {
    const parts = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0)
    const symbol = parts.find((p) => p.type === 'currency')?.value
    return symbol && symbol !== code ? symbol : ''
  } catch {
    return ''
  }
}

/** Switches Stats between dollars, the main currency and any balance currencies. */
function CurrencySwitch({
  currencies,
  shown,
  rates,
}: {
  currencies: string[]
  shown: string
  rates: FxRates | null
}) {
  const perDollar = convert(1, TRADE_CURRENCY, shown, rates)
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div
        role="group"
        aria-label="Show money in"
        className="flex rounded-lg border border-border bg-bg p-1"
      >
        {currencies.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={c === shown}
            title={currencyNames.of(c) ?? c}
            onClick={() => updateSettings({ statsCurrency: c })}
            className="min-h-9 rounded-md px-3 text-sm font-semibold text-muted aria-pressed:bg-surface aria-pressed:text-inherit aria-pressed:shadow"
          >
            {`${currencySymbol(c)} ${c}`.trim()}
          </button>
        ))}
      </div>
      {shown !== TRADE_CURRENCY && perDollar !== null && rates && (
        <p className="text-right text-xs text-muted tabular-nums">
          $1 = {formatMoney(perDollar, shown)}
          <br />
          ECB rate, {shortDate.format(new Date(`${rates.date}T12:00:00`))}
        </p>
      )}
    </div>
  )
}

/** Picks the period Stats cover, counted by exit date. */
function RangeSwitch({ range }: { range: StatsRange }) {
  return (
    <div
      role="group"
      aria-label="Period"
      className="mb-3 flex rounded-lg border border-border bg-bg p-1"
    >
      {RANGES.map((r) => (
        <button
          key={r.value}
          type="button"
          aria-pressed={r.value === range}
          aria-label={r.name}
          onClick={() => updateSettings({ statsRange: r.value })}
          className="min-h-9 flex-1 rounded-md text-sm font-semibold text-muted aria-pressed:bg-surface aria-pressed:text-inherit aria-pressed:shadow"
        >
          {r.label}
        </button>
      ))}
    </div>
  )
}

/** What the account is worth right now, with open trades at current prices. */
function AccountCard({
  account,
  hasBalance,
  currency,
  pricedAt,
  online,
  now,
}: {
  account: AccountValue
  hasBalance: boolean
  currency: string
  /** When the oldest price in use was fetched; null without prices */
  pricedAt: number | null
  online: boolean
  now: number
}) {
  const amounts = useAmounts()
  const { value, cash, positions, realized, unrealized, open, priced } = account
  const unpriced = open - priced
  return (
    <section className="mb-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm text-muted">{hasBalance ? 'Account value' : 'Unrealized P&L'}</h2>
        {pricedAt !== null && (
          <StaleLabel
            price={{ fetchedAt: pricedAt }}
            failure={online ? undefined : 'offline'}
            now={now}
          />
        )}
      </div>
      {hasBalance ? (
        <>
          <p className="mt-1 truncate text-3xl font-semibold tabular-nums">
            {amounts.money(value, currency)}
          </p>
          {priced > 0 && (
            <p className={`mt-1 text-sm tabular-nums ${pnlColor(unrealized)}`}>
              {amounts.signedMoney(unrealized, currency)} unrealized
            </p>
          )}
          <p className="mt-1 text-sm text-muted tabular-nums">
            {cash === null ? (
              <>
                Started at {amounts.money(value - realized - unrealized, currency)} ·{' '}
                {amounts.signedMoney(realized, currency)} realized
              </>
            ) : (
              <>
                {amounts.money(cash, currency)} cash · {amounts.money(positions, currency)} in{' '}
                {plural(open, 'open trade')}
              </>
            )}
          </p>
        </>
      ) : (
        <>
          <p
            className={`mt-1 truncate text-3xl font-semibold tabular-nums ${pnlColor(unrealized)}`}
          >
            {amounts.signedMoney(unrealized, currency)}
          </p>
          <p className="mt-1 text-sm text-muted">
            <Link to="/settings" className="text-accent underline underline-offset-2">
              Add your cash or a starting balance
            </Link>{' '}
            to see your account value.
          </p>
        </>
      )}
      {unpriced > 0 && (
        <p className="mt-2 text-xs text-muted">
          {unpriced === 1
            ? "1 open trade doesn't have a price yet, so it counts at cost."
            : `${unpriced} open trades don't have a price yet, so they count at cost.`}
        </p>
      )}
      {cash !== null && (
        <p className="mt-2 text-xs text-muted">
          Cash doesn&apos;t change by itself, so{' '}
          <Link to="/settings" className="text-accent underline underline-offset-2">
            update it
          </Link>{' '}
          when you open or close a trade.
        </p>
      )}
    </section>
  )
}

type View = 'strategy' | 'symbol' | 'tag' | 'side' | 'weekday'

const VIEWS: { value: View; label: string; note?: string }[] = [
  { value: 'strategy', label: 'Strategy' },
  { value: 'symbol', label: 'Symbol' },
  { value: 'tag', label: 'Tag', note: 'A trade with several tags counts under each one.' },
  { value: 'side', label: 'Side' },
  { value: 'weekday', label: 'Day', note: 'By the day each trade closed.' },
]

type Breakdowns = Record<View, (PnlRow & { label: string })[]>

function breakdowns(trades: Trade[]): Breakdowns {
  // January 4, 2026 was a Sunday, so counting on from it gives each getDay() value
  const weekday = (key: string) => weekdayName.format(new Date(2026, 0, 4 + Number(key)))
  const labelled = (rows: PnlRow[], label: (key: string) => string) =>
    rows.map((r) => ({ ...r, label: label(r.key) }))
  return {
    strategy: labelled(pnlByStrategy(trades), (k) => k || 'No strategy'),
    symbol: labelled(pnlBySymbol(trades), (k) => k),
    tag: labelled(pnlByTag(trades), (k) => (k ? `#${k}` : 'No tag')),
    side: labelled(pnlBySide(trades), (k) => (k === 'long' ? 'Long' : 'Short')),
    weekday: labelled(pnlByWeekday(trades), weekday),
  }
}

/** Where the P&L came from: one card that switches between ways of slicing it. */
function BreakdownCard({ rows, currency }: { rows: Breakdowns; currency: string }) {
  const [view, setView] = useState<View>('strategy')
  // Without any tags, that view would only say so
  const views = VIEWS.filter((v) => v.value !== 'tag' || rows.tag.some((r) => r.key))
  const current = views.find((v) => v.value === view) ?? views[0]
  return (
    <ChartCard title="P&L by">
      <div role="group" aria-label="Break down P&L by" className="mb-3 flex flex-wrap gap-2">
        {views.map((v) => (
          <button
            key={v.value}
            type="button"
            aria-pressed={v.value === current.value}
            onClick={() => setView(v.value)}
            className={chipClass}
          >
            {v.label}
          </button>
        ))}
      </div>
      <PnlBreakdown key={current.value} rows={rows[current.value]} currency={currency} />
      {current.note && <p className="mt-3 text-xs text-muted">{current.note}</p>}
    </ChartCard>
  )
}

/** "3 wins" or "2 losses" in a row, or nothing to report. */
function currentStreak({ current }: Streaks): string {
  if (current === 0) return '—'
  if (current > 0) return plural(current, 'win')
  return current === -1 ? '1 loss' : `${-current} losses`
}

type Shown = {
  currency: string
  /** Units of the shown currency per dollar */
  rate: number
  /** Where the equity curve starts, in the shown currency */
  start: number
  /** A currency that has no exchange rate yet, if one is needed */
  missing: string | null
}

/** The currency to show money in, falling back to dollars when a rate is missing. */
function pickShown(
  settings: Settings,
  trades: Trade[],
  wanted: string,
  rates: FxRates | null,
): Shown {
  const rate = convert(1, TRADE_CURRENCY, wanted, rates)
  const start = startingEquity(settings, trades, wanted, rates)
  if (rate !== null && start.ok)
    return { currency: wanted, rate, start: start.value, missing: null }
  const inDollars = startingEquity(settings, trades, TRADE_CURRENCY, rates)
  return {
    currency: TRADE_CURRENCY,
    rate: 1,
    // Without a rate for a balance, the curve can only start from zero
    start: inDollars.ok ? inDollars.value : 0,
    missing: rate === null ? wanted : start.ok ? null : start.missing,
  }
}

function Stats() {
  const trades = useTrades()
  const settings = useLoadedSettings()
  const rates = useFxRates()
  const amounts = useAmounts()
  const online = useOnline()
  const status = usePriceStatus()
  const now = useNow(15_000)
  const currencies = settings ? accountCurrencies(settings) : [TRADE_CURRENCY]
  useFxRefresh(currencies.length > 1)
  // The switch's last pick, unless that currency is no longer in use
  const wanted =
    settings && currencies.includes(settings.statsCurrency)
      ? settings.statsCurrency
      : (settings?.currency ?? TRADE_CURRENCY)
  const range = settings?.statsRange ?? 'all'
  const todayIso = today(new Date(now))

  const openSymbols = useMemo(
    () => distinctSorted((trades ?? []).filter((t) => !isClosed(t)).map((t) => t.symbol)),
    [trades],
  )
  const live = useLivePrices(openSymbols, now)
  usePriceRefresh(
    openSymbols,
    { apiKey: settings?.finnhubApiKey ?? '', relayUrl: settings?.priceRelayUrl ?? '' },
    online,
    status.retryAt,
  )

  const data = useMemo(() => {
    if (!trades || !settings || rates === undefined) return undefined
    const shown = pickShown(settings, trades, wanted, rates)
    const converted = tradesIn(trades, shown.rate)
    const from = rangeStart(range, todayIso)
    const ranged = closedSince(converted, from)
    const { points: curve, start } = equitySince(
      equityCurve(converted, shown.start),
      shown.start,
      from,
    )
    return {
      shown,
      everClosed: converted.some(isClosed),
      stats: tradeStats(ranged),
      curve,
      start,
      drawdown: maxDrawdown(curve, start),
      runs: streaks(ranged),
      holding: holdingDays(ranged),
      months: pnlByMonth(ranged),
      rows: breakdowns(ranged),
    }
  }, [trades, settings, rates, wanted, range, todayIso])

  const prices = live?.prices
  const account = useMemo(() => {
    if (!data || !trades || !settings || !prices) return null
    const last = new Map([...prices].map(([s, p]) => [s, p.price]))
    return accountValue(settings, trades, last, data.shown.currency, rates)
  }, [data, trades, settings, prices, rates])

  if (!data || !trades || !settings) return <Screen title="Stats" />

  const { shown, everClosed, stats, curve, start, drawdown, runs, holding, months, rows } = data
  const { currency } = shown
  const hasBalance =
    settings.balanceMode === 'current'
      ? settings.cashBalances.length > 0
      : settings.startingBalance > 0
  // A balance in a currency with no rate yet leaves the curve starting from zero
  const balanceKnown = hasBalance && shown.start !== 0
  const money = (v: number) => amounts.signedMoney(v, currency)
  const shownMonths = months.slice(-MAX_MONTHS)
  const showAccount = account !== null && (hasBalance || account.priced > 0)
  // The curve's last point includes open trades once any of them has a price
  const liveEquity = account && account.priced > 0 ? account.value : undefined
  const endEquity = liveEquity ?? curve.at(-1)?.equity ?? start

  const pricedAt =
    prices && prices.size > 0 ? Math.min(...[...prices.values()].map((p) => p.fetchedAt)) : null
  const cash =
    settings.balanceMode === 'current' && hasBalance
      ? sumBalances(settings.cashBalances, currency, rates)
      : null

  return (
    <Screen title="Stats">
      {currencies.length > 1 && (everClosed || showAccount) && (
        <CurrencySwitch currencies={currencies} shown={currency} rates={rates ?? null} />
      )}
      {shown.missing && (
        <p
          role="status"
          className="mb-3 rounded-lg border border-amber-300/40 bg-amber-300/10 p-3 text-sm text-amber-300"
        >
          No exchange rate for {shown.missing} yet, so money shows in US dollars
          {!balanceKnown && ' and the equity curve starts from zero'}. Rates load when you&apos;re
          online.
        </p>
      )}
      {showAccount && (
        <AccountCard
          account={account}
          hasBalance={hasBalance}
          currency={currency}
          pricedAt={pricedAt}
          online={online}
          now={now}
        />
      )}

      {!everClosed ? (
        stats.openCount === 0 ? (
          <EmptyState
            icon={<StatsIcon />}
            title="No stats yet"
            text="Once you close a trade, this is where your P&L, win rate, profit factor and equity curve appear."
            action={
              <Link to="/trade/new" className={primaryActionClass}>
                Log a trade
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={<StatsIcon />}
            title="Close a trade to see stats"
            text={`Stats count closed trades only. Close ${
              stats.openCount === 1
                ? 'your open trade'
                : `one of your ${stats.openCount} open trades`
            } to see them here.`}
            action={
              <Link to="/" className={primaryActionClass}>
                Go to journal
              </Link>
            }
          />
        )
      ) : (
        <>
          <RangeSwitch range={range} />
          {stats.closedCount === 0 ? (
            <EmptyState
              icon={<StatsIcon />}
              title="Nothing closed in this period"
              text="Pick a longer period to see your stats."
            />
          ) : (
            <div className="space-y-3">
              <dl className="grid grid-cols-2 gap-3">
                <div className="col-span-2 rounded-xl border border-border bg-surface p-4">
                  <dt className="text-sm text-muted">Total P&amp;L</dt>
                  <dd
                    className={`mt-1 truncate text-3xl font-semibold tabular-nums ${pnlColor(stats.totalPnl)}`}
                  >
                    {money(stats.totalPnl)}
                  </dd>
                  <dd className="mt-1 text-sm text-muted tabular-nums">
                    {balanceKnown && start > 0 && (
                      <span className={pnlColor(stats.totalPnl)}>
                        {formatSignedPercent((stats.totalPnl / start) * 100)} on{' '}
                        {amounts.money(start, currency)} ·{' '}
                      </span>
                    )}
                    {plural(stats.closedCount, 'closed trade')}
                    {stats.openCount > 0 && `, ${stats.openCount} open`}
                  </dd>
                </div>
                <StatCard
                  label="Win rate"
                  value={formatRatioPercent(stats.winRate!)}
                  detail={`${stats.wins}W · ${stats.losses}L${stats.breakeven ? ` · ${stats.breakeven} BE` : ''}`}
                />
                <StatCard
                  label="Profit factor"
                  value={stats.profitFactor === null ? '—' : formatFactor(stats.profitFactor)}
                  valueClass={
                    stats.profitFactor === null
                      ? ''
                      : stats.profitFactor >= 1
                        ? 'text-gain'
                        : 'text-loss'
                  }
                  detail="Gross win ÷ gross loss"
                />
                <StatCard
                  label="Avg win"
                  value={stats.avgWin === null ? '—' : money(stats.avgWin)}
                  valueClass={stats.avgWin === null ? '' : 'text-gain'}
                  detail={
                    stats.largestWin === null ? 'No wins yet' : `Best ${money(stats.largestWin)}`
                  }
                />
                <StatCard
                  label="Avg loss"
                  value={stats.avgLoss === null ? '—' : money(stats.avgLoss)}
                  valueClass={stats.avgLoss === null ? '' : 'text-loss'}
                  detail={
                    stats.largestLoss === null
                      ? 'No losses yet'
                      : `Worst ${money(stats.largestLoss)}`
                  }
                />
                <StatCard
                  label="Avg trade"
                  value={money(stats.avgTrade!)}
                  valueClass={pnlColor(stats.avgTrade!)}
                  detail="P&L per closed trade"
                />
                <StatCard
                  label="Trades"
                  value={String(stats.closedCount)}
                  detail={`${stats.openCount} open · ${amounts.money(stats.totalFees, currency)} fees`}
                />
                <StatCard
                  label="Max drawdown"
                  value={drawdown.amount === 0 ? 'None' : money(drawdown.amount)}
                  valueClass={drawdown.amount === 0 ? '' : 'text-loss'}
                  detail={
                    drawdown.troughDate === null
                      ? 'Equity never fell'
                      : [
                          drawdown.pct !== null && formatSignedPercent(drawdown.pct),
                          formatDateRange(drawdown.peakDate ?? curve[0].date, drawdown.troughDate),
                        ]
                          .filter(Boolean)
                          .join(' · ')
                  }
                />
                <StatCard
                  label="Avg hold"
                  value={holding.all === null ? '—' : formatDays(holding.all)}
                  detail={[
                    holding.wins !== null && `Wins ${formatDaysShort(holding.wins)}`,
                    holding.losses !== null && `Losses ${formatDaysShort(holding.losses)}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                />
                <StatCard
                  label="Current streak"
                  value={currentStreak(runs)}
                  valueClass={runs.current > 0 ? 'text-gain' : runs.current < 0 ? 'text-loss' : ''}
                  detail="Skips break-evens"
                />
                <StatCard
                  label="Longest streaks"
                  value={`${runs.longestWin}W · ${runs.longestLoss}L`}
                  detail="In a row, by exit date"
                />
              </dl>

              <ChartCard title="Equity curve" aside={amounts.money(endEquity, currency)}>
                <EquityChart
                  points={curve}
                  startingBalance={start}
                  currency={currency}
                  now={liveEquity}
                />
                {!hasBalance && (
                  <p className="mt-2 text-xs text-muted">
                    Starts from zero.{' '}
                    <Link to="/settings" className="text-accent underline underline-offset-2">
                      Add a starting balance or your cash today
                    </Link>{' '}
                    to track your account value.
                  </p>
                )}
                {liveEquity !== undefined && (
                  <p className="mt-2 text-xs text-muted">
                    The last point adds your open trades at current prices.
                  </p>
                )}
                {cash !== null && (
                  <p className="mt-2 text-xs text-muted tabular-nums">
                    Worked back from {amounts.money(cash, currency)} cash today
                    {stats.openCount > 0 &&
                      ` and ${amounts.money(openCost(trades) * shown.rate, currency)} in open trades at cost`}
                    .
                  </p>
                )}
                {currency !== TRADE_CURRENCY && (
                  <p className="mt-2 text-xs text-muted">
                    Trades are in US dollars, converted at today&apos;s rate.
                  </p>
                )}
              </ChartCard>

              <ChartCard
                title="P&L by month"
                aside={months.length > MAX_MONTHS ? `Last ${MAX_MONTHS} months` : undefined}
              >
                <MonthlyPnlChart months={shownMonths} currency={currency} />
              </ChartCard>

              <BreakdownCard rows={rows} currency={currency} />
            </div>
          )}
        </>
      )}
    </Screen>
  )
}

export default Stats
