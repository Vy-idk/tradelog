import type { CashBalance, Settings, Trade } from '../db/schema.ts'
import { isClosed, openPositions, tradePnl } from './pnl.ts'

/** Trades are US-listed stocks and ETFs, so their prices and P&L are in dollars. */
export const TRADE_CURRENCY = 'USD'

/** Free ECB reference rates, no key needed, CORS enabled. */
export const FX_RATES_URL = 'https://api.frankfurter.dev/v1/latest?base=USD'

/** Rates are reused this long before asking again; the ECB publishes once a day. */
export const FX_TTL = 6 * 3_600_000

/** The currencies the ECB publishes a rate for, used until a fetch says otherwise. */
export const FX_CURRENCIES = [
  'USD',
  'AUD',
  'BRL',
  'CAD',
  'CHF',
  'CNY',
  'CZK',
  'DKK',
  'EUR',
  'GBP',
  'HKD',
  'HUF',
  'IDR',
  'ILS',
  'INR',
  'ISK',
  'JPY',
  'KRW',
  'MXN',
  'MYR',
  'NOK',
  'NZD',
  'PHP',
  'PLN',
  'RON',
  'SEK',
  'SGD',
  'THB',
  'TRY',
  'ZAR',
]

/** Units of each currency per 1 USD, e.g. { USD: 1, ILS: 3.12 } */
export type FxRates = {
  base: 'USD'
  rates: Record<string, number>
  /** YYYY-MM-DD the ECB set these rates */
  date: string
  /** When TradeLog fetched them (ms) */
  fetchedAt: number
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

/** Reads Frankfurter's { base, date, rates } answer; null if it isn't one. */
export function parseFxRates(body: unknown, fetchedAt: number): FxRates | null {
  if (typeof body !== 'object' || body === null) return null
  const { base, date, rates } = body as Record<string, unknown>
  if (base !== 'USD' || typeof date !== 'string' || typeof rates !== 'object' || rates === null)
    return null
  const clean: Record<string, number> = { USD: 1 }
  for (const [code, rate] of Object.entries(rates)) {
    if (/^[A-Z]{3}$/.test(code) && finite(rate)) clean[code] = rate
  }
  if (Object.keys(clean).length < 2) return null
  return { base: 'USD', rates: clean, date, fetchedAt }
}

/** Converts an amount between currencies, or null when a rate is missing. */
export function convert(
  amount: number,
  from: string,
  to: string,
  rates: FxRates | null | undefined,
): number | null {
  if (from === to) return amount
  const fromRate = from === 'USD' ? 1 : rates?.rates[from]
  const toRate = to === 'USD' ? 1 : rates?.rates[to]
  if (!fromRate || !toRate) return null
  return (amount / fromRate) * toRate
}

/** Trades with prices and fees in another currency, so every P&L comes out converted. */
export function tradesIn(trades: Trade[], rate: number): Trade[] {
  if (rate === 1) return trades
  return trades.map((t) => ({
    ...t,
    entryPrice: t.entryPrice * rate,
    exitPrice: t.exitPrice === null ? null : t.exitPrice * rate,
    fees: t.fees * rate,
  }))
}

/** Every currency the account settings use, trades' dollars first. */
export function accountCurrencies(
  settings: Pick<
    Settings,
    'currency' | 'balanceMode' | 'startingBalanceCurrency' | 'startingBalance' | 'cashBalances'
  >,
): string[] {
  const used = [TRADE_CURRENCY, settings.currency]
  if (settings.balanceMode === 'current') used.push(...settings.cashBalances.map((c) => c.currency))
  else if (settings.startingBalance > 0) used.push(settings.startingBalanceCurrency)
  return [...new Set(used)]
}

/** Total of several balances in one currency, or null when a rate is missing. */
export function sumBalances(
  balances: Pick<CashBalance, 'amount' | 'currency'>[],
  currency: string,
  rates: FxRates | null | undefined,
): number | null {
  let total = 0
  for (const b of balances) {
    const value = convert(b.amount, b.currency, currency, rates)
    if (value === null) return null
    total += value
  }
  return total
}

/**
 * Open trades at cost in dollars: longs add what was paid, shorts subtract
 * what is owed back. Added to cash, it's the account value before
 * unrealized P&L.
 */
export function openCost(trades: Trade[]): number {
  let total = 0
  for (const t of trades) {
    if (isClosed(t)) continue
    total += (t.side === 'long' ? 1 : -1) * t.entryPrice * t.quantity
  }
  return total
}

/** Realized P&L of every closed trade, in dollars. */
export function realizedPnl(trades: Trade[]): number {
  return trades.reduce((sum, t) => sum + (tradePnl(t) ?? 0), 0)
}

export type StartingEquity =
  | { ok: true; value: number }
  /** A balance's currency has no rate yet */
  | { ok: false; missing: string }

/**
 * Where the equity curve starts, in `currency`. With a starting balance,
 * that balance. With current cash, works backwards: cash today plus open
 * trades at cost, minus everything realized since the first trade.
 */
export function startingEquity(
  settings: Pick<
    Settings,
    'balanceMode' | 'startingBalance' | 'startingBalanceCurrency' | 'cashBalances'
  >,
  trades: Trade[],
  currency: string,
  rates: FxRates | null | undefined,
): StartingEquity {
  if (settings.balanceMode === 'starting') {
    // Zero is zero in any currency, so it needs no exchange rate
    if (settings.startingBalance === 0) return { ok: true, value: 0 }
    const value = convert(
      settings.startingBalance,
      settings.startingBalanceCurrency,
      currency,
      rates,
    )
    return value === null
      ? { ok: false, missing: settings.startingBalanceCurrency }
      : { ok: true, value }
  }
  // No cash entered yet works like no starting balance: the curve starts at zero
  if (settings.cashBalances.length === 0) return { ok: true, value: 0 }
  for (const c of settings.cashBalances) {
    if (convert(1, c.currency, currency, rates) === null) return { ok: false, missing: c.currency }
  }
  const cash = sumBalances(settings.cashBalances, currency, rates)!
  const fromTrades = convert(
    openCost(trades) - realizedPnl(trades),
    TRADE_CURRENCY,
    currency,
    rates,
  )
  if (fromTrades === null) return { ok: false, missing: currency }
  return { ok: true, value: cash + fromTrades }
}

export type AccountValue = {
  /** What the account is worth now, in the requested currency */
  value: number
  /** Cash today; null when the account is tracked from a starting balance */
  cash: number | null
  /** Open trades at current prices; shorts count against the account */
  positions: number
  /** Realized P&L of every closed trade */
  realized: number
  /** Unrealized P&L of the open trades that have a price, after fees */
  unrealized: number
  /** Open trades */
  open: number
  /** Open trades with a known price; the rest count at cost */
  priced: number
}

/**
 * The account as it stands now. From cash today: that cash plus open trades
 * at current prices. From a starting balance: that balance plus everything
 * realized and unrealized since. Null when an exchange rate is missing.
 */
export function accountValue(
  settings: Pick<
    Settings,
    'balanceMode' | 'startingBalance' | 'startingBalanceCurrency' | 'cashBalances'
  >,
  trades: Trade[],
  prices: ReadonlyMap<string, number>,
  currency: string,
  rates: FxRates | null | undefined,
): AccountValue | null {
  const rate = convert(1, TRADE_CURRENCY, currency, rates)
  if (rate === null) return null

  let inDollars = 0
  for (const t of trades) {
    if (isClosed(t)) continue
    const price = prices.get(t.symbol) ?? t.entryPrice
    inDollars += (t.side === 'long' ? 1 : -1) * price * t.quantity
  }
  const open = openPositions(trades, prices)
  const totals = {
    positions: inDollars * rate,
    realized: realizedPnl(trades) * rate,
    unrealized: open.unrealizedPnl * rate,
    open: open.count,
    priced: open.priced,
  }

  if (settings.balanceMode === 'current' && settings.cashBalances.length > 0) {
    const cash = sumBalances(settings.cashBalances, currency, rates)
    if (cash === null) return null
    return { ...totals, value: cash + totals.positions, cash }
  }
  const start = startingEquity(settings, trades, currency, rates)
  if (!start.ok) return null
  return { ...totals, value: start.value + totals.realized + totals.unrealized, cash: null }
}
