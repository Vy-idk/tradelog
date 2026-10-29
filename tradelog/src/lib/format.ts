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

const AXIS_UNITS = [
  { size: 1e9, suffix: 'B' },
  { size: 1e6, suffix: 'M' },
  { size: 1e3, suffix: 'K' },
]

/** Decimal places in a number like 0.25 (2) or 500 (0). */
function decimalPlaces(value: number): number {
  const [, fraction = ''] = String(Number(value.toPrecision(6))).split('.')
  return fraction.length
}

/**
 * Labels for a money axis with evenly spaced ticks. One unit for the whole
 * axis ($25K, $25.5K, $26K) when every label stays exact and short,
 * otherwise full amounts ($25,000, $25,010).
 */
export function axisMoneyFormatter(ticks: number[], currency: string): (value: number) => string {
  const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 0
  const largest = Math.max(...ticks.map(Math.abs), 0)
  const unit = AXIS_UNITS.find(({ size, suffix }) => {
    // Thousands only from 10K: $2,500 reads better than $2.5K
    const leading = largest / size
    if (leading < (suffix === 'K' ? 10 : 1)) return false
    // Two decimals only for a single leading digit, like $1.25M
    return decimalPlaces(step / size) <= (leading < 10 ? 2 : 1)
  })

  const digits = unit ? decimalPlaces(step / unit.size) : step >= 1 || step === 0 ? 0 : 2
  const options: Intl.NumberFormatOptions = unit
    ? { minimumFractionDigits: 0, maximumFractionDigits: digits }
    : { minimumFractionDigits: digits, maximumFractionDigits: digits }
  let format: Intl.NumberFormat
  try {
    format = new Intl.NumberFormat(undefined, { ...options, style: 'currency', currency })
  } catch {
    format = new Intl.NumberFormat(undefined, options)
  }

  return (value: number) => {
    const parts = format.formatToParts(Math.abs(value) / (unit?.size ?? 1))
    if (unit) {
      // The suffix goes right after the digits, before a trailing symbol (25,5K €)
      let last = -1
      parts.forEach((p, i) => {
        if (p.type === 'integer' || p.type === 'fraction') last = i
      })
      parts.splice(last + 1, 0, { type: 'literal', value: unit.suffix })
    }
    const text = parts.map((p) => p.value).join('')
    return value < 0 ? `−${text}` : text
  }
}

const ratioPercentFormat = new Intl.NumberFormat(undefined, {
  style: 'percent',
  maximumFractionDigits: 1,
})

/** A 0–1 ratio as a percentage, e.g. 0.583 → 58.3% */
export function formatRatioPercent(ratio: number): string {
  return ratioPercentFormat.format(ratio)
}

const factorFormat = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** e.g. 1.85, or ∞ when there's nothing to divide by */
export function formatFactor(value: number): string {
  return Number.isFinite(value) ? factorFormat.format(value) : '∞'
}

const monthShort = new Intl.DateTimeFormat(undefined, { month: 'short' })
const monthLong = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })

/**
 * YYYY-MM as "Oct", or "Oct '25" when the year matters ("Oct 25" would read
 * as a day). Long form for tooltips: "October 2025".
 */
export function formatMonth(month: string, style: 'short' | 'year' | 'long' = 'short'): string {
  const [y, m] = month.split('-').map(Number)
  const date = new Date(y, m - 1, 1)
  if (style === 'long') return monthLong.format(date)
  const name = monthShort.format(date)
  return style === 'year' ? `${name} '${String(y).slice(2)}` : name
}

const relativeDays = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

/** A past timestamp as "today", "yesterday" or "5 days ago" (calendar days, local time) */
export function formatDaysAgo(timestamp: number, now = new Date()): string {
  const then = new Date(timestamp)
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000)
  return relativeDays.format(-Math.max(0, days), 'day')
}
