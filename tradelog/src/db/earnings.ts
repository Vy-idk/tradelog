import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'
import { addDays, today } from '../lib/dates.ts'
import {
  EARNINGS_LOOKAHEAD_DAYS,
  EARNINGS_PER_MINUTE,
  FINNHUB_EARNINGS_URL,
  earningsDue,
  parseEarnings,
} from '../lib/earnings.ts'
import { RateLimiter } from '../lib/prices.ts'
import { db, type EarningsRow } from './schema.ts'

const REQUEST_TIMEOUT = 10_000

const limiter = new RateLimiter(EARNINGS_PER_MINUTE, 60_000)

/** Saved earnings dates for these symbols; undefined while loading. */
export function useEarnings(symbols: string[]): ReadonlyMap<string, EarningsRow> | undefined {
  const key = symbols.join(',')
  return useLiveQuery(async () => {
    const rows = key ? await db.earnings.bulkGet(key.split(',')) : []
    return new Map(rows.filter((r) => r !== undefined).map((r) => [r.symbol, r]))
  }, [key])
}

/** Asks about one symbol. False means stop for now: the next would fail the same way. */
async function fetchEarnings(symbol: string, apiKey: string): Promise<boolean> {
  const from = today()
  const to = addDays(from, EARNINGS_LOOKAHEAD_DAYS)
  const url = `${FINNHUB_EARNINGS_URL}?from=${from}&to=${to}&symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(apiKey)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (res.status === 403) {
      // Remembered for a day, so a plan without this endpoint isn't asked on every visit
      const saved = await db.earnings.get(symbol)
      await db.earnings.put({
        symbol,
        date: saved?.date ?? null,
        hour: saved?.hour ?? '',
        noAccess: true,
        fetchedAt: Date.now(),
      })
      return true
    }
    if (!res.ok) return false
    await db.earnings.put(parseEarnings(symbol, await res.json(), from, Date.now()))
    return true
  } finally {
    clearTimeout(timer)
  }
}

/** Symbols waiting for a request, with the API key to ask with */
const queue = new Map<string, string>()
let worker: Promise<void> | null = null

/** Works through the queue one symbol at a time. Failures keep the saved dates. */
async function drain(): Promise<void> {
  try {
    for (const [symbol, apiKey] of queue) {
      queue.delete(symbol)
      for (let wait = limiter.wait(); wait > 0; wait = limiter.wait()) {
        await new Promise((r) => setTimeout(r, wait))
      }
      limiter.record()
      if (!(await fetchEarnings(symbol, apiKey))) break
    }
  } catch {
    // Offline, timed out or the service is down: the next visit tries again
  } finally {
    queue.clear()
  }
}

/** Fetches dates that are missing or out of date, saving each as it arrives. Never throws. */
export async function refreshEarnings(symbols: string[], apiKey: string): Promise<void> {
  if (!apiKey || symbols.length === 0 || navigator.onLine === false) return
  const rows = await db.earnings.bulkGet(symbols).catch(() => [])
  const now = Date.now()
  symbols.forEach((s, i) => {
    if (earningsDue(rows[i], today(), now)) queue.set(s, apiKey)
  })
  worker ??= drain().finally(() => {
    worker = null
  })
  await worker
}

/** A new API key may be on a plan with earnings dates, so refusals are asked about again. */
export async function forgetEarningsRefusals(): Promise<void> {
  await db.earnings
    .filter((r) => r.noAccess === true)
    .delete()
    .catch(() => {})
}

/** Keeps earnings dates current while a screen that shows them is open. */
export function useEarningsRefresh(symbols: string[], apiKey: string, online: boolean): void {
  const key = symbols.join(',')
  useEffect(() => {
    if (key && apiKey && online) void refreshEarnings(key.split(','), apiKey)
  }, [key, apiKey, online])
}
