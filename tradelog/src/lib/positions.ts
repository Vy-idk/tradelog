import type { Side, Trade } from '../db/schema.ts'
import { unrealizedPnl } from './pnl.ts'

/** Shares and fees keep 8 decimals, which clears floating-point dust from sums. */
const clean = (value: number) => Number(value.toFixed(8))

/** All the open trades in one symbol and direction. */
export type Position = {
  /** Unique per symbol and side: a long and a short in one symbol stay apart */
  key: string
  symbol: string
  side: Side
  /** Total shares */
  quantity: number
  /** Average entry price, weighted by shares */
  avgEntry: number
  /** Entry × quantity over all lots */
  costBasis: number
  /** The open trades that make it up, in the order given */
  lots: Trade[]
  /** After fees, or null without a price */
  unrealizedPnl: number | null
  /** On the capital put in, or null without a price */
  returnPct: number | null
}

/** Groups open trades into positions, in the order each first appears. */
export function groupPositions(
  openTrades: Trade[],
  prices: ReadonlyMap<string, number>,
): Position[] {
  const groups = new Map<string, Trade[]>()
  for (const t of openTrades) {
    const key = `${t.symbol}:${t.side}`
    const lots = groups.get(key)
    if (lots) lots.push(t)
    else groups.set(key, [t])
  }

  return [...groups].map(([key, lots]) => {
    const { symbol, side } = lots[0]
    const quantity = lots.reduce((sum, t) => sum + t.quantity, 0)
    const costBasis = lots.reduce((sum, t) => sum + t.entryPrice * t.quantity, 0)
    const price = prices.get(symbol)
    const pnl =
      price === undefined ? null : lots.reduce((sum, t) => sum + unrealizedPnl(t, price), 0)
    return {
      key,
      symbol,
      side,
      quantity: clean(quantity),
      avgEntry: costBasis / quantity,
      costBasis,
      lots,
      unrealizedPnl: pnl,
      returnPct: pnl === null ? null : (pnl / costBasis) * 100,
    }
  })
}

/**
 * The fees that belong to `part` of `whole` shares, to the cent. Trades hold
 * one fee total, so a partial close shares it out by shares.
 */
export function feeShare(fees: number, part: number, whole: number): number {
  return Math.round(((fees * part) / whole) * 100) / 100
}

/** Shares left after closing some; 0 means the whole trade closes, even from a tiny rest. */
export function sharesLeft(held: number, closing: number): number {
  return Math.max(0, clean(held - closing))
}

export type PartialClose = {
  /** Shares closed */
  quantity: number
  exitPrice: number
  exitDate: string
  /** For the closed shares, including the exit */
  fees: number
}

/**
 * Splits an open trade: a new closed trade for the shares sold, and the same
 * trade with the rest still open and its share of the fees so far. Strategy,
 * tags, notes and dates carry over to both.
 */
export function splitTrade(
  trade: Trade,
  close: PartialClose,
  newId: string,
  now: number,
): { closed: Trade; open: Trade } {
  return {
    closed: { ...trade, ...close, id: newId, partOf: trade.id, updatedAt: now },
    open: {
      ...trade,
      quantity: sharesLeft(trade.quantity, close.quantity),
      fees: Math.max(0, clean(trade.fees - feeShare(trade.fees, close.quantity, trade.quantity))),
      updatedAt: now,
    },
  }
}
