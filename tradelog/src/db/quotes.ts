import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useSyncExternalStore } from 'react'
import {
  createExtendedClient,
  livePrice,
  type ExtendedError,
  type ExtendedResult,
  type LivePrice,
} from '../lib/extended.ts'
import { sessionAt } from '../lib/market.ts'
import { createPriceClient, type QuoteError, type QuoteResult } from '../lib/prices.ts'
import { db, type ExtendedQuote, type Quote } from './schema.ts'

/** One client per source for the whole app, so caches and rate limits are shared. */
export const priceClient = createPriceClient()
export const extendedClient = createExtendedClient()

/** Where prices come from: Finnhub for the regular session, the relay for the rest. */
export type PriceSources = { apiKey: string; relayUrl: string }

/** Problems that hold back every price, not just one symbol. */
export type PriceProblem = 'invalid-key' | 'rate-limited'

export type PriceStatus = {
  /** True while any refresh is running */
  refreshing: boolean
  /** Each symbol's latest Finnhub failure, cleared by its next success */
  failures: Readonly<Record<string, QuoteError>>
  /** From the most recent Finnhub refresh */
  problem: PriceProblem | null
  /** Each symbol's latest relay failure, cleared by its next success */
  extendedFailures: Readonly<Record<string, ExtendedError>>
  /** Why pre-market and after-hours prices aren't coming through, if they aren't */
  extendedProblem: ExtendedError | null
  /** When a rate-limit back-off ends */
  retryAt: number | null
}

let status: PriceStatus = {
  refreshing: false,
  failures: {},
  problem: null,
  extendedFailures: {},
  extendedProblem: null,
  retryAt: null,
}
const listeners = new Set<() => void>()

function setStatus(change: Partial<PriceStatus>) {
  status = { ...status, ...change }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Refresh progress and errors, shared by every screen that shows prices. */
export function usePriceStatus(): PriceStatus {
  return useSyncExternalStore(subscribe, () => status)
}

// Symbols never contain commas, so a joined list is a stable dependency
const symbolKey = (symbols: string[]) => [...new Set(symbols)].sort().join(',')

/** Saved quotes for these symbols; undefined while loading. */
export function useQuotes(symbols: string[]): ReadonlyMap<string, Quote> | undefined {
  const key = symbolKey(symbols)
  return useLiveQuery(async () => {
    const rows = key ? await db.quotes.bulkGet(key.split(',')) : []
    return new Map(rows.filter((q) => q !== undefined).map((q) => [q.symbol, q]))
  }, [key])
}

/** Saved pre-market and after-hours trades for these symbols; undefined while loading. */
export function useExtendedQuotes(
  symbols: string[],
): ReadonlyMap<string, ExtendedQuote> | undefined {
  const key = symbolKey(symbols)
  return useLiveQuery(async () => {
    const rows = key ? await db.extendedQuotes.bulkGet(key.split(',')) : []
    return new Map(rows.filter((q) => q !== undefined).map((q) => [q.symbol, q]))
  }, [key])
}

export type LivePrices = {
  /** The price to show per symbol, from whichever source traded last */
  prices: ReadonlyMap<string, LivePrice>
  /** Finnhub's regular-session quotes, for the detail view */
  quotes: ReadonlyMap<string, Quote>
}

/** Live prices for these symbols; undefined while loading. */
export function useLivePrices(symbols: string[], now: number): LivePrices | undefined {
  const quotes = useQuotes(symbols)
  const extended = useExtendedQuotes(symbols)
  return useMemo(() => {
    if (!quotes || !extended) return undefined
    const prices = new Map<string, LivePrice>()
    for (const s of new Set([...quotes.keys(), ...extended.keys()])) {
      const live = livePrice(quotes.get(s), extended.get(s), now)
      if (live) prices.set(s, live)
    }
    return { prices, quotes }
  }, [quotes, extended, now])
}

/**
 * The failure to show for a symbol's price: the relay's when the price came
 * from it, Finnhub's otherwise. Offline, every price is out of date.
 */
export function priceFailure(
  live: LivePrice | undefined,
  symbol: string,
  status: PriceStatus,
  online: boolean,
): QuoteError | undefined {
  if (!online) return 'offline'
  if (live?.source === 'yahoo') {
    const failure = status.extendedFailures[symbol]
    // Both kinds of failure mean the same thing on screen: the price may be old
    return failure === 'bad-relay' ? 'failed' : failure
  }
  return status.failures[symbol]
}

// Quotes saved by an earlier visit go into the client's cache first, so a
// relaunch within a minute doesn't spend requests on prices it already has
let seeded: Promise<void> | null = null
function seedCache(): Promise<void> {
  seeded ??= db.quotes
    .toArray()
    .then((quotes) => priceClient.seed(quotes))
    .catch(() => {})
  return seeded
}

let running = 0

async function tracked<T>(work: () => Promise<T>): Promise<T> {
  running++
  setStatus({ refreshing: true })
  try {
    return await work()
  } finally {
    running--
    setStatus({
      refreshing: running > 0,
      retryAt: Math.max(priceClient.backoffUntil(), extendedClient.backoffUntil()) || null,
    })
  }
}

async function refreshFinnhub(
  symbols: string[],
  apiKey: string,
  options: { maxAge?: number },
): Promise<QuoteResult[]> {
  await seedCache()
  const results = await Promise.all(
    symbols.map(async (symbol) => {
      const result = await priceClient.getQuote(symbol, apiKey, options)
      if (result.ok && !result.fromCache) {
        // A failed write only loses the offline copy; the price still shows
        await db.quotes.put(result.quote).catch(() => {})
      }
      const failures = { ...status.failures }
      if (result.ok) delete failures[symbol]
      else failures[symbol] = result.error
      setStatus({ failures })
      return result
    }),
  )
  const errors = new Set(results.flatMap((r) => (r.ok ? [] : [r.error])))
  const problem = errors.has('invalid-key')
    ? 'invalid-key'
    : errors.has('rate-limited')
      ? 'rate-limited'
      : null
  setStatus({ problem })
  return results
}

async function refreshExtended(
  symbols: string[],
  relayUrl: string,
  options: { maxAge?: number },
): Promise<ExtendedResult> {
  const result = await extendedClient.getExtended(symbols, relayUrl, options)
  const failures = { ...status.extendedFailures }
  if (!result.ok) {
    for (const s of symbols) failures[s] = result.error
    setStatus({ extendedFailures: failures, extendedProblem: result.error })
    return result
  }
  await Promise.all(
    result.fetched.map(async (s) => {
      const quote = result.quotes.get(s)
      delete failures[s]
      try {
        // No extended trade now: drop the old one so the close shows instead
        if (quote) await db.extendedQuotes.put(quote)
        else await db.extendedQuotes.delete(s)
      } catch {
        // Only the offline copy is lost; the price still shows this session
      }
    }),
  )
  for (const [s, error] of result.failed) failures[s] = error
  setStatus({
    extendedFailures: failures,
    extendedProblem: result.failed.values().next().value ?? null,
  })
  return result
}

/**
 * Fetches prices older than maxAge (default 60 s) and saves each as it
 * arrives, so they fill in one by one: Finnhub quotes, plus pre-market and
 * after-hours trades through the relay whenever the regular session isn't
 * on. Never throws.
 */
export async function refreshQuotes(
  symbols: string[],
  { apiKey, relayUrl }: PriceSources,
  options: { maxAge?: number } = {},
): Promise<QuoteResult[]> {
  const unique = [...new Set(symbols)]
  const extended = Boolean(relayUrl) && sessionAt(Date.now()) !== 'regular'
  if (unique.length === 0 || (!apiKey && !extended)) return []

  return tracked(async () => {
    const [results] = await Promise.all([
      apiKey ? refreshFinnhub(unique, apiKey, options) : Promise.resolve([]),
      extended ? refreshExtended(unique, relayUrl, options) : Promise.resolve(null),
    ])
    return results
  })
}

/** A well-known symbol to check a key or the relay with. */
const TEST_SYMBOL = 'AAPL'

/** Asks Finnhub for one fresh quote to see whether a key works. */
export async function testApiKey(apiKey: string): Promise<QuoteResult> {
  priceClient.clearKeyError()
  const [result] = await tracked(() => refreshFinnhub([TEST_SYMBOL], apiKey, { maxAge: 0 }))
  return result
}

/** Asks the relay for one symbol to see whether it answers, at any time of day. */
export function testRelay(relayUrl: string): Promise<ExtendedResult> {
  return tracked(() => refreshExtended([TEST_SYMBOL], relayUrl, { maxAge: 0 }))
}
