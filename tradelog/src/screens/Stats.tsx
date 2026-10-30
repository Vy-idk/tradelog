import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { EquityChart, MonthlyPnlChart, StrategyBreakdown } from '../components/Charts.tsx'
import Screen, { EmptyState } from '../components/Screen.tsx'
import StatCard, { ChartCard } from '../components/StatCard.tsx'
import { StatsIcon } from '../components/icons.tsx'
import { pnlColor, primaryActionClass } from '../components/styles.ts'
import { useFxRates, useFxRefresh } from '../db/fx.ts'
import type { Settings, Trade } from '../db/schema.ts'
import { updateSettings, useLoadedSettings } from '../db/settings.ts'
import { useTrades } from '../db/trades.ts'
import {
  formatFactor,
  formatMoney,
  formatRatioPercent,
  formatSignedMoney,
  formatSignedPercent,
} from '../lib/format.ts'
import {
  accountCurrencies,
  convert,
  openCost,
  startingEquity,
  sumBalances,
  tradesIn,
  TRADE_CURRENCY,
  type FxRates,
} from '../lib/fx.ts'
import { equityCurve, pnlByMonth, pnlByStrategy, tradeStats } from '../lib/pnl.ts'

/** The monthly chart stays readable on a phone with up to a year of bars. */
const MAX_MONTHS = 12

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

const currencyNames = new Intl.DisplayNames(undefined, { type: 'currency' })
const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

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
  const currencies = settings ? accountCurrencies(settings) : [TRADE_CURRENCY]
  useFxRefresh(currencies.length > 1)
  // The switch's last pick, unless that currency is no longer in use
  const wanted =
    settings && currencies.includes(settings.statsCurrency)
      ? settings.statsCurrency
      : (settings?.currency ?? TRADE_CURRENCY)

  const data = useMemo(() => {
    if (!trades || !settings || rates === undefined) return undefined
    const shown = pickShown(settings, trades, wanted, rates)
    const converted = tradesIn(trades, shown.rate)
    return {
      shown,
      stats: tradeStats(converted),
      curve: equityCurve(converted, shown.start),
      months: pnlByMonth(converted),
      strategies: pnlByStrategy(converted),
    }
  }, [trades, settings, rates, wanted])

  if (!data || !trades || !settings) return <Screen title="Stats" />

  const { shown, stats, curve, months, strategies } = data
  const { currency, start: startingBalance } = shown
  const hasBalance =
    settings.balanceMode === 'current'
      ? settings.cashBalances.length > 0
      : settings.startingBalance > 0
  if (stats.closedCount === 0) {
    return (
      <Screen title="Stats">
        {stats.openCount === 0 ? (
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
        )}
      </Screen>
    )
  }

  const money = (v: number) => formatSignedMoney(v, currency)
  const shownMonths = months.slice(-MAX_MONTHS)
  const endEquity = curve.at(-1)!.equity

  const cash =
    settings.balanceMode === 'current' && hasBalance
      ? sumBalances(settings.cashBalances, currency, rates)
      : null

  return (
    <Screen title="Stats">
      {currencies.length > 1 && (
        <CurrencySwitch currencies={currencies} shown={currency} rates={rates ?? null} />
      )}
      {shown.missing && (
        <p
          role="status"
          className="mb-3 rounded-lg border border-amber-300/40 bg-amber-300/10 p-3 text-sm text-amber-300"
        >
          No exchange rate for {shown.missing} yet, so money shows in US dollars
          {hasBalance && startingBalance === 0 && ' and the equity curve starts from zero'}. Rates
          load when you&apos;re online.
        </p>
      )}
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
              {hasBalance && startingBalance > 0 && (
                <span className={pnlColor(stats.totalPnl)}>
                  {formatSignedPercent((stats.totalPnl / startingBalance) * 100)} on{' '}
                  {formatMoney(startingBalance, currency)} ·{' '}
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
              stats.profitFactor === null ? '' : stats.profitFactor >= 1 ? 'text-gain' : 'text-loss'
            }
            detail="Gross win ÷ gross loss"
          />
          <StatCard
            label="Avg win"
            value={stats.avgWin === null ? '—' : money(stats.avgWin)}
            valueClass={stats.avgWin === null ? '' : 'text-gain'}
            detail={stats.largestWin === null ? 'No wins yet' : `Best ${money(stats.largestWin)}`}
          />
          <StatCard
            label="Avg loss"
            value={stats.avgLoss === null ? '—' : money(stats.avgLoss)}
            valueClass={stats.avgLoss === null ? '' : 'text-loss'}
            detail={
              stats.largestLoss === null ? 'No losses yet' : `Worst ${money(stats.largestLoss)}`
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
            detail={`${stats.openCount} open · ${formatMoney(stats.totalFees, currency)} fees`}
          />
        </dl>

        <ChartCard title="Equity curve" aside={formatMoney(endEquity, currency)}>
          <EquityChart points={curve} startingBalance={startingBalance} currency={currency} />
          {!hasBalance && (
            <p className="mt-2 text-xs text-muted">
              Starts from zero.{' '}
              <Link to="/settings" className="text-accent underline underline-offset-2">
                Add a starting balance or your cash today
              </Link>{' '}
              to track your account value.
            </p>
          )}
          {cash !== null && (
            <p className="mt-2 text-xs text-muted tabular-nums">
              Worked back from {formatMoney(cash, currency)} cash today
              {stats.openCount > 0 &&
                ` and ${formatMoney(openCost(trades) * shown.rate, currency)} in open trades at cost`}
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

        <ChartCard title="P&L by strategy">
          <StrategyBreakdown rows={strategies} currency={currency} />
        </ChartCard>
      </div>
    </Screen>
  )
}

export default Stats
