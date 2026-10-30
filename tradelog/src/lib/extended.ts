import type { ExtendedQuote, Quote } from '../db/schema.ts'
import { priceSession, sessionAt, type PriceSession } from './market.ts'
import { QUOTE_TTL } from './prices.ts'

/** The relay takes at most this many symbols per request. */
const RELAY_BATCH = 50
const REQUEST_TIMEOUT = 10_000
const BACKOFF_START = 15_000
const BACKOFF_MAX = 120_000

export type ExtendedError =
  /** Yahoo (or the relay) asked to slow down */
  | 'rate-limited'
  | 'offline'
  /** The relay couldn't be reached, or Yahoo failed for this symbol */
  | 'failed'
  /** The URL answered, but not like the TradeLog relay */
  | 'bad-relay'

type Raw = Record<string, unknown>
const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Reads one Yahoo chart (as the relay passes it on) into the latest
 * pre-market or after-hours trade. 'none' when the newest trade is from the
 * regular session or there are no trades yet; null when it isn't a chart.
 */
export function parseYahooChart(
  symbol: string,
  chart: unknown,
  fetchedAt: number,
): ExtendedQuote | 'none' | null {
  if (!isObject(chart) || !isObject(chart.meta)) return null
  const regularPrice = chart.meta.regularMarketPrice
  if (!finite(regularPrice) || regularPrice <= 0) return null

  const times = Array.isArray(chart.timestamp) ? chart.timestamp : []
  const quote =
    isObject(chart.indicators) && Array.isArray(chart.indicators.quote)
      ? chart.indicators.quote[0]
      : null
  const closes = isObject(quote) && Array.isArray(quote.close) ? quote.close : []
  let i = Math.min(times.length, closes.length) - 1
  while (i >= 0 && !finite(closes[i])) i--
  if (i < 0) return 'none'

  const time = (times[i] as number) * 1000
  // Yahoo's minute bars carry raw prices like 210.1468; quotes show cents,
  // or four places for penny stocks
  const raw = closes[i] as number
  const places = raw >= 1 ? 100 : 10_000
  const price = Math.round(raw * places) / places
  if (!finite(time) || price <= 0) return 'none'
  const session = sessionAt(time)
  if (session !== 'pre' && session !== 'post') return 'none'

  // Before the open, Yahoo's regular price is still the previous close
  const change = price - regularPrice
  return {
    symbol,
    session,
    price,
    change,
    changePct: (change / regularPrice) * 100,
    regularPrice,
    time,
    fetchedAt,
  }
}

export type ExtendedResult =
  | {
      ok: true
      /** Every asked-for symbol with a known answer: a trade, or null for none */
      quotes: Map<string, ExtendedQuote | null>
      /** Symbols fetched just now (the rest came from the cache) */
      fetched: string[]
      /** Symbols the relay couldn't answer for */
      failed: Map<string, ExtendedError>
    }
  | { ok: false; error: ExtendedError }

export type ExtendedClientOptions = {
  fetch?: typeof fetch
  now?: () => number
  isOnline?: () => boolean
}

/**
 * Yahoo's spelling of a symbol: class shares use a dash (BRK.B → BRK-B).
 * Only a single A or B is a share class; longer suffixes like TEVA.TA are
 * exchange codes that Yahoo spells the same way.
 */
export function yahooSymbol(symbol: string): string {
  return symbol.replace(/^([A-Z0-9]+)\.([AB])$/, '$1-$2')
}

/** Joins the relay's base URL and the quotes path, ignoring trailing slashes. */
export function relayQuotesUrl(relayUrl: string, symbols: string[]): string {
  const base = relayUrl.trim().replace(/\/+$/, '')
  return `${base}/quotes?symbols=${symbols.map((s) => encodeURIComponent(yahooSymbol(s))).join(',')}`
}

/**
 * Pre-market and after-hours prices through the price relay: one request
 * per refresh for every symbol that's due, the same 60 s reuse as Finnhub
 * quotes, and a back-off when Yahoo rate limits.
 */
export function createExtendedClient(options: ExtendedClientOptions = {}) {
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init))
  const now = options.now ?? Date.now
  const isOnline =
    options.isOnline ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false)

  const cache = new Map<string, { quote: ExtendedQuote | null; at: number }>()
  let backoffUntil = 0
  let backoffMs = BACKOFF_START

  function backOff() {
    if (now() < backoffUntil) return
    backoffUntil = now() + backoffMs
    backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX)
  }

  /** Fetches one batch; returns per-symbol answers or why the whole batch failed. */
  async function fetchBatch(
    symbols: string[],
    relayUrl: string,
  ): Promise<{ error: ExtendedError } | { answers: Raw }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
    let res: Response
    let body: unknown
    try {
      res = await doFetch(relayQuotesUrl(relayUrl, symbols), {
        signal: controller.signal,
        cache: 'no-store',
      })
      if (res.status === 429) {
        backOff()
        return { error: 'rate-limited' }
      }
      if (!res.ok) return { error: res.status === 404 ? 'bad-relay' : 'failed' }
      body = await res.json()
    } catch (err) {
      if (err instanceof SyntaxError) return { error: 'bad-relay' }
      // Includes a CORS refusal, which looks like a network error to the page
      return { error: isOnline() ? 'failed' : 'offline' }
    } finally {
      clearTimeout(timer)
    }
    return isObject(body) ? { answers: body } : { error: 'bad-relay' }
  }

  return {
    async getExtended(
      symbols: string[],
      relayUrl: string,
      { maxAge = QUOTE_TTL }: { maxAge?: number } = {},
    ): Promise<ExtendedResult> {
      const unique = [...new Set(symbols)]
      const due = unique.filter((s) => {
        const hit = cache.get(s)
        return !hit || now() - hit.at >= maxAge
      })

      const failed = new Map<string, ExtendedError>()
      const fetched: string[] = []
      if (due.length > 0) {
        if (now() < backoffUntil) return { ok: false, error: 'rate-limited' }
        if (!isOnline()) return { ok: false, error: 'offline' }

        const batches: string[][] = []
        for (let i = 0; i < due.length; i += RELAY_BATCH)
          batches.push(due.slice(i, i + RELAY_BATCH))
        const answers = await Promise.all(batches.map((b) => fetchBatch(b, relayUrl)))

        const batchErrors = answers.flatMap((a) => ('error' in a ? [a.error] : []))
        if (batchErrors.length === answers.length) return { ok: false, error: batchErrors[0] }

        let limited = 0
        answers.forEach((answer, n) => {
          for (const symbol of batches[n]) {
            if ('error' in answer) {
              failed.set(symbol, answer.error)
              continue
            }
            const entry = answer.answers[yahooSymbol(symbol)]
            const error = isObject(entry) ? entry.error : undefined
            if (error === 'rate-limited') {
              limited++
              failed.set(symbol, 'rate-limited')
            } else if (error === 'not-found') {
              // An unknown symbol has no extended trades either
              cache.set(symbol, { quote: null, at: now() })
              fetched.push(symbol)
            } else {
              const parsed = error === undefined ? parseYahooChart(symbol, entry, now()) : null
              if (parsed === null) {
                failed.set(symbol, 'failed')
              } else {
                cache.set(symbol, { quote: parsed === 'none' ? null : parsed, at: now() })
                fetched.push(symbol)
              }
            }
          }
        })
        if (limited > 0 && limited === due.length) {
          backOff()
          return { ok: false, error: 'rate-limited' }
        }
        if (limited === 0 && failed.size === 0) backoffMs = BACKOFF_START
      }

      const quotes = new Map<string, ExtendedQuote | null>()
      for (const s of unique) {
        const hit = cache.get(s)
        if (hit) quotes.set(s, hit.quote)
      }
      return { ok: true, quotes, fetched, failed }
    },

    /** End of the current back-off, or 0. */
    backoffUntil(): number {
      return now() < backoffUntil ? backoffUntil : 0
    },
  }
}

/** The price to show for a symbol, from whichever source has the newest trade. */
export type LivePrice = {
  price: number
  change: number
  changePct: number
  /** When the trade happened (ms); 0 if unknown */
  time: number
  /** Pre-market, after hours or the close; null for a live regular-session price */
  session: PriceSession | null
  fetchedAt: number
  source: 'finnhub' | 'yahoo'
}

/**
 * Picks the newest of Finnhub's quote and Yahoo's extended-hours trade, so
 * an after-hours trade replaces the 4 PM close until the next session.
 */
export function livePrice(
  quote: Quote | undefined,
  extended: ExtendedQuote | undefined,
  now = Date.now(),
): LivePrice | null {
  if (extended && extended.time > (quote?.priceTime ?? 0)) {
    return {
      price: extended.price,
      change: extended.change,
      changePct: extended.changePct,
      time: extended.time,
      session: extended.session,
      fetchedAt: extended.fetchedAt,
      source: 'yahoo',
    }
  }
  if (!quote) return null
  return {
    price: quote.price,
    change: quote.change,
    changePct: quote.changePct,
    time: quote.priceTime,
    session: priceSession(quote.priceTime, now),
    fetchedAt: quote.fetchedAt,
    source: 'finnhub',
  }
}
