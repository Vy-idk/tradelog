import { useLiveQuery } from 'dexie-react-hooks'
import { useSyncExternalStore } from 'react'
import { createPriceClient, type QuoteError, type QuoteResult } from '../lib/prices.ts'
import { db, type Quote } from './schema.ts'

/** One client for the whole app, so the cache and rate limit are shared. */
export const priceClient = createPriceClient()

/** Problems that hold back every price, not just one symbol. */
export type PriceProblem = 'invalid-key' | 'rate-limited'

export type PriceStatus = {
  /** True while any refresh is running */
  refreshing: boolean
  /** Each symbol's latest failure, cleared by its next success */
  failures: Readonly<Record<string, QuoteError>>
  /** From the most recent refresh */
  problem: PriceProblem | null
  /** When a rate-limit back-off ends */
  retryAt: number | null
}

let status: PriceStatus = { refreshing: false, failures: {}, problem: null, retryAt: null }
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

/** Saved quotes for these symbols; undefined while loading. */
export function useQuotes(symbols: string[]): ReadonlyMap<string, Quote> | undefined {
  // Symbols never contain commas, so the joined list is a stable dependency
  const key = [...new Set(symbols)].sort().join(',')
  return useLiveQuery(async () => {
    const rows = key ? await db.quotes.bulkGet(key.split(',')) : []
    return new Map(rows.filter((q) => q !== undefined).map((q) => [q.symbol, q]))
  }, [key])
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

/**
 * Fetches quotes older than maxAge (default 60 s) and saves each one as it
 * arrives, so prices fill in one by one. Never throws.
 */
export async function refreshQuotes(
  symbols: string[],
  apiKey: string,
  options: { maxAge?: number } = {},
): Promise<QuoteResult[]> {
  const unique = [...new Set(symbols)]
  if (!apiKey || unique.length === 0) return []

  running++
  setStatus({ refreshing: true })
  try {
    await seedCache()
    const results = await Promise.all(
      unique.map(async (symbol) => {
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
    setStatus({ problem, retryAt: priceClient.backoffUntil() || null })
    return results
  } finally {
    running--
    setStatus({ refreshing: running > 0 })
  }
}

/** A well-known symbol to check a key with. */
const TEST_SYMBOL = 'AAPL'

/** Asks Finnhub for one fresh quote to see whether a key works. */
export async function testApiKey(apiKey: string): Promise<QuoteResult> {
  priceClient.clearKeyError()
  const [result] = await refreshQuotes([TEST_SYMBOL], apiKey, { maxAge: 0 })
  return result
}
