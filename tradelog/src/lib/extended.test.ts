import { describe, expect, it } from 'vitest'
import type { ExtendedQuote, Quote } from '../db/schema.ts'
import {
  createExtendedClient,
  livePrice,
  parseYahooChart,
  relayQuotesUrl,
  yahooSymbol,
  type ExtendedClientOptions,
} from './extended.ts'

const at = (iso: string) => Date.parse(iso)
const seconds = (iso: string) => at(iso) / 1000

// Thursday Oct 29, 2026: New York is UTC−4, so 23:59Z is 7:59 PM after hours
const AFTER_HOURS = '2026-10-29T23:59:00Z'
const PRE_MARKET = '2026-10-29T12:15:00Z'
const REGULAR = '2026-10-29T18:00:00Z'

/** A chart as the relay passes it on: meta plus the newest bar. */
function chart(time: string | null, close: number | null, regularMarketPrice = 348.91) {
  return {
    meta: {
      symbol: 'AAPL',
      regularMarketPrice,
      regularMarketTime: seconds('2026-10-29T20:00:00Z'),
    },
    timestamp: time ? [seconds(time)] : [],
    indicators: { quote: [{ close: close === null ? [] : [close] }] },
  }
}

describe('parseYahooChart', () => {
  it('reads an after-hours trade and its change from the close', () => {
    const q = parseYahooChart('AAPL', chart(AFTER_HOURS, 352.05), 5)
    expect(q).toMatchObject({
      symbol: 'AAPL',
      session: 'post',
      price: 352.05,
      regularPrice: 348.91,
      time: at(AFTER_HOURS),
      fetchedAt: 5,
    })
    expect(q !== 'none' && q?.change).toBeCloseTo(3.14)
    expect(q !== 'none' && q?.changePct).toBeCloseTo(0.9, 2)
  })

  it('reads a pre-market trade against the previous close', () => {
    expect(parseYahooChart('AAPL', chart(PRE_MARKET, 340, 350), 1)).toMatchObject({
      session: 'pre',
      change: -10,
      changePct: (-10 / 350) * 100,
    })
  })

  it("is 'none' when the newest trade is from the regular session or there's none yet", () => {
    expect(parseYahooChart('AAPL', chart(REGULAR, 349), 1)).toBe('none')
    expect(parseYahooChart('AAPL', chart(null, null), 1)).toBe('none')
  })

  it('rounds to cents, or four places below a dollar', () => {
    expect(parseYahooChart('NVDA', chart(AFTER_HOURS, 210.1468, 213.66), 1)).toMatchObject({
      price: 210.15,
    })
    expect(parseYahooChart('PENNY', chart(AFTER_HOURS, 0.123456, 0.12), 1)).toMatchObject({
      price: 0.1235,
    })
  })

  it('walks back past minutes without a trade', () => {
    const raw = {
      ...chart(null, null),
      timestamp: [seconds(AFTER_HOURS) - 60, seconds(AFTER_HOURS)],
      indicators: { quote: [{ close: [351.5, null] }] },
    }
    expect(parseYahooChart('AAPL', raw, 1)).toMatchObject({ price: 351.5 })
  })

  it('rejects anything that is not a chart', () => {
    for (const raw of [null, 'x', {}, { meta: {} }, { meta: { regularMarketPrice: 0 } }]) {
      expect(parseYahooChart('AAPL', raw, 1), JSON.stringify(raw)).toBeNull()
    }
  })
})

describe('relayQuotesUrl', () => {
  it("adds the path once, whatever the trailing slashes, in Yahoo's spelling", () => {
    expect(relayQuotesUrl(' https://r.workers.dev/ ', ['AAPL', 'BRK.B'])).toBe(
      'https://r.workers.dev/quotes?symbols=AAPL,BRK-B',
    )
  })
})

describe('yahooSymbol', () => {
  it('spells share classes with a dash and leaves exchange suffixes alone', () => {
    expect(yahooSymbol('BRK.B')).toBe('BRK-B')
    expect(yahooSymbol('MOG.A')).toBe('MOG-A')
    expect(yahooSymbol('TEVA.TA')).toBe('TEVA.TA')
    expect(yahooSymbol('VOD.L')).toBe('VOD.L')
    expect(yahooSymbol('AAPL')).toBe('AAPL')
  })
})

type Answer = { status: number; body?: unknown } | 'network-error' | 'not-json'

/** A client on a fake clock whose relay answers with `answer` per request. */
function setup(answer: (symbols: string[]) => Answer, options: ExtendedClientOptions = {}) {
  const clock = { now: at('2026-10-30T00:05:00Z') }
  const requests: string[][] = []
  let online = true
  const fakeFetch = (async (input: string | URL | Request) => {
    const symbols = new URL(String(input)).searchParams.get('symbols')!.split(',')
    requests.push(symbols)
    const a = answer(symbols)
    if (a === 'network-error') throw new TypeError('Failed to fetch')
    if (a === 'not-json') return new Response('<html>', { status: 200 })
    return new Response(JSON.stringify(a.body ?? {}), { status: a.status })
  }) as typeof fetch
  const client = createExtendedClient({
    fetch: fakeFetch,
    now: () => clock.now,
    isOnline: () => online,
    ...options,
  })
  return { client, clock, requests, setOnline: (v: boolean) => (online = v) }
}

const RELAY = 'https://relay.test'
const everyoneAfterHours = (symbols: string[]): Answer => ({
  status: 200,
  body: Object.fromEntries(symbols.map((s) => [s, chart(AFTER_HOURS, 100)])),
})

describe('extended client', () => {
  it('fetches every due symbol in one request and reuses answers for 60 seconds', async () => {
    const { client, clock, requests } = setup(everyoneAfterHours)
    const first = await client.getExtended(['AAPL', 'NVDA', 'AAPL'], RELAY)
    expect(first).toMatchObject({ ok: true, fetched: ['AAPL', 'NVDA'] })
    expect(requests).toEqual([['AAPL', 'NVDA']])

    clock.now += 30_000
    const second = await client.getExtended(['AAPL', 'NVDA', 'MSFT'], RELAY)
    expect(requests).toEqual([['AAPL', 'NVDA'], ['MSFT']])
    expect(second.ok && [...second.quotes.keys()]).toEqual(['AAPL', 'NVDA', 'MSFT'])
  })

  it('splits more than 50 symbols into several requests', async () => {
    const { client, requests } = setup(everyoneAfterHours)
    await client.getExtended(
      Array.from({ length: 120 }, (_, i) => `S${i}`),
      RELAY,
    )
    expect(requests.map((r) => r.length)).toEqual([50, 50, 20])
  })

  it('remembers symbols without an extended trade, and unknown ones, as null', async () => {
    const { client, requests } = setup(() => ({
      status: 200,
      body: { AAPL: chart(REGULAR, 349), NOPE: { error: 'not-found' } },
    }))
    const result = await client.getExtended(['AAPL', 'NOPE'], RELAY)
    expect(result.ok && Object.fromEntries(result.quotes)).toEqual({ AAPL: null, NOPE: null })
    await client.getExtended(['AAPL', 'NOPE'], RELAY)
    expect(requests).toHaveLength(1)
  })

  it('reports symbols Yahoo failed for, without caching them', async () => {
    const { client, requests } = setup(() => ({
      status: 200,
      body: { AAPL: chart(AFTER_HOURS, 1), NVDA: { error: 'failed' } },
    }))
    const result = await client.getExtended(['AAPL', 'NVDA'], RELAY)
    expect(result.ok && Object.fromEntries(result.failed)).toEqual({ NVDA: 'failed' })
    await client.getExtended(['AAPL', 'NVDA'], RELAY)
    expect(requests).toEqual([['AAPL', 'NVDA'], ['NVDA']])
  })

  it('backs off when the relay or Yahoo rate limits', async () => {
    let limited = true
    const { client, clock, requests } = setup((symbols) =>
      limited
        ? {
            status: 200,
            body: Object.fromEntries(symbols.map((s) => [s, { error: 'rate-limited' }])),
          }
        : everyoneAfterHours(symbols),
    )
    expect(await client.getExtended(['AAPL'], RELAY)).toEqual({ ok: false, error: 'rate-limited' })
    const until = client.backoffUntil()
    expect(until - clock.now).toBe(15_000)
    expect(await client.getExtended(['AAPL'], RELAY)).toEqual({ ok: false, error: 'rate-limited' })
    expect(requests).toHaveLength(1)

    clock.now = until
    limited = false
    expect(await client.getExtended(['AAPL'], RELAY)).toMatchObject({ ok: true })
  })

  it('backs off on HTTP 429 from the relay', async () => {
    const { client } = setup(() => ({ status: 429 }))
    expect(await client.getExtended(['AAPL'], RELAY)).toEqual({ ok: false, error: 'rate-limited' })
    expect(client.backoffUntil()).toBeGreaterThan(0)
  })

  it('tells a wrong URL apart from an unreachable relay', async () => {
    expect(await setup(() => 'not-json').client.getExtended(['A'], RELAY)).toEqual({
      ok: false,
      error: 'bad-relay',
    })
    expect(await setup(() => ({ status: 404 })).client.getExtended(['A'], RELAY)).toEqual({
      ok: false,
      error: 'bad-relay',
    })
    expect(await setup(() => 'network-error').client.getExtended(['A'], RELAY)).toEqual({
      ok: false,
      error: 'failed',
    })
  })

  it("reads Yahoo's answer for a share class back under the journal's symbol", async () => {
    const { client, requests } = setup((symbols) => everyoneAfterHours(symbols))
    const result = await client.getExtended(['BRK.B'], RELAY)
    expect(requests).toEqual([['BRK-B']])
    expect(result.ok && result.quotes.get('BRK.B')).toMatchObject({ symbol: 'BRK.B', price: 100 })
  })

  it('sends nothing while offline', async () => {
    const { client, requests, setOnline } = setup(everyoneAfterHours)
    setOnline(false)
    expect(await client.getExtended(['AAPL'], RELAY)).toEqual({ ok: false, error: 'offline' })
    expect(requests).toHaveLength(0)
  })
})

function quote(priceTime: string, price = 348.91): Quote {
  return {
    symbol: 'AAPL',
    price,
    change: 5.08,
    changePct: 1.48,
    prevClose: 343.83,
    open: 345,
    high: 351,
    low: 347,
    priceTime: at(priceTime),
    fetchedAt: 1,
  }
}

function extended(time: string): ExtendedQuote {
  return {
    symbol: 'AAPL',
    session: 'post',
    price: 352.05,
    change: 3.14,
    changePct: 0.9,
    regularPrice: 348.91,
    time: at(time),
    fetchedAt: 2,
  }
}

describe('livePrice', () => {
  const evening = at('2026-10-30T00:05:00Z')

  it('shows an after-hours trade over the 4 PM close', () => {
    expect(livePrice(quote('2026-10-29T20:00:00Z'), extended(AFTER_HOURS), evening)).toEqual({
      price: 352.05,
      change: 3.14,
      changePct: 0.9,
      time: at(AFTER_HOURS),
      session: 'post',
      fetchedAt: 2,
      source: 'yahoo',
    })
  })

  it("keeps Finnhub's price once it's newer, e.g. after the next open", () => {
    const live = livePrice(
      quote('2026-10-30T14:00:00Z', 355),
      extended(AFTER_HOURS),
      at('2026-10-30T14:01:00Z'),
    )
    expect(live).toMatchObject({ price: 355, session: null, source: 'finnhub' })
  })

  it('labels a Finnhub close as the close', () => {
    expect(livePrice(quote('2026-10-29T20:00:00Z'), undefined, evening)).toMatchObject({
      session: 'close',
      source: 'finnhub',
    })
  })

  it('uses the extended trade alone, and is null with neither', () => {
    expect(livePrice(undefined, extended(AFTER_HOURS), evening)?.source).toBe('yahoo')
    expect(livePrice(undefined, undefined, evening)).toBeNull()
  })
})
