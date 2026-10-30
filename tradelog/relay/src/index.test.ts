import { afterEach, describe, expect, it, vi } from 'vitest'
import relay, { trimChart } from './index.ts'

const env = { ALLOWED_ORIGINS: 'https://vy-idk.github.io, http://localhost:5173' }

/** A Yahoo chart answer with the given bars (null closes are minutes without trades). */
function yahooChart(bars: [number, number | null][], meta: Record<string, unknown> = {}) {
  return {
    chart: {
      result: [
        {
          meta: { symbol: 'AAPL', regularMarketPrice: 348.91, regularMarketTime: 100, ...meta },
          timestamp: bars.map(([t]) => t),
          indicators: { quote: [{ close: bars.map(([, c]) => c), open: bars.map(() => 1) }] },
        },
      ],
      error: null,
    },
  }
}

function get(path: string, origin = 'https://vy-idk.github.io') {
  return relay.fetch(new Request(`https://relay.test${path}`, { headers: { Origin: origin } }), env)
}

afterEach(() => vi.unstubAllGlobals())

describe('trimChart', () => {
  it('keeps the meta the app reads and only the newest bar with a price', () => {
    const trimmed = trimChart(
      yahooChart(
        [
          [1, 10],
          [2, 11],
          [3, null],
        ],
        { longName: 'Apple Inc.', validRanges: ['1d'] },
      ),
    )
    expect(trimmed).toEqual({
      meta: { symbol: 'AAPL', regularMarketPrice: 348.91, regularMarketTime: 100 },
      timestamp: [2],
      indicators: { quote: [{ close: [11] }] },
    })
  })

  it('keeps the meta when there are no bars yet', () => {
    expect(trimChart(yahooChart([]))).toMatchObject({
      timestamp: [],
      indicators: { quote: [{ close: [] }] },
    })
  })

  it('rejects answers without a chart', () => {
    for (const body of [null, {}, { chart: { result: null } }, { chart: { result: [{}] } }]) {
      expect(trimChart(body), JSON.stringify(body)).toBeNull()
    }
  })
})

describe('relay', () => {
  it('fetches each symbol from Yahoo with extended hours and answers the app with CORS', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', async (input: string) => {
      urls.push(input)
      if (input.includes('/NOPE?'))
        return new Response('{"chart":{"result":null}}', { status: 404 })
      return Response.json(yahooChart([[5, 352.05]]))
    })

    const res = await get('/quotes?symbols=aapl, NOPE,AAPL')
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://vy-idk.github.io')
    expect(await res.json()).toEqual({
      AAPL: {
        meta: { symbol: 'AAPL', regularMarketPrice: 348.91, regularMarketTime: 100 },
        timestamp: [5],
        indicators: { quote: [{ close: [352.05] }] },
      },
      NOPE: { error: 'not-found' },
    })
    // Duplicates are fetched once, and every request asks for pre/post-market bars
    expect(urls).toHaveLength(2)
    expect(urls.every((u) => u.includes('includePrePost=true'))).toBe(true)
  })

  it('reports Yahoo rate limits and failures per symbol', async () => {
    vi.stubGlobal('fetch', async (input: string) => {
      if (input.includes('/SLOW?')) return new Response('', { status: 429 })
      if (input.includes('/DOWN?')) throw new TypeError('network')
      return new Response('', { status: 500 })
    })
    const res = await get('/quotes?symbols=SLOW,DOWN,ERR')
    expect(await res.json()).toEqual({
      SLOW: { error: 'rate-limited' },
      DOWN: { error: 'failed' },
      ERR: { error: 'failed' },
    })
  })

  it('withholds CORS from other sites', async () => {
    vi.stubGlobal('fetch', async () => Response.json(yahooChart([[5, 1]])))
    const res = await get('/quotes?symbols=AAPL', 'https://evil.example')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('answers the CORS preflight for allowed origins', async () => {
    const res = await relay.fetch(
      new Request('https://relay.test/quotes', {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:5173' },
      }),
      env,
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
  })

  it('rejects bad requests without calling Yahoo', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    expect((await get('/quotes')).status).toBe(400)
    expect((await get('/quotes?symbols=AA%20PL')).status).toBe(400)
    expect(
      (await get(`/quotes?symbols=${Array.from({ length: 51 }, (_, i) => `S${i}`)}`)).status,
    ).toBe(400)
    expect((await get('/elsewhere?symbols=AAPL')).status).toBe(404)
    expect(
      (await relay.fetch(new Request('https://relay.test/quotes', { method: 'POST' }), env)).status,
    ).toBe(405)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
