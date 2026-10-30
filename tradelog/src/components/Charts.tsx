import { useId, useState, type ReactNode } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceDot,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts'
import { useAmounts } from '../lib/amounts.ts'
import { addDays, parseIsoDate, today } from '../lib/dates.ts'
import { formatDateRange, formatMonth, formatRatioPercent } from '../lib/format.ts'
import type { EquityPoint, PeriodPnl, PnlRow } from '../lib/pnl.ts'
import { dailyEquity } from '../lib/pnl.ts'
import { niceTicks } from '../lib/ticks.ts'
import { pnlColor } from './styles.ts'

// CSS variables from the Tailwind theme work as SVG presentation attributes
const GAIN = 'var(--color-gain)'
const LOSS = 'var(--color-loss)'
const tick = { fill: 'var(--color-muted)', fontSize: 12 }
const axisProps = { tickLine: false, axisLine: false, tick } as const

/** Round ticks on a money axis spanning these values, with matching labels. */
function moneyAxis(
  values: number[],
  currency: string,
  labels: ReturnType<typeof useAmounts>['axisMoney'],
) {
  const { ticks } = niceTicks(Math.min(...values), Math.max(...values))
  return {
    ...axisProps,
    ticks,
    domain: [ticks[0], ticks.at(-1)!],
    tickFormatter: labels(ticks, currency),
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

type EquityRow = { t: number; date: string; equity: number; start?: boolean; live?: boolean }

const HALF_DAY = 43_200_000

export function EquityChart({
  points,
  startingBalance,
  currency,
  now,
}: {
  points: EquityPoint[]
  startingBalance: number
  currency: string
  /** Account value with open trades at current prices, drawn as a last point */
  now?: number
}) {
  const gradientId = `equity-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const amounts = useAmounts()
  const days = dailyEquity(points)
  if (days.length === 0) return null

  // Start the line at the starting balance the day before the first close
  const startDate = addDays(days[0].date, -1)
  const data: EquityRow[] = [
    { t: parseIsoDate(startDate).getTime(), date: startDate, equity: startingBalance, start: true },
    ...days.map((d) => ({ ...d, t: parseIsoDate(d.date).getTime() })),
  ]
  if (now !== undefined) {
    // A trade closed today already sits on today, so this point goes just after it
    const t = Math.max(parseIsoDate(today()).getTime(), data.at(-1)!.t + HALF_DAY)
    data.push({ t, date: today(), equity: now, live: true })
  }
  const first = data[0]
  const last = data.at(-1)!
  const color = last.equity >= startingBalance ? GAIN : LOSS
  const yAxis = moneyAxis(
    data.map((d) => d.equity),
    currency,
    amounts.axisMoney,
  )

  return (
    <figure
      aria-label={`Equity from ${amounts.money(startingBalance, currency)} to ${amounts.money(last.equity, currency)}`}
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
                <p className="text-muted">
                  {row.start
                    ? 'Start'
                    : row.live
                      ? 'Now, with open trades'
                      : formatDateRange(row.date)}
                </p>
                <p className="font-semibold">{amounts.money(row.equity, currency)}</p>
                {!row.start && (
                  <p className={pnlColor(change)}>{amounts.signedMoney(change, currency)}</p>
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
        {last.live && <ReferenceDot x={last.t} y={last.equity} r={3} fill={color} stroke="none" />}
      </AreaChart>
    </figure>
  )
}

export function MonthlyPnlChart({ months, currency }: { months: PeriodPnl[]; currency: string }) {
  const amounts = useAmounts()
  if (months.length === 0) return null
  const withYear = months[0].month.slice(0, 4) !== months.at(-1)!.month.slice(0, 4)
  // Always include zero so bars grow from the axis line
  const yAxis = moneyAxis([0, ...months.map((m) => m.pnl)], currency, amounts.axisMoney)

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
                  {amounts.signedMoney(row.pnl, currency)}
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

/** Rows shown before "Show all" */
const BREAKDOWN_LIMIT = 8

/** One row per group with a bar scaled to the largest absolute P&L. A blank key is "none". */
export function PnlBreakdown({
  rows,
  currency,
}: {
  rows: (PnlRow & { label: string })[]
  currency: string
}) {
  const amounts = useAmounts()
  const [showAll, setShowAll] = useState(false)
  const max = Math.max(...rows.map((r) => Math.abs(r.pnl)), 0)
  const shown = showAll ? rows : rows.slice(0, BREAKDOWN_LIMIT)
  return (
    <ul className="space-y-3">
      {shown.map((r) => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-3">
            <span className={`min-w-0 truncate ${r.key ? '' : 'text-muted italic'}`}>
              {r.label}
            </span>
            <span className={`shrink-0 font-semibold tabular-nums ${pnlColor(r.pnl)}`}>
              {amounts.signedMoney(r.pnl, currency)}
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
      {shown.length < rows.length && (
        <li>
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="w-full rounded-lg py-2 text-sm font-medium text-accent"
          >
            Show all {rows.length}
          </button>
        </li>
      )}
    </ul>
  )
}
