import { describe, expect, it } from 'vitest'
import {
  createPriceClient,
  isStale,
  parseQuote,
  QUOTE_TTL,
  RateLimiter,
  STALE_AFTER,
  type PriceClientOptions,
} from './prices.ts'

const KEY = 'test-key'

/** Finnhub's answer for a symbol trading at `price`. */
function finnhubBody(price: number) {
  return {
    c: price,
    d: 1.5,
    dp: 1.2,
    h: price + 2,
    l: price - 2,
    o: price - 1,
    pc: price - 1.5,
    t: 1_700_000_000,
  }
}

type Answer = { status: number; body?: unknown } | 'network-error'

/**
 * A client on a fake clock. `answer` decides each response; sleeping moves
 * the clock forward instead of waiting. Every request is logged with its time.
 */
function setup(
  answer: (symbol: string, n: number) => Answer = () => ({ status: 200, body: finnhubBody(100) }),
  options: PriceClientOptions = {},
) {
  const clock = { now: 1_000_000 }
  const calls: { symbol: string; token: string; at: number }[] = []
  let online = true
  const fakeFetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    const symbol = url.searchParams.get('symbol')!
    calls.push({ symbol, token: url.searchParams.get('token')!, at: clock.now })
    const a = answer(symbol, calls.length)
    if (a === 'network-error') throw new TypeError('Failed to fetch')
    return new Response(JSON.stringify(a.body ?? {}), { status: a.status })
  }) as typeof fetch
  const client = createPriceClient({
    fetch: fakeFetch,
    now: () => clock.now,
    sleep: async (ms) => {
      clock.now += ms
    },
    isOnline: () => online,
    ...options,
  })
  return {
    client,
    clock,
    calls,
    setOnline: (value: boolean) => (online = value),
  }
}

describe('parseQuote', () => {
  it('reads every field and converts the time to milliseconds', () => {
    expect(parseQuote('AAPL', finnhubBody(100), 5)).toEqual({
      symbol: 'AAPL',
      price: 100,
      change: 1.5,
      changePct: 1.2,
      prevClose: 98.5,
      open: 99,
      high: 102,
      low: 98,
      priceTime: 1_700_000_000_000,
      fetchedAt: 5,
    })
  })

  it('treats the all-zero answer for unknown symbols as no quote', () => {
    expect(
      parseQuote('NOPE', { c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 }, 1),
    ).toBeNull()
  })

  it('rejects answers that are not quotes', () => {
    for (const body of [null, 'oops', [], { error: 'Invalid API key.' }, { c: -1 }, { c: 'NaN' }]) {
      expect(parseQuote('AAPL', body, 1), JSON.stringify(body)).toBeNull()
    }
  })

  it('works out the change from the previous close when Finnhub leaves it out', () => {
    const q = parseQuote('AAPL', { c: 110, pc: 100, d: null, dp: null }, 1)!
    expect(q.change).toBe(10)
    expect(q.changePct).toBe(10)
    expect(q.priceTime).toBe(0)
  })
})

describe('isStale', () => {
  it('is fresh right after fetching', () => {
    expect(isStale({ fetchedAt: 0 }, undefined, STALE_AFTER)).toBe(false)
  })
  it('is stale once old', () => {
    expect(isStale({ fetchedAt: 0 }, undefined, STALE_AFTER + 1)).toBe(true)
  })
  it('is stale when the last refresh failed, however recent the price', () => {
    for (const failure of ['rate-limited', 'offline', 'failed', 'invalid-key'] as const) {
      expect(isStale({ fetchedAt: 0 }, failure, 0), failure).toBe(true)
    }
    expect(isStale({ fetchedAt: 0 }, 'not-found', 0)).toBe(false)
  })
})

describe('RateLimiter', () => {
  it('allows `limit` requests per window, then waits for the oldest to expire', () => {
    let now = 0
    const limiter = new RateLimiter(2, 1000, () => now)
    expect(limiter.wait()).toBe(0)
    limiter.record()
    now = 100
    limiter.record()
    expect(limiter.wait()).toBe(900)
    now = 1000
    expect(limiter.wait()).toBe(0)
    limiter.record()
    expect(limiter.wait()).toBe(100)
  })
})

describe('price client', () => {
  it('fetches a quote with the symbol and key', async () => {
    const { client, calls } = setup()
    const result = await client.getQuote('BRK.B', KEY)
    expect(result).toMatchObject({
      ok: true,
      fromCache: false,
      quote: { symbol: 'BRK.B', price: 100 },
    })
    expect(calls).toEqual([expect.objectContaining({ symbol: 'BRK.B', token: KEY })])
  })

  it('reuses a quote for 60 seconds', async () => {
    const { client, clock, calls } = setup()
    await client.getQuote('AAPL', KEY)
    clock.now += QUOTE_TTL - 1
    expect(await client.getQuote('AAPL', KEY)).toMatchObject({ ok: true, fromCache: true })
    expect(calls).toHaveLength(1)
    clock.now += 1
    expect(await client.getQuote('AAPL', KEY)).toMatchObject({ ok: true, fromCache: false })
    expect(calls).toHaveLength(2)
  })

  it('honours a shorter max age, e.g. for pull-to-refresh', async () => {
    const { client, clock, calls } = setup()
    await client.getQuote('AAPL', KEY)
    clock.now += 10_000
    await client.getQuote('AAPL', KEY, { maxAge: 10_000 })
    expect(calls).toHaveLength(2)
  })

  it('shares one request between callers asking for the same symbol', async () => {
    const { client, calls } = setup()
    const [a, b] = await Promise.all([client.getQuote('AAPL', KEY), client.getQuote('AAPL', KEY)])
    expect(a).toEqual(b)
    expect(calls).toHaveLength(1)
  })

  it('uses seeded quotes from storage while they are fresh', async () => {
    const { client, clock, calls } = setup()
    const saved = parseQuote('AAPL', finnhubBody(90), clock.now - 1000)!
    client.seed([saved])
    expect(await client.getQuote('AAPL', KEY)).toEqual({ ok: true, quote: saved, fromCache: true })
    expect(calls).toHaveLength(0)
  })

  it('never sends more than the limit in any minute, queueing the rest', async () => {
    const { client, calls } = setup()
    const symbols = Array.from({ length: 120 }, (_, i) => `S${i}`)
    const results = await Promise.all(symbols.map((s) => client.getQuote(s, KEY)))
    expect(results.every((r) => r.ok)).toBe(true)
    expect(calls).toHaveLength(120)
    for (const call of calls) {
      const inWindow = calls.filter((c) => c.at > call.at - 60_000 && c.at <= call.at)
      expect(inWindow.length).toBeLessThanOrEqual(50)
    }
    // The first 50 go out at once; the rest wait their turn
    expect(calls[49].at).toBe(calls[0].at)
    expect(calls[50].at).toBe(calls[0].at + 60_000)
  })

  it('backs off after HTTP 429 and returns the last good quote meanwhile', async () => {
    let limited = false
    const { client, clock, calls } = setup(() =>
      limited ? { status: 429 } : { status: 200, body: finnhubBody(100) },
    )
    await client.getQuote('AAPL', KEY)
    clock.now += QUOTE_TTL
    limited = true

    const hit = await client.getQuote('AAPL', KEY)
    expect(hit).toMatchObject({ ok: false, error: 'rate-limited', cached: { price: 100 } })
    const until = client.backoffUntil()
    expect(until).toBeGreaterThan(clock.now)

    // Nothing goes out during the back-off, for any symbol
    expect(await client.getQuote('MSFT', KEY)).toEqual({
      ok: false,
      error: 'rate-limited',
      cached: null,
    })
    expect(calls).toHaveLength(2)

    clock.now = until
    limited = false
    expect(await client.getQuote('AAPL', KEY)).toMatchObject({ ok: true, fromCache: false })
    expect(client.backoffUntil()).toBe(0)
  })

  it('doubles the back-off on repeated 429s, up to a cap', async () => {
    const { client, clock } = setup(() => ({ status: 429 }))
    const waits: number[] = []
    for (let i = 0; i < 6; i++) {
      await client.getQuote('AAPL', KEY)
      waits.push(client.backoffUntil() - clock.now)
      clock.now = client.backoffUntil()
    }
    expect(waits).toEqual([15_000, 30_000, 60_000, 120_000, 120_000, 120_000])
  })

  it('counts 429s from requests already in flight as one hit', async () => {
    const { client, clock } = setup(() => ({ status: 429 }))
    await Promise.all(['A', 'B', 'C', 'D'].map((s) => client.getQuote(s, KEY)))
    expect(client.backoffUntil() - clock.now).toBe(15_000)
  })

  it('fails queued requests when a 429 arrives while they wait', async () => {
    // Four requests are in flight when the first answers 429; the last two
    // are still queued and must not go out
    const { client, calls } = setup((_, n) =>
      n === 1 ? { status: 429 } : { status: 200, body: finnhubBody(1) },
    )
    const results = await Promise.all(
      ['A', 'B', 'C', 'D', 'E', 'F'].map((s) => client.getQuote(s, KEY)),
    )
    expect(results.map((r) => (r.ok ? 'ok' : r.error))).toEqual([
      'rate-limited',
      'ok',
      'ok',
      'ok',
      'rate-limited',
      'rate-limited',
    ])
    expect(calls).toHaveLength(4)
  })

  it('stops using a key Finnhub rejects, until told to retry it', async () => {
    const { client, calls } = setup((_, n) =>
      n === 1
        ? { status: 401, body: { error: 'Invalid API key.' } }
        : { status: 200, body: finnhubBody(5) },
    )
    expect(await client.getQuote('AAPL', 'bad')).toMatchObject({ ok: false, error: 'invalid-key' })
    expect(await client.getQuote('MSFT', 'bad')).toMatchObject({ ok: false, error: 'invalid-key' })
    expect(calls).toHaveLength(1)

    // A different key goes through
    expect(await client.getQuote('MSFT', 'good')).toMatchObject({ ok: true })
    client.clearKeyError()
    expect(await client.getQuote('AAPL', 'bad')).toMatchObject({ ok: true })
  })

  it('remembers unknown and paid-only symbols for the cache period', async () => {
    const { client, clock, calls } = setup((s) =>
      s === 'TASE'
        ? { status: 403 }
        : { status: 200, body: { c: 0, d: null, dp: null, pc: 0, t: 0 } },
    )
    expect(await client.getQuote('NOPE', KEY)).toMatchObject({ ok: false, error: 'not-found' })
    expect(await client.getQuote('TASE', KEY)).toMatchObject({ ok: false, error: 'no-access' })
    await client.getQuote('NOPE', KEY)
    await client.getQuote('TASE', KEY)
    expect(calls).toHaveLength(2)
    clock.now += QUOTE_TTL
    await client.getQuote('NOPE', KEY)
    expect(calls).toHaveLength(3)
  })

  it('reports offline without sending anything', async () => {
    const { client, calls, setOnline } = setup()
    await client.getQuote('AAPL', KEY)
    setOnline(false)
    expect(await client.getQuote('AAPL', KEY, { maxAge: 0 })).toMatchObject({
      ok: false,
      error: 'offline',
      cached: { price: 100 },
    })
    expect(calls).toHaveLength(1)
  })

  it('tells a network failure apart from being offline', async () => {
    const { client } = setup(() => 'network-error')
    expect(await client.getQuote('AAPL', KEY)).toMatchObject({ ok: false, error: 'failed' })
  })

  it('treats server errors and bad JSON as failures without backing off', async () => {
    const { client } = setup((s) =>
      s === 'A' ? { status: 500 } : { status: 200, body: 'not json' },
    )
    expect(await client.getQuote('A', KEY)).toMatchObject({ ok: false, error: 'failed' })
    expect(await client.getQuote('B', KEY)).toMatchObject({ ok: false, error: 'not-found' })
    expect(client.backoffUntil()).toBe(0)
  })
})
