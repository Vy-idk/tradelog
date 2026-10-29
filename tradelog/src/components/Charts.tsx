import { useId, type ReactNode } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts'
import { addDays, parseIsoDate, today } from '../lib/dates.ts'
import {
  axisMoneyFormatter,
  formatDateRange,
  formatMoney,
  formatMonth,
  formatRatioPercent,
  formatSignedMoney,
} from '../lib/format.ts'
import type { EquityPoint, PeriodPnl, StrategyPnl } from '../lib/pnl.ts'
import { dailyEquity } from '../lib/pnl.ts'
import { niceTicks } from '../lib/ticks.ts'
import { pnlColor } from './styles.ts'

// CSS variables from the Tailwind theme work as SVG presentation attributes
const GAIN = 'var(--color-gain)'
const LOSS = 'var(--color-loss)'
const tick = { fill: 'var(--color-muted)', fontSize: 12 }
const axisProps = { tickLine: false, axisLine: false, tick } as const

/** Round ticks on a money axis spanning these values, with matching labels. */
function moneyAxis(values: number[], currency: string) {
  const { ticks } = niceTicks(Math.min(...values), Math.max(...values))
  return {
    ...axisProps,
    ticks,
    domain: [ticks[0], ticks.at(-1)!],
    tickFormatter: axisMoneyFormatter(ticks, currency),
    width: 60,
    interval: 0,
  } as const
}

function TooltipBox({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-bg px-3 py-2 text-sm shadow-lg shadow-black/40 tabular-nums">
      {children}
    </div>
  )
}

/** The data row behind the hovered or tapped point. */
function hovered<T>(props: Pick<TooltipContentProps, 'active' | 'payload'>): T | null {
  return props.active && props.payload?.length ? (props.payload[0].payload as T) : null
}

type EquityRow = { t: number; date: string; equity: number; start?: boolean }

export function EquityChart({
  points,
  startingBalance,
  currency,
}: {
  points: EquityPoint[]
  startingBalance: number
  currency: string
}) {
  const gradientId = `equity-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const days = dailyEquity(points)
  if (days.length === 0) return null

  // Start the line at the starting balance the day before the first close
  const startDate = addDays(days[0].date, -1)
  const data: EquityRow[] = [
    { t: parseIsoDate(startDate).getTime(), date: startDate, equity: startingBalance, start: true },
    ...days.map((d) => ({ ...d, t: parseIsoDate(d.date).getTime() })),
  ]
  const color = days.at(-1)!.equity >= startingBalance ? GAIN : LOSS
  const first = data[0]
  const last = data.at(-1)!
  const yAxis = moneyAxis(
    data.map((d) => d.equity),
    currency,
  )

  return (
    <figure
      aria-label={`Equity from ${formatMoney(startingBalance, currency)} to ${formatMoney(last.equity, currency)}`}
    >
      <AreaChart
        responsive
        data={data}
        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        style={{ width: '100%', height: 200 }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--color-border)" />
        <XAxis
          {...axisProps}
          dataKey="t"
          type="number"
          scale="time"
          domain={['dataMin', 'dataMax']}
          ticks={first.t === last.t ? [first.t] : [first.t, last.t]}
          tickFormatter={(t: number) => formatDateRange(today(new Date(t)))}
          padding={{ left: 4, right: 12 }}
        />
        <YAxis {...yAxis} />
        <ReferenceLine y={startingBalance} stroke="var(--color-muted)" strokeDasharray="4 4" />
        <Tooltip
          cursor={{ stroke: 'var(--color-muted)', strokeDasharray: '3 3' }}
          content={(props) => {
            const row = hovered<EquityRow>(props)
            if (!row) return null
            const change = row.equity - startingBalance
            return (
              <TooltipBox>
                <p className="text-muted">{row.start ? 'Start' : formatDateRange(row.date)}</p>
                <p className="font-semibold">{formatMoney(row.equity, currency)}</p>
                {!row.start && (
                  <p className={pnlColor(change)}>{formatSignedMoney(change, currency)}</p>
                )}
              </TooltipBox>
            )
          }}
        />
        <Area
          type="monotone"
          dataKey="equity"
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          baseValue={yAxis.ticks[0]}
          isAnimationActive={false}
          activeDot={{ r: 4, strokeWidth: 0, fill: color }}
        />
      </AreaChart>
    </figure>
  )
}

export function MonthlyPnlChart({ months, currency }: { months: PeriodPnl[]; currency: string }) {
  if (months.length === 0) return null
  const withYear = months[0].month.slice(0, 4) !== months.at(-1)!.month.slice(0, 4)
  // Always include zero so bars grow from the axis line
  const yAxis = moneyAxis([0, ...months.map((m) => m.pnl)], currency)

  return (
    <figure aria-label="Realized P&L by month">
      <BarChart
        responsive
        data={months}
        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        style={{ width: '100%', height: 180 }}
      >
        <CartesianGrid vertical={false} stroke="var(--color-border)" />
        <XAxis
          {...axisProps}
          dataKey="month"
          interval="preserveStartEnd"
          minTickGap={4}
          tickFormatter={(m: string) => formatMonth(m, withYear ? 'year' : 'short')}
        />
        <YAxis {...yAxis} />
        <ReferenceLine y={0} stroke="var(--color-muted)" />
        <Tooltip
          cursor={{ fill: 'var(--color-border)', opacity: 0.5 }}
          content={(props) => {
            const row = hovered<PeriodPnl>(props)
            if (!row) return null
            return (
              <TooltipBox>
                <p className="text-muted">{formatMonth(row.month, 'long')}</p>
                <p className={`font-semibold ${pnlColor(row.pnl)}`}>
                  {formatSignedMoney(row.pnl, currency)}
                </p>
                <p className="text-muted">
                  {row.count} {row.count === 1 ? 'trade' : 'trades'}
                </p>
              </TooltipBox>
            )
          }}
        />
        <Bar dataKey="pnl" radius={[3, 3, 3, 3]} maxBarSize={32} isAnimationActive={false}>
          {months.map((m) => (
            <Cell key={m.month} fill={m.pnl < 0 ? LOSS : GAIN} />
          ))}
        </Bar>
      </BarChart>
    </figure>
  )
}

/** One row per strategy with a bar scaled to the largest absolute P&L. */
export function StrategyBreakdown({ rows, currency }: { rows: StrategyPnl[]; currency: string }) {
  const max = Math.max(...rows.map((r) => Math.abs(r.pnl)), 0)
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.strategy}>
          <div className="flex items-baseline justify-between gap-3">
            <span className={`min-w-0 truncate ${r.strategy ? '' : 'text-muted italic'}`}>
              {r.strategy || 'No strategy'}
            </span>
            <span className={`shrink-0 font-semibold tabular-nums ${pnlColor(r.pnl)}`}>
              {formatSignedMoney(r.pnl, currency)}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg">
              <div
                className={`h-full rounded-full ${r.pnl < 0 ? 'bg-loss' : 'bg-gain'}`}
                style={{ width: max > 0 ? `${(Math.abs(r.pnl) / max) * 100}%` : 0 }}
              />
            </div>
            <span className="shrink-0 text-xs text-muted tabular-nums">
              {r.count} {r.count === 1 ? 'trade' : 'trades'} ·{' '}
              {formatRatioPercent(r.wins / r.count)} win
            </span>
          </div>
        </li>
      ))}
    </ul>
  )
}
