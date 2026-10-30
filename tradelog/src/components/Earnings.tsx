import type { EarningsRow } from '../db/schema.ts'
import { daysBetween } from '../lib/dates.ts'
import {
  EARNINGS_ROW_DAYS,
  EARNINGS_SOON_DAYS,
  earningsText,
  upcomingEarnings,
} from '../lib/earnings.ts'

/** A list row's line about an earnings report coming up, in amber when it's close. */
export function EarningsNote({ row, today }: { row: EarningsRow | undefined; today: string }) {
  const date = upcomingEarnings(row, today)
  if (!row || !date) return null
  const days = daysBetween(today, date)
  if (days > EARNINGS_ROW_DAYS) return null
  const color = days <= EARNINGS_SOON_DAYS ? 'text-amber-300' : 'text-muted'
  return (
    <p className={`mt-0.5 truncate text-xs ${color}`}>{earningsText(date, row.hour, today)}</p>
  )
}
