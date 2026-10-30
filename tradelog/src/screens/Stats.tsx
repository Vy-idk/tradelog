import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { EquityChart, MonthlyPnlChart, StrategyBreakdown } from '../components/Charts.tsx'
import Screen, { EmptyState } from '../components/Screen.tsx'
import StatCard, { ChartCard } from '../components/StatCard.tsx'
import { StatsIcon } from '../components/icons.tsx'
import { pnlColor, primaryActionClass } from '../components/styles.ts'
import { useSettings } from '../db/settings.ts'
import { useTrades } from '../db/trades.ts'
import {
  formatFactor,
  formatMoney,
  formatRatioPercent,
  formatSignedMoney,
  formatSignedPercent,
} from '../lib/format.ts'
import { equityCurve, pnlByMonth, pnlByStrategy, tradeStats } from '../lib/pnl.ts'

/** The monthly chart stays readable on a phone with up to a year of bars. */
const MAX_MONTHS = 12

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function Stats() {
  const trades = useTrades()
  const { currency, startingBalance } = useSettings()

  const data = useMemo(() => {
    if (!trades) return undefined
    return {
      stats: tradeStats(trades),
      curve: equityCurve(trades, startingBalance),
      months: pnlByMonth(trades),
      strategies: pnlByStrategy(trades),
    }
  }, [trades, startingBalance])

  if (!data) return <Screen title="Stats" />

  const { stats, curve, months, strategies } = data
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
              stats.openCount === 1 ? 'your open trade' : `one of your ${stats.openCount} open trades`
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

  return (
    <Screen title="Stats">
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
              {startingBalance > 0 && (
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
          {startingBalance === 0 && (
            <p className="mt-2 text-xs text-muted">
              Starts from zero.{' '}
              <Link to="/settings" className="text-accent underline underline-offset-2">
                Set a starting balance
              </Link>{' '}
              to track your account value.
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
