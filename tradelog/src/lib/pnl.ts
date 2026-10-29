import type { Trade } from '../db/schema.ts'

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

export type StrategyPnl = {
  /** Blank for trades without a strategy */
  strategy: string
  pnl: number
  count: number
  wins: number
}

/** Realized P&L per strategy, best first. */
export function pnlByStrategy(trades: Trade[]): StrategyPnl[] {
  const totals = new Map<string, StrategyPnl>()
  for (const t of closedByExit(trades)) {
    const row = totals.get(t.strategy) ?? { strategy: t.strategy, pnl: 0, count: 0, wins: 0 }
    row.pnl += t.pnl
    row.count++
    if (t.pnl >= BREAKEVEN) row.wins++
    totals.set(t.strategy, row)
  }
  return [...totals.values()].sort(
    (a, b) => b.pnl - a.pnl || b.count - a.count || a.strategy.localeCompare(b.strategy),
  )
}
