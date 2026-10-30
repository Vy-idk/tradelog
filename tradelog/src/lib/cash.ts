import type { CashBalance, Settings, Trade } from '../db/schema.ts'
import { formatPrice } from './format.ts'
import { convert, TRADE_CURRENCY, type FxRates } from './fx.ts'
import { BREAKEVEN, isClosed, tradePnl } from './pnl.ts'
import { sharesLeft, splitTrade, type PartialClose } from './positions.ts'

/** Cash keeps 8 decimals, which clears floating-point dust without moving a cent. */
const clean = (value: number) => Number(value.toFixed(8)) + 0

type TradeNumbers = Pick<Trade, 'side' | 'quantity' | 'entryPrice' | 'exitPrice' | 'fees'>

/** With no balances entered yet there is nothing to keep up to date. */
export function tracksCash(settings: Pick<Settings, 'balanceMode' | 'cashBalances'>): boolean {
  return settings.balanceMode === 'current' && settings.cashBalances.length > 0
}

/**
 * What a trade has done to cash, in dollars. Open long: paid its cost and
 * fees. Open short: received its proceeds, less fees. Closed: its realized P&L.
 */
export function tradeCash(trade: TradeNumbers): number {
  const pnl = tradePnl(trade)
  if (pnl !== null) return pnl
  return (trade.side === 'long' ? -1 : 1) * trade.entryPrice * trade.quantity - trade.fees
}

/** What closing brings in or pays out: the exit value less the fees. */
function exitCash(trade: TradeNumbers & { exitPrice: number }): number {
  return (trade.side === 'long' ? 1 : -1) * trade.exitPrice * trade.quantity - trade.fees
}

/** Sets or removes a trade's record of the cash it moved. */
export function withCashMoved<T extends Trade>(trade: T, moved: number | undefined): T {
  const copy = { ...trade }
  if (moved === undefined) delete copy.cashMoved
  else copy.cashMoved = moved
  return copy
}

export type CashChange = {
  /** Dollars to add to cash; negative takes them out */
  delta: number
  /** The trade's cashMoved after this change; undefined leaves it unrecorded */
  moved: number | undefined
}

/**
 * What adding (old = null) or editing a trade does to cash.
 *
 * A trade without cashMoved predates cash tracking, or was logged while it was
 * off: the cash the user typed already reflects it and may even be right where
 * the trade has a typo, so edits leave cash alone. Closing it moves cash,
 * because that money really arrives now, and reopening one takes its sale back
 * out, or the shares and their proceeds would both count. From then on it has
 * a record.
 *
 * While cash is off nothing moves, and a record only survives an edit that
 * leaves the trade's money alone, such as a note.
 */
export function planSave(old: Trade | null, next: TradeNumbers, tracking: boolean): CashChange {
  if (!tracking) {
    const same = old !== null && tradeCash(next) === tradeCash(old)
    return { delta: 0, moved: same ? old.cashMoved : undefined }
  }
  if (old === null) {
    const delta = clean(tradeCash(next))
    return { delta, moved: delta }
  }
  if (old.cashMoved !== undefined) {
    const delta = clean(tradeCash(next) - tradeCash(old))
    return { delta, moved: clean(old.cashMoved + delta) }
  }
  if (!isClosed(old) && isClosed(next)) {
    const delta = clean(exitCash(next))
    return { delta, moved: delta }
  }
  if (isClosed(old) && !isClosed(next)) {
    const delta = clean(tradeCash(next) - tradeCash(old))
    return { delta, moved: delta }
  }
  return { delta: 0, moved: undefined }
}

/** Deleting takes back what the app moved for the trade, and nothing the user typed. */
export function planDelete(trade: Pick<Trade, 'cashMoved'>, tracking: boolean): number {
  return tracking && trade.cashMoved !== undefined ? clean(-trade.cashMoved) : 0
}

export type PlannedClose = {
  /** The closed trade, or closed part */
  closed: Trade
  /** What stays open after a partial close */
  open: Trade | null
  delta: number
}

/** Closes all or part of an open trade and works out the cash that moves. */
export function planClose(
  trade: Trade,
  close: PartialClose,
  tracking: boolean,
  newId: string,
  now: number,
): PlannedClose {
  if (sharesLeft(trade.quantity, close.quantity) === 0) {
    const { exitPrice, exitDate, fees } = close
    const next = { ...trade, exitPrice, exitDate, fees, updatedAt: now }
    const { delta, moved } = planSave(trade, next, tracking)
    return { closed: withCashMoved(next, moved), open: null, delta }
  }

  const { closed, open } = splitTrade(trade, close, newId, now)
  if (!tracking) {
    return {
      closed: withCashMoved(closed, undefined),
      open: withCashMoved(open, undefined),
      delta: 0,
    }
  }
  if (trade.cashMoved === undefined) {
    const delta = clean(exitCash({ ...closed, exitPrice: close.exitPrice }))
    return { closed: withCashMoved(closed, delta), open, delta }
  }
  // The closed part's record is what it did to cash; the open part keeps the
  // rest, so deleting both still takes back exactly what was moved
  const delta = clean(tradeCash(closed) + tradeCash(open) - tradeCash(trade))
  return {
    closed: withCashMoved(closed, clean(tradeCash(closed))),
    open: withCashMoved(open, clean(trade.cashMoved - tradeCash(trade) + tradeCash(open))),
    delta,
  }
}

export type Conversion = {
  currency: string
  /** Taken from the balance, in its currency */
  amount: number
  /** What that bought */
  dollars: number
  /** Units of the currency per dollar */
  rate: number
}

export type CashMove = {
  balances: CashBalance[]
  /** Dollars added; negative was taken out */
  amount: number
  converted: Conversion[]
  /** Dollars no balance could cover; they sit in the dollar balance as a negative */
  short: number
  /** Currencies that couldn't be used because they have no rate */
  noRate: string[]
}

/**
 * Adds to or takes from the balances. Money comes in as dollars. Money goes
 * out of dollars first, then other balances in list order at the saved rates.
 * Whatever is left goes on the dollar balance as a negative, so a trade is
 * never refused and the shortfall stays visible, and cash still adds up.
 */
export function moveCash(
  balances: CashBalance[],
  amount: number,
  rates: FxRates | null | undefined,
  makeId: () => string,
): CashMove {
  const next = balances.map((b) => ({ ...b }))
  const converted: Conversion[] = []
  const noRate: string[] = []
  let owed = clean(-amount)

  if (owed > 0) {
    for (const b of next) {
      if (b.currency !== TRADE_CURRENCY || b.amount <= 0 || owed === 0) continue
      const take = Math.min(b.amount, owed)
      b.amount = clean(b.amount - take)
      owed = clean(owed - take)
    }
    for (const b of next) {
      if (b.currency === TRADE_CURRENCY || b.amount <= 0 || owed === 0) continue
      const rate = convert(1, TRADE_CURRENCY, b.currency, rates)
      if (rate === null) {
        if (!noRate.includes(b.currency)) noRate.push(b.currency)
        continue
      }
      // Whole cents, like a real conversion; rounding can't leave anything owed
      const needed = owed * rate
      const take = Math.min(b.amount, Math.round(needed * 100) / 100)
      const dollars = needed - take > 0.005 ? take / rate : owed
      b.amount = clean(b.amount - take)
      owed = clean(owed - dollars)
      if (take > 0) converted.push({ currency: b.currency, amount: take, dollars, rate })
    }
  }

  // Money in, or what's left over, lands on the first dollar balance
  const landing = owed > 0 ? -owed : Math.max(clean(amount), 0)
  if (landing !== 0) {
    const dollars = next.find((b) => b.currency === TRADE_CURRENCY)
    if (dollars) dollars.amount = clean(dollars.amount + landing)
    else next.push({ id: makeId(), label: '', amount: landing, currency: TRADE_CURRENCY })
  }
  return { balances: next, amount, converted, short: Math.max(owed, 0), noRate }
}

/** True when a move did more than the plain add or subtract the user expects. */
export function worthTelling(move: CashMove): boolean {
  return move.converted.length > 0 || move.short >= BREAKEVEN
}

type Money = (value: number, currency: string) => string

/**
 * Plain sentences about a move: conversions, then anything short. `done` picks
 * the tense, so a preview says "Converts" and a result says "Converted".
 */
export function cashNotes(move: CashMove, money: Money, done: boolean): string[] {
  const notes = move.converted.map(
    (c) =>
      `${done ? 'Converted' : 'Converts'} ${money(c.amount, c.currency)} to ` +
      `${money(c.dollars, TRADE_CURRENCY)} at ${formatPrice(c.rate)}`,
  )
  if (move.short < BREAKEVEN) return notes
  if (move.noRate.length > 0) {
    const list = move.noRate.join(', ')
    notes.push(
      `No exchange rate for ${list} yet, so ${done ? "it wasn't" : "it can't be"} used. ` +
        'Rates load when you’re online.',
    )
  }
  notes.push(
    `${money(move.short, TRADE_CURRENCY)} short, so your dollar balance ` +
      `${done ? 'went' : 'goes'} negative.`,
  )
  return notes
}
