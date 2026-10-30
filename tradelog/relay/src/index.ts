/**
 * TradeLog price relay: a Cloudflare Worker that fetches Yahoo Finance
 * charts (including pre-market and after-hours trades) for the app. Yahoo
 * sends no CORS headers, so a web app can't call it directly.
 *
 *   GET /quotes?symbols=AAPL,NVDA
 *   → { "AAPL": { meta, timestamp: [t], indicators: { quote: [{ close: [c] }] } },
 *       "NVDA": { "error": "not-found" } }
 *
 * Each chart keeps Yahoo's own shape, cut down to the newest bar, so the app
 * does all the reading and fixes never need a redeploy here.
 */

export type Env = {
  /** Comma-separated origins allowed to read responses, e.g. https://you.github.io */
  ALLOWED_ORIGINS: string
}

export type ChartError = { error: 'not-found' | 'rate-limited' | 'failed' }

const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart/'
const SYMBOL = /^[A-Z0-9^][A-Z0-9.\-=^]{0,14}$/
const MAX_SYMBOLS = 50
const TIMEOUT_MS = 8000

/** Meta fields the app reads; the rest of Yahoo's meta is dropped. */
const META_FIELDS = [
  'symbol',
  'currency',
  'regularMarketPrice',
  'regularMarketTime',
  'previousClose',
  'chartPreviousClose',
  'hasPrePostMarketData',
  'currentTradingPeriod',
]

type Raw = Record<string, unknown>
const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null

/** Yahoo's chart answer cut down to its meta and newest bar with a price. */
export function trimChart(body: unknown): Raw | null {
  const result =
    isObject(body) && isObject(body.chart) && Array.isArray(body.chart.result)
      ? body.chart.result[0]
      : null
  if (!isObject(result) || !isObject(result.meta)) return null

  const meta: Raw = {}
  for (const key of META_FIELDS) if (key in result.meta) meta[key] = result.meta[key]

  const times = Array.isArray(result.timestamp) ? result.timestamp : []
  const quote =
    isObject(result.indicators) && Array.isArray(result.indicators.quote)
      ? result.indicators.quote[0]
      : null
  const closes = isObject(quote) && Array.isArray(quote.close) ? quote.close : []
  // Minutes without a trade have a null close; walk back to the last real one
  let i = Math.min(times.length, closes.length) - 1
  while (i >= 0 && typeof closes[i] !== 'number') i--

  return {
    meta,
    timestamp: i >= 0 ? [times[i]] : [],
    indicators: { quote: [{ close: i >= 0 ? [closes[i]] : [] }] },
  }
}

async function fetchChart(symbol: string): Promise<Raw | ChartError> {
  const url = `${YAHOO_CHART}${encodeURIComponent(symbol)}?interval=1m&range=1d&includePrePost=true`
  let res: Response
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (TradeLog price relay)', Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    return { error: 'failed' }
  }
  if (res.status === 404) return { error: 'not-found' }
  if (res.status === 429) return { error: 'rate-limited' }
  if (!res.ok) return { error: 'failed' }
  try {
    return trimChart(await res.json()) ?? { error: 'not-found' }
  } catch {
    return { error: 'failed' }
  }
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin')
  const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  return origin && allowed.includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
    : { Vary: 'Origin' }
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env)
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Max-Age': '86400',
        },
      })
    }
    if (request.method !== 'GET') return json({ error: 'Use GET' }, 405, cors)

    const url = new URL(request.url)
    if (url.pathname !== '/quotes') return json({ error: 'Not found' }, 404, cors)

    const symbols = [
      ...new Set(
        (url.searchParams.get('symbols') ?? '')
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean),
      ),
    ]
    if (symbols.length === 0) return json({ error: 'Pass ?symbols=AAPL,NVDA' }, 400, cors)
    if (symbols.length > MAX_SYMBOLS) {
      return json({ error: `At most ${MAX_SYMBOLS} symbols` }, 400, cors)
    }
    const bad = symbols.find((s) => !SYMBOL.test(s))
    if (bad) return json({ error: `Not a symbol: ${bad}` }, 400, cors)

    const charts = await Promise.all(symbols.map(async (s) => [s, await fetchChart(s)] as const))
    return json(Object.fromEntries(charts), 200, cors)
  },
}
