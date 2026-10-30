import type { EarningsRow } from '../db/schema.ts'
import { daysBetween, isIsoDate } from './dates.ts'
import { formatDateRange } from './format.ts'

export const FINNHUB_EARNINGS_URL = 'https://finnhub.io/api/v1/calendar/earnings'

/** Dates rarely move, so one check a day per symbol is plenty. */
export const EARNINGS_TTL = 86_400_000
/** How far ahead to look for the next report. */
export const EARNINGS_LOOKAHEAD_DAYS = 100
/** Finnhub's free tier allows 60 calls a minute, and prices may use up to 50. */
export const EARNINGS_PER_MINUTE = 10
/** List rows show a report this close; the details dialog shows any date. */
export const EARNINGS_ROW_DAYS = 30
/** A report this close is highlighted. */
export const EARNINGS_SOON_DAYS = 7

const HOURS = new Set(['bmo', 'amc', 'dmh'])

/**
 * Reads Finnhub's /calendar/earnings answer, { earningsCalendar: [{ symbol,
 * date, hour, … }] }, keeping the earliest report from `today` on.
 */
export function parseEarnings(
  symbol: string,
  body: unknown,
  today: string,
  fetchedAt: number,
): EarningsRow {
  const none: EarningsRow = { symbol, date: null, hour: '', fetchedAt }
  if (typeof body !== 'object' || body === null) return none
  const { earningsCalendar } = body as { earningsCalendar?: unknown }
  if (!Array.isArray(earningsCalendar)) return none

  let next = none
  for (const item of earningsCalendar) {
    if (typeof item !== 'object' || item === null) continue
    const { symbol: s, date, hour } = item as Record<string, unknown>
    if (s !== symbol || typeof date !== 'string' || !isIsoDate(date) || date < today) continue
    if (next.date === null || date < next.date) {
      const known = typeof hour === 'string' && HOURS.has(hour)
      next = { symbol, date, hour: known ? (hour as EarningsRow['hour']) : '', fetchedAt }
    }
  }
  return next
}

/** True when a saved row is missing, old, or its report date has passed. */
export function earningsDue(row: EarningsRow | undefined, today: string, now: number): boolean {
  if (!row) return true
  if (now - row.fetchedAt >= EARNINGS_TTL) return true
  return row.date !== null && row.date < today
}

/** The report date if it's still ahead; a saved date can pass while offline. */
export function upcomingEarnings(row: EarningsRow | undefined, today: string): string | null {
  return row?.date && row.date >= today ? row.date : null
}

/** "today", "tomorrow", "in 5 days", then the date itself from two weeks out. */
function earningsWhen(date: string, today: string): string {
  const days = daysBetween(today, date)
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  return days < 14 ? `in ${days} days` : formatDateRange(date)
}

const hourText: Record<EarningsRow['hour'], string> = {
  bmo: ' before the open',
  amc: ' after the close',
  dmh: ' during market hours',
  '': '',
}

/** e.g. "Earnings in 5 days after the close" */
export function earningsText(date: string, hour: EarningsRow['hour'], today: string): string {
  return `Earnings ${earningsWhen(date, today)}${hourText[hour]}`
}

/** A sentence for the details dialog; null until Finnhub has been asked. */
export function earningsDetail(row: EarningsRow | undefined, today: string): string | null {
  if (!row) return null
  const date = upcomingEarnings(row, today)
  if (date) return earningsText(date, row.hour, today)
  return row.noAccess
    ? "Earnings dates aren't included in your Finnhub plan."
    : 'No earnings report scheduled yet.'
}
