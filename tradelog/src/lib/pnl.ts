import type { StatsRange, Trade } from '../db/schema.ts'
import { addDays, daysBetween, parseIsoDate } from './dates.ts'

type PnlFields = Pick<Trade, 'side' | 'quantity' | 'entryPrice' | 'exitPrice' | 'fees'>

/** P&L within half a cent of zero is break-even: it shows as 0.00 anyway. */
export const BREAKEVEN = 0.005

export function isClosed<T extends Pick<Trade, 'exitPrice'>>(
  trade: T,
): trade is T & { exitPrice: number } {
  return trade.exitPrice !== null
}

/**
 * Realized P&L after fees, or null while the trade is open.
 * Long: (exit − entry) × qty − fees. Short: (entry − exit) × qty − fees.
 */
export function tradePnl(trade: PnlFields): number | null {
  if (!isClosed(trade)) return null
  const perUnit =
    trade.side === 'long' ? trade.exitPrice - trade.entryPrice : trade.entryPrice - trade.exitPrice
  return perUnit * trade.quantity - trade.fees
}

/** P&L as a percentage of the capital put in (entry × qty), or null while open. */
export function returnPct(trade: PnlFields): number | null {
  const pnl = tradePnl(trade)
  const cost = trade.entryPrice * trade.quantity
  if (pnl === null || cost === 0) return null
  return (pnl / cost) * 100
}

type ClosedTrade = Trade & { exitPrice: number; pnl: number }

/** Closed trades with their P&L, oldest exit first (ties: entry date, then when logged). */
function closedByExit(trades: Trade[]): ClosedTrade[] {
  const closed: ClosedTrade[] = []
  for (const t of trades) {
    const pnl = tradePnl(t)
    if (pnl !== null && isClosed(t)) closed.push({ ...t, pnl })
  }
  return closed.sort(
    (a, b) =>
      exitDay(a).localeCompare(exitDay(b)) ||
      a.entryDate.localeCompare(b.entryDate) ||
      a.createdAt - b.createdAt,
  )
}

// Validation always pairs exit price with exit date; entry date is a safe fallback
const exitDay = (t: Trade) => t.exitDate ?? t.entryDate

export type TradeStats = {
  closedCount: number
  openCount: number
  wins: number
  losses: number
  breakeven: number
  /** Realized P&L of closed trades, after fees */
  totalPnl: number
  /** Sum of winning trades (≥ 0) */
  grossProfit: number
  /** Sum of losing trades (≤ 0) */
  grossLoss: number
  totalFees: number
  /** 0–1: wins ÷ closed trades; null with no closed trades */
  winRate: number | null
  /** Positive; null with no wins */
  avgWin: number | null
  /** Negative; null with no losses */
  avgLoss: number | null
  /** Average P&L per closed trade (expectancy); null with no closed trades */
  avgTrade: number | null
  /** Gross profit ÷ |gross loss|; Infinity with wins but no losses; null with neither */
  profitFactor: number | null
  largestWin: number | null
  largestLoss: number | null
}

/** Headline numbers for the Stats screen. Open trades only count towards openCount. */
export function tradeStats(trades: Trade[]): TradeStats {
  const closed = closedByExit(trades)
  let wins = 0
  let losses = 0
  let grossProfit = 0
  let grossLoss = 0
  let totalFees = 0
  let largestWin: number | null = null
  let largestLoss: number | null = null

  for (const { pnl, fees } of closed) {
    totalFees += fees
    if (pnl >= BREAKEVEN) {
      wins++
      grossProfit += pnl
      largestWin = Math.max(largestWin ?? pnl, pnl)
    } else if (pnl <= -BREAKEVEN) {
      losses++
      grossLoss += pnl
      largestLoss = Math.min(largestLoss ?? pnl, pnl)
    }
  }

  const closedCount = closed.length
  const totalPnl = closed.reduce((sum, t) => sum + t.pnl, 0)
  return {
    closedCount,
    openCount: trades.length - closedCount,
    wins,
    losses,
    breakeven: closedCount - wins - losses,
    totalPnl,
    grossProfit,
    grossLoss,
    totalFees,
    winRate: closedCount ? wins / closedCount : null,
    avgWin: wins ? grossProfit / wins : null,
    avgLoss: losses ? grossLoss / losses : null,
    avgTrade: closedCount ? totalPnl / closedCount : null,
    profitFactor: losses ? grossProfit / -grossLoss : wins ? Infinity : null,
    largestWin,
    largestLoss,
  }
}

export type EquityPoint = {
  /** YYYY-MM-DD the trade closed */
  date: string
  /** Account value after this trade */
  equity: number
  /** This trade's P&L */
  pnl: number
  tradeId: string
}

/** Starting balance plus the running sum of P&L, one point per closed trade in exit order. */
export function equityCurve(trades: Trade[], startingBalance: number): EquityPoint[] {
  let equity = startingBalance
  return closedByExit(trades).map((t) => {
    equity += t.pnl
    return { date: exitDay(t), equity, pnl: t.pnl, tradeId: t.id }
  })
}

/** End-of-day equity, one point per day with a closed trade. */
export function dailyEquity(points: EquityPoint[]): { date: string; equity: number }[] {
  const days: { date: string; equity: number }[] = []
  for (const { date, equity } of points) {
    const last = days.at(-1)
    if (last?.date === date) last.equity = equity
    else days.push({ date, equity })
  }
  return days
}

/** First day a Stats range covers, or null for all time. */
export function rangeStart(range: StatsRange, today: string): string | null {
  switch (range) {
    case '30d':
      return addDays(today, -29)
    case '90d':
      return addDays(today, -89)
    case 'ytd':
      return `${today.slice(0, 4)}-01-01`
    case '1y':
      return addDays(today, -364)
    case 'all':
      return null
  }
}

/** Trades closed on or after `from`, plus every open trade. */
export function closedSince(trades: Trade[], from: string | null): Trade[] {
  if (from === null) return trades
  return trades.filter((t) => !isClosed(t) || exitDay(t) >= from)
}

/**
 * The part of an equity curve from `from` on, and the equity it starts at:
 * what everything before that date had already built up to.
 */
export function equitySince(
  points: EquityPoint[],
  start: number,
  from: string | null,
): { points: EquityPoint[]; start: number } {
  if (from === null) return { points, start }
  const first = points.findIndex((p) => p.date >= from)
  if (first === -1) return { points: [], start: points.at(-1)?.equity ?? start }
  return { points: points.slice(first), start: first > 0 ? points[first - 1].equity : start }
}

export type Drawdown = {
  /** Largest fall from a peak, as a negative amount; 0 if equity never fell */
  amount: number
  /** That fall as a percentage of the peak; null when the peak wasn't above zero */
  pct: number | null
  /** Null when the peak was the curve's starting value */
  peakDate: string | null
  troughDate: string | null
}

/** Largest peak-to-trough fall in end-of-day realized equity. */
export function maxDrawdown(points: EquityPoint[], start: number): Drawdown {
  let peak = start
  let peakDate: string | null = null
  let worst: Drawdown = { amount: 0, pct: null, peakDate: null, troughDate: null }
  for (const { date, equity } of dailyEquity(points)) {
    if (equity > peak) {
      peak = equity
      peakDate = date
    } else if (equity - peak < worst.amount) {
      const amount = equity - peak
      worst = { amount, pct: peak > 0 ? (amount / peak) * 100 : null, peakDate, troughDate: date }
    }
  }
  return worst
}

export type Streaks = {
  longestWin: number
  longestLoss: number
  /** Positive for wins in a row, negative for losses, 0 with neither */
  current: number
}

/** Runs of wins and losses in exit order. Break-even trades don't end a run. */
export function streaks(trades: Trade[]): Streaks {
  let longestWin = 0
  let longestLoss = 0
  let current = 0
  for (const { pnl } of closedByExit(trades)) {
    if (pnl >= BREAKEVEN) {
      current = current > 0 ? current + 1 : 1
      longestWin = Math.max(longestWin, current)
    } else if (pnl <= -BREAKEVEN) {
      current = current < 0 ? current - 1 : -1
      longestLoss = Math.max(longestLoss, -current)
    }
  }
  return { longestWin, longestLoss, current }
}

export type Holding = {
  /** Average calendar days from entry to exit; null with no such trades */
  all: number | null
  wins: number | null
  losses: number | null
}

const mean = (values: number[]) =>
  values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null

/** How long closed trades were held, overall and for winners and losers apart. */
export function holdingDays(trades: Trade[]): Holding {
  const closed = closedByExit(trades).map((t) => ({
    pnl: t.pnl,
    days: daysBetween(t.entryDate, exitDay(t)),
  }))
  return {
    all: mean(closed.map((t) => t.days)),
    wins: mean(closed.filter((t) => t.pnl >= BREAKEVEN).map((t) => t.days)),
    losses: mean(closed.filter((t) => t.pnl <= -BREAKEVEN).map((t) => t.days)),
  }
}

export type PeriodPnl = {
  /** YYYY-MM */
  month: string
  pnl: number
  count: number
}

function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

/**
 * Realized P&L per calendar month of the exit date, oldest first. Months
 * without closed trades between the first and last are filled with zero.
 */
export function pnlByMonth(trades: Trade[]): PeriodPnl[] {
  const totals = new Map<string, PeriodPnl>()
  for (const t of closedByExit(trades)) {
    const month = exitDay(t).slice(0, 7)
    const row = totals.get(month) ?? { month, pnl: 0, count: 0 }
    row.pnl += t.pnl
    row.count++
    totals.set(month, row)
  }
  const months = [...totals.keys()]
  if (months.length === 0) return []
  const last = months.at(-1)!
  const filled: PeriodPnl[] = []
  for (let m = months[0]; m <= last; m = nextMonth(m)) {
    filled.push(totals.get(m) ?? { month: m, pnl: 0, count: 0 })
  }
  return filled
}

export type PnlRow = {
  /** What the row groups by; blank for trades without a strategy or tag */
  key: string
  pnl: number
  count: number
  wins: number
}

/** Totals closed trades under each key they belong to. */
function pnlBy(trades: Trade[], keysOf: (t: ClosedTrade) => string[]): PnlRow[] {
  const totals = new Map<string, PnlRow>()
  for (const t of closedByExit(trades)) {
    for (const key of keysOf(t)) {
      const row = totals.get(key) ?? { key, pnl: 0, count: 0, wins: 0 }
      row.pnl += t.pnl
      row.count++
      if (t.pnl >= BREAKEVEN) row.wins++
      totals.set(key, row)
    }
  }
  return [...totals.values()]
}

const bestFirst = (a: PnlRow, b: PnlRow) =>
  b.pnl - a.pnl || b.count - a.count || a.key.localeCompare(b.key)

/** Realized P&L per strategy, best first. */
export function pnlByStrategy(trades: Trade[]): PnlRow[] {
  return pnlBy(trades, (t) => [t.strategy]).sort(bestFirst)
}

/** Realized P&L per symbol, biggest gain or loss first, so a short list shows both ends. */
export function pnlBySymbol(trades: Trade[]): PnlRow[] {
  return pnlBy(trades, (t) => [t.symbol]).sort(
    (a, b) => Math.abs(b.pnl) - Math.abs(a.pnl) || bestFirst(a, b),
  )
}

/** Realized P&L per tag, best first. A trade with several tags counts under each. */
export function pnlByTag(trades: Trade[]): PnlRow[] {
  return pnlBy(trades, (t) => (t.tags.length ? t.tags : [''])).sort(bestFirst)
}

/** Realized P&L for longs and shorts, best first. */
export function pnlBySide(trades: Trade[]): PnlRow[] {
  return pnlBy(trades, (t) => [t.side]).sort(bestFirst)
}

/** Realized P&L per weekday of the exit, Monday first. Keys are Date.getDay() values. */
export function pnlByWeekday(trades: Trade[]): PnlRow[] {
  const mondayFirst = (row: PnlRow) => (Number(row.key) + 6) % 7
  return pnlBy(trades, (t) => [String(parseIsoDate(exitDay(t)).getDay())]).sort(
    (a, b) => mondayFirst(a) - mondayFirst(b),
  )
}

/**
 * What an open trade would make if it closed at `price`, after the fees
 * logged so far. Same formula as realized P&L.
 */
export function unrealizedPnl(trade: Omit<PnlFields, 'exitPrice'>, price: number): number {
  return tradePnl({ ...trade, exitPrice: price })!
}

/** Unrealized P&L as a percentage of the capital put in, or null for zero cost. */
export function unrealizedReturnPct(
  trade: Omit<PnlFields, 'exitPrice'>,
  price: number,
): number | null {
  return returnPct({ ...trade, exitPrice: price })
}

export type OpenPositions = {
  /** Open trades */
  count: number
  /** Open trades with a known price */
  priced: number
  /** Unrealized P&L of the priced trades */
  unrealizedPnl: number
  /** Entry × quantity of the priced trades */
  costBasis: number
}

/** Totals over open trades, using a price per symbol where one is known. */
export function openPositions(trades: Trade[], prices: ReadonlyMap<string, number>): OpenPositions {
  const summary: OpenPositions = { count: 0, priced: 0, unrealizedPnl: 0, costBasis: 0 }
  for (const t of trades) {
    if (isClosed(t)) continue
    summary.count++
    const price = prices.get(t.symbol)
    if (price === undefined) continue
    summary.priced++
    summary.unrealizedPnl += unrealizedPnl(t, price)
    summary.costBasis += t.entryPrice * t.quantity
  }
  return summary
}
