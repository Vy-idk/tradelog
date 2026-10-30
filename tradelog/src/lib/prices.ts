import type { Quote } from '../db/schema.ts'

export const FINNHUB_QUOTE_URL = 'https://finnhub.io/api/v1/quote'

/** A quote is reused this long before Finnhub is asked again. */
export const QUOTE_TTL = 60_000
/** Pull-to-refresh skips quotes newer than this, so repeated pulls stay cheap. */
export const MANUAL_REFRESH_AGE = 10_000
/** Finnhub's free tier allows 60 calls a minute; stay well under it. */
export const MAX_REQUESTS_PER_MINUTE = 50
/** A price this old, or one whose refresh just failed, is labelled stale. */
export const STALE_AFTER = 3 * 60_000

const MAX_CONCURRENT = 4
const REQUEST_TIMEOUT = 10_000
const BACKOFF_START = 15_000
const BACKOFF_MAX = 120_000

export type QuoteError =
  /** 401: Finnhub doesn't accept the API key */
  | 'invalid-key'
  /** 403: not on the free plan, e.g. most non-US exchanges */
  | 'no-access'
  /** Finnhub answered with an empty quote: unknown symbol */
  | 'not-found'
  /** 429, or still backing off after one */
  | 'rate-limited'
  | 'offline'
  /** Timeout, network trouble or an unexpected answer */
  | 'failed'

/** Short text for a symbol without a price, sized for a list row. */
export const quoteErrorShort: Record<QuoteError, string> = {
  'not-found': 'No price',
  'no-access': 'Not on free plan',
  failed: "Couldn't load",
  offline: 'Offline',
  'rate-limited': 'Waiting',
  'invalid-key': 'Check API key',
}

/** A sentence for the detail view. */
export const quoteErrorLong: Record<QuoteError, string> = {
  'not-found':
    'Finnhub has no price for this symbol. Check the spelling; the free plan covers US stocks.',
  'no-access': "Finnhub's free plan doesn't include this market.",
  failed: "Couldn't reach Finnhub. It will try again on the next refresh.",
  offline: "You're offline. Prices update when you're back online.",
  'rate-limited': 'Finnhub asked TradeLog to slow down. It will try again shortly.',
  'invalid-key': 'Finnhub rejected your API key. Check it in Settings.',
}

export type QuoteResult =
  | { ok: true; quote: Quote; fromCache: boolean }
  | {
      ok: false
      error: QuoteError
      /** The last good quote, to show as stale */ cached: Quote | null
    }

/** Errors that leave a price on screen but out of date. */
const STALE_ERRORS = new Set<QuoteError>(['rate-limited', 'offline', 'failed', 'invalid-key'])

/** True when a shown price may no longer be current. */
export function isStale(
  quote: Pick<Quote, 'fetchedAt'>,
  failure: QuoteError | undefined,
  now = Date.now(),
): boolean {
  return (failure !== undefined && STALE_ERRORS.has(failure)) || now - quote.fetchedAt > STALE_AFTER
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Reads Finnhub's /quote answer: c current, d change, dp change %, h high,
 * l low, o open, pc previous close, t time (seconds). Unknown symbols come
 * back as all zeros, which is null here.
 */
export function parseQuote(symbol: string, body: unknown, fetchedAt: number): Quote | null {
  if (typeof body !== 'object' || body === null) return null
  const { c, d, dp, h, l, o, pc, t } = body as Record<string, unknown>
  if (!finite(c) || c <= 0) return null
  const prevClose = finite(pc) && pc > 0 ? pc : 0
  const change = finite(d) ? d : prevClose ? c - prevClose : 0
  const changePct = finite(dp) ? dp : prevClose ? ((c - prevClose) / prevClose) * 100 : 0
  return {
    symbol,
    price: c,
    change,
    changePct,
    prevClose,
    open: finite(o) ? o : 0,
    high: finite(h) ? h : 0,
    low: finite(l) ? l : 0,
    priceTime: finite(t) && t > 0 ? t * 1000 : 0,
    fetchedAt,
  }
}

/** Sliding-window limit: at most `limit` requests in any `windowMs`. */
export class RateLimiter {
  private readonly limit: number
  private readonly windowMs: number
  private readonly now: () => number
  private sent: number[] = []

  constructor(limit: number, windowMs: number, now: () => number = Date.now) {
    this.limit = limit
    this.windowMs = windowMs
    this.now = now
  }

  /** Ms until another request may go out; 0 if one can go now. */
  wait(): number {
    const now = this.now()
    while (this.sent.length > 0 && now - this.sent[0] >= this.windowMs) this.sent.shift()
    return this.sent.length < this.limit ? 0 : this.sent[0] + this.windowMs - now
  }

  record(): void {
    this.sent.push(this.now())
  }
}

export type PriceClientOptions = {
  fetch?: typeof fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  isOnline?: () => boolean
  /** Requests per window; defaults to MAX_REQUESTS_PER_MINUTE */
  limit?: number
  windowMs?: number
}

export type PriceClient = ReturnType<typeof createPriceClient>

/**
 * Finnhub quote client with a per-symbol cache, a request queue that never
 * exceeds the rate limit, and an exponential back-off after HTTP 429. While
 * backing off, offline, or after the key is rejected, requests fail at once
 * with the last good quote so the UI can show it as stale.
 */
export function createPriceClient(options: PriceClientOptions = {}) {
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init))
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)))
  const isOnline =
    options.isOnline ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false)
  const limiter = new RateLimiter(
    options.limit ?? MAX_REQUESTS_PER_MINUTE,
    options.windowMs ?? 60_000,
    now,
  )

  const cache = new Map<string, Quote>()
  /** Answers worth remembering that aren't prices: unknown or paid-only symbols */
  const misses = new Map<string, { error: QuoteError; at: number }>()
  const inFlight = new Map<string, Promise<QuoteResult>>()
  let backoffUntil = 0
  let backoffMs = BACKOFF_START
  let rejectedKey: string | null = null

  // Concurrency slots; a released slot passes straight to the next waiter
  let active = 0
  const waiting: (() => void)[] = []
  function acquire(): Promise<void> {
    if (active < MAX_CONCURRENT) {
      active++
      return Promise.resolve()
    }
    return new Promise((resolve) => waiting.push(resolve))
  }
  function release() {
    const next = waiting.shift()
    if (next) next()
    else active--
  }

  /** Why a request can't go out right now, if anything. */
  function blocked(apiKey: string): QuoteError | null {
    if (apiKey === rejectedKey) return 'invalid-key'
    if (now() < backoffUntil) return 'rate-limited'
    if (!isOnline()) return 'offline'
    return null
  }

  async function request(symbol: string, apiKey: string): Promise<QuoteResult> {
    const fail = (error: QuoteError): QuoteResult => ({
      ok: false,
      error,
      cached: cache.get(symbol) ?? null,
    })

    await acquire()
    try {
      for (let wait = limiter.wait(); wait > 0; wait = limiter.wait()) await sleep(wait)
      // Things may have changed while this request sat in the queue
      const reason = blocked(apiKey)
      if (reason) return fail(reason)
      limiter.record()

      const url = `${FINNHUB_QUOTE_URL}?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(apiKey)}`
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
      let res: Response
      let body: unknown = null
      try {
        res = await doFetch(url, { signal: controller.signal, cache: 'no-store' })
        if (res.ok) body = await res.json()
      } catch {
        return fail(isOnline() ? 'failed' : 'offline')
      } finally {
        clearTimeout(timer)
      }

      if (res.status === 429) {
        // Requests already in flight answer 429 too; count it as one hit
        if (now() >= backoffUntil) {
          backoffUntil = now() + backoffMs
          backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX)
        }
        return fail('rate-limited')
      }
      if (res.status === 401) {
        rejectedKey = apiKey
        return fail('invalid-key')
      }
      backoffMs = BACKOFF_START
      if (res.status === 403) {
        misses.set(symbol, { error: 'no-access', at: now() })
        return fail('no-access')
      }
      if (!res.ok) return fail('failed')

      const quote = parseQuote(symbol, body, now())
      if (!quote) {
        misses.set(symbol, { error: 'not-found', at: now() })
        return fail('not-found')
      }
      misses.delete(symbol)
      cache.set(symbol, quote)
      return { ok: true, quote, fromCache: false }
    } finally {
      release()
    }
  }

  return {
    /** A quote no older than maxAge (default 60 s), from the cache when possible. */
    getQuote(
      symbol: string,
      apiKey: string,
      { maxAge = QUOTE_TTL }: { maxAge?: number } = {},
    ): Promise<QuoteResult> {
      const cached = cache.get(symbol) ?? null
      if (cached && now() - cached.fetchedAt < maxAge) {
        return Promise.resolve({ ok: true, quote: cached, fromCache: true })
      }
      const miss = misses.get(symbol)
      if (miss && now() - miss.at < maxAge) {
        return Promise.resolve({ ok: false, error: miss.error, cached })
      }
      const reason = blocked(apiKey)
      if (reason) return Promise.resolve({ ok: false, error: reason, cached })

      // One request per symbol at a time; later callers share it
      const key = `${apiKey}\n${symbol}`
      let pending = inFlight.get(key)
      if (!pending) {
        pending = request(symbol, apiKey).finally(() => inFlight.delete(key))
        inFlight.set(key, pending)
      }
      return pending
    },

    /** Loads quotes saved earlier, so a relaunch doesn't refetch fresh ones. */
    seed(quotes: Quote[]): void {
      for (const q of quotes) {
        const current = cache.get(q.symbol)
        if (!current || current.fetchedAt < q.fetchedAt) cache.set(q.symbol, q)
      }
    },

    /** Lets a key that Finnhub rejected be tried again, e.g. after re-entering it. */
    clearKeyError(): void {
      rejectedKey = null
    },

    /** End of the current 429 back-off, or 0 when not backing off. */
    backoffUntil(): number {
      return now() < backoffUntil ? backoffUntil : 0
    },
  }
}
