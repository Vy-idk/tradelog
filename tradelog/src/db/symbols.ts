import {
  FINNHUB_SEARCH_URL,
  UNKNOWN_SYMBOL_TTL,
  findListing,
  type SymbolCheck,
} from '../lib/symbols.ts'
import { priceClient } from './quotes.ts'
import { db } from './schema.ts'

const REQUEST_TIMEOUT = 10_000

/**
 * Checks that a symbol trades on a US exchange: Finnhub's symbol search
 * first, which also gives the name, then a price, which catches listings
 * the search misses. Answers are saved, so a known symbol checks offline.
 * Never throws.
 */
export async function checkSymbol(symbol: string, apiKey: string): Promise<SymbolCheck> {
  const saved = await db.symbols.get(symbol).catch(() => undefined)
  if (saved?.valid) return { status: 'valid', symbol, name: saved.name }
  if (saved && Date.now() - saved.checkedAt < UNKNOWN_SYMBOL_TTL)
    return { status: 'invalid', symbol }

  if (!apiKey) return { status: 'unchecked', symbol, reason: 'no-key' }
  if (navigator.onLine === false) return { status: 'unchecked', symbol, reason: 'offline' }

  const remember = async (valid: boolean, name = ''): Promise<SymbolCheck> => {
    await db.symbols.put({ symbol, name, valid, checkedAt: Date.now() }).catch(() => {})
    return valid ? { status: 'valid', symbol, name } : { status: 'invalid', symbol }
  }

  const url = `${FINNHUB_SEARCH_URL}?q=${encodeURIComponent(symbol)}&exchange=US&token=${encodeURIComponent(apiKey)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (res.status === 401) return { status: 'unchecked', symbol, reason: 'invalid-key' }
    if (res.status === 429) return { status: 'unchecked', symbol, reason: 'rate-limited' }
    if (res.ok) {
      const listing = findListing(symbol, await res.json())
      if (listing) return remember(true, listing.name)
    }
  } catch {
    // Fall through to the price check
  } finally {
    clearTimeout(timer)
  }

  // Finnhub's free prices cover US listings only: a price means it's real
  const quote = await priceClient.getQuote(symbol, apiKey)
  if (quote.ok) {
    await db.quotes.put(quote.quote).catch(() => {})
    return remember(true)
  }
  if (quote.error === 'not-found' || quote.error === 'no-access') return remember(false)
  const reason =
    quote.error === 'invalid-key' || quote.error === 'rate-limited' || quote.error === 'offline'
      ? quote.error
      : 'failed'
  return { status: 'unchecked', symbol, reason }
}
