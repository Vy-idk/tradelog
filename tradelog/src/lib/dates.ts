/** Today's date as YYYY-MM-DD in the device's time zone (not UTC). */
export function today(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
}

/** Parses YYYY-MM-DD as a local date, so it never shifts a day across time zones. */
export function parseIsoDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Shifts a YYYY-MM-DD date by whole calendar days. */
export function addDays(value: string, days: number): string {
  const date = parseIsoDate(value)
  date.setDate(date.getDate() + days)
  return today(date)
}
