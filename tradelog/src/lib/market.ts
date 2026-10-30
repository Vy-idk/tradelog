/** US stock market sessions, by the clock in New York. */
export type Session = 'pre' | 'regular' | 'post' | 'closed'

const PRE_OPEN = 4 * 60
const OPEN = 9 * 60 + 30
const CLOSE = 16 * 60
const POST_CLOSE = 20 * 60

const newYork = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

/** The New York date (YYYY-MM-DD), weekday and minutes since midnight at a moment. */
function newYorkClock(timestamp: number): { date: string; weekend: boolean; minutes: number } {
  const parts: Record<string, string> = {}
  for (const p of newYork.formatToParts(timestamp)) parts[p.type] = p.value
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekend: parts.weekday === 'Sat' || parts.weekday === 'Sun',
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  }
}

/**
 * The session a moment falls in: pre-market 4:00–9:30, regular 9:30–16:00,
 * after hours 16:00–20:00 (New York time), closed otherwise and at weekends.
 * Holidays aren't known, so a holiday reads like a normal weekday.
 */
export function sessionAt(timestamp: number): Session {
  const { weekend, minutes } = newYorkClock(timestamp)
  if (weekend) return 'closed'
  if (minutes >= PRE_OPEN && minutes < OPEN) return 'pre'
  // A last trade stamped exactly 16:00 is the closing print
  if (minutes >= OPEN && minutes <= CLOSE) return 'regular'
  if (minutes > CLOSE && minutes < POST_CLOSE) return 'post'
  return 'closed'
}

export type PriceSession = 'pre' | 'post' | 'close'

/**
 * What kind of price a quote shows, judged by when the exchange set it:
 * a pre-market or after-hours trade, or the regular session's close once
 * that session is over. Null for a live regular-session price, or when the
 * price time is unknown.
 */
export function priceSession(priceTime: number, now = Date.now()): PriceSession | null {
  if (!priceTime) return null
  const session = sessionAt(priceTime)
  if (session === 'pre' || session === 'post') return session
  if (session !== 'regular') return null
  const live =
    sessionAt(now) === 'regular' && newYorkClock(now).date === newYorkClock(priceTime).date
  return live ? null : 'close'
}

/** Short label for a list row. */
export const priceSessionShort: Record<PriceSession, string> = {
  pre: 'Pre-market',
  post: 'After hours',
  close: 'Close',
}

/** Describes the price in a sentence, e.g. "After-hours price from 7:58 PM". */
export const priceSessionLong: Record<PriceSession | 'live', string> = {
  live: 'Price',
  pre: 'Pre-market price',
  post: 'After-hours price',
  close: 'Closing price',
}
