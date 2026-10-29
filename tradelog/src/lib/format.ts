import { parseIsoDate } from './dates.ts'

const moneyFormats = new Map<string, Intl.NumberFormat>()

function moneyFormat(currency: string): Intl.NumberFormat {
  let format = moneyFormats.get(currency)
  if (!format) {
    try {
      format = new Intl.NumberFormat(undefined, { style: 'currency', currency })
    } catch {
      // An unknown currency code would throw; fall back to a plain number
      format = new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    }
    moneyFormats.set(currency, format)
  }
  return format
}

/** e.g. $1,234.50 */
export function formatMoney(value: number, currency: string): string {
  return moneyFormat(currency).format(value)
}

/** Always shows the sign, e.g. +$120.00 or −$45.10 */
export function formatSignedMoney(value: number, currency: string): string {
  const abs = moneyFormat(currency).format(Math.abs(value))
  if (Math.abs(value) < 0.005) return abs
  return `${value > 0 ? '+' : '−'}${abs}`
}

const percentFormat = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** e.g. +4.25% */
export function formatSignedPercent(value: number): string {
  const abs = percentFormat.format(Math.abs(value))
  if (Math.abs(value) < 0.005) return `${abs}%`
  return `${value > 0 ? '+' : '−'}${abs}%`
}

// Two decimals for normal prices, up to four for penny stocks
const priceFormat = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
})

export function formatPrice(value: number): string {
  return priceFormat.format(value)
}

const quantityFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 8 })

export function formatQuantity(value: number): string {
  return quantityFormat.format(value)
}

const dateWithYear = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})
const dateNoYear = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

/**
 * YYYY-MM-DD dates as "Oct 29" or a range like "Oct 1 – 29". The year is
 * only shown when a date isn't in the current year, e.g. "Dec 30, 2025 – Jan 2, 2026".
 */
export function formatDateRange(start: string, end?: string | null, now = new Date()): string {
  const year = String(now.getFullYear())
  const format =
    start.startsWith(year) && (!end || end.startsWith(year)) ? dateNoYear : dateWithYear
  if (!end || end === start) return format.format(parseIsoDate(start))
  return format.formatRange(parseIsoDate(start), parseIsoDate(end))
}
