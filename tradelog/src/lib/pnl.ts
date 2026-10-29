import type { Trade } from '../db/schema.ts'

type PnlFields = Pick<Trade, 'side' | 'quantity' | 'entryPrice' | 'exitPrice' | 'fees'>

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
