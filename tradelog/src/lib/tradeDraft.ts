import type { Side, Trade, TradeInput } from '../db/schema.ts'
import { isIsoDate } from './dates.ts'

/** What the trade form edits: numbers stay as typed text until validation. */
export type TradeDraft = {
  symbol: string
  side: Side
  quantity: string
  entryPrice: string
  entryDate: string
  exitPrice: string
  exitDate: string
  fees: string
  strategy: string
  tags: string[]
  notes: string
}

export type DraftField = keyof TradeDraft
export type DraftErrors = Partial<Record<DraftField, string>>

export type DraftResult = { ok: true; value: TradeInput } | { ok: false; errors: DraftErrors }

/** Form fields in screen order, used to focus the first invalid one. */
export const FIELD_ORDER: DraftField[] = [
  'symbol',
  'side',
  'quantity',
  'entryPrice',
  'entryDate',
  'exitPrice',
  'exitDate',
  'fees',
  'strategy',
  'tags',
  'notes',
]

const MAX_NUMBER = 1e12

export function emptyDraft(entryDate: string): TradeDraft {
  return {
    symbol: '',
    side: 'long',
    quantity: '',
    entryPrice: '',
    entryDate,
    exitPrice: '',
    exitDate: '',
    fees: '',
    strategy: '',
    tags: [],
    notes: '',
  }
}

function numberText(value: number): string {
  // Avoid exponent notation (1e-7) for tiny values
  return Math.abs(value) < 1e-6 && value !== 0
    ? value.toFixed(10).replace(/0+$/, '')
    : String(value)
}

export function draftFromTrade(trade: Trade): TradeDraft {
  return {
    symbol: trade.symbol,
    side: trade.side,
    quantity: numberText(trade.quantity),
    entryPrice: numberText(trade.entryPrice),
    entryDate: trade.entryDate,
    exitPrice: trade.exitPrice === null ? '' : numberText(trade.exitPrice),
    exitDate: trade.exitDate ?? '',
    fees: trade.fees === 0 ? '' : numberText(trade.fees),
    strategy: trade.strategy,
    tags: [...trade.tags],
    notes: trade.notes,
  }
}

/**
 * Parses a typed number. Returns null for blank input and NaN for anything
 * that isn't a plain decimal. A lone comma is read as the decimal separator,
 * since that's what the iOS decimal keypad shows in many regions.
 */
export function parseNumber(text: string): number | null {
  let s = text.trim().replace(/\s+/g, '')
  if (s === '') return null
  if (!s.includes('.') && (s.match(/,/g) ?? []).length === 1) s = s.replace(',', '.')
  if (!/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return Number.NaN
  return Number(s)
}

export function normalizeSymbol(text: string): string {
  return text.trim().toUpperCase()
}

/** Trims and collapses whitespace; empty string means "not a tag". */
export function normalizeTag(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

/** Adds a tag unless it's blank or already present (case-insensitive). */
export function addTag(tags: string[], text: string): string[] {
  const tag = normalizeTag(text)
  if (!tag || tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return tags
  return [...tags, tag]
}

function isNegative(text: string): boolean {
  return /^-\s*\d/.test(text.trim())
}

function checkPositive(text: string, label: string): { value?: number; error?: string } {
  const value = parseNumber(text)
  if (value === null) return { error: `${label} is required` }
  if (isNegative(text)) return { error: `${label} must be more than 0` }
  if (Number.isNaN(value)) return { error: 'Enter a number, e.g. 12.5' }
  if (value <= 0) return { error: `${label} must be more than 0` }
  if (value > MAX_NUMBER) return { error: 'That number is too large' }
  return { value }
}

export function validateDraft(draft: TradeDraft): DraftResult {
  const errors: DraftErrors = {}

  const symbol = normalizeSymbol(draft.symbol)
  if (!symbol) errors.symbol = 'Symbol is required'
  else if (symbol.length > 15) errors.symbol = 'Use 15 characters or fewer'
  else if (!/^[A-Z0-9][A-Z0-9.\-/:^=]*$/.test(symbol))
    errors.symbol = 'Use letters, numbers and . - / : only'

  if (draft.side !== 'long' && draft.side !== 'short') errors.side = 'Pick long or short'

  const quantity = checkPositive(draft.quantity, 'Quantity')
  if (quantity.error) errors.quantity = quantity.error

  const entryPrice = checkPositive(draft.entryPrice, 'Entry price')
  if (entryPrice.error) errors.entryPrice = entryPrice.error

  if (!draft.entryDate) errors.entryDate = 'Entry date is required'
  else if (!isIsoDate(draft.entryDate)) errors.entryDate = 'Enter a valid date'

  // Exit price and date go together: both blank means the trade is open
  let exitPrice: number | null = null
  let exitDate: string | null = null
  const hasExitPrice = draft.exitPrice.trim() !== ''
  const hasExitDate = draft.exitDate !== ''
  if (hasExitPrice || hasExitDate) {
    if (!hasExitPrice) errors.exitPrice = 'Add the exit price, or clear the exit date'
    else {
      const exit = checkPositive(draft.exitPrice, 'Exit price')
      if (exit.error) errors.exitPrice = exit.error
      else exitPrice = exit.value!
    }
    if (!hasExitDate) errors.exitDate = 'Add the exit date, or clear the exit price'
    else if (!isIsoDate(draft.exitDate)) errors.exitDate = 'Enter a valid date'
    else if (isIsoDate(draft.entryDate) && draft.exitDate < draft.entryDate)
      errors.exitDate = 'Exit date is before the entry date'
    else exitDate = draft.exitDate
  }

  let fees = 0
  const parsedFees = parseNumber(draft.fees)
  if (parsedFees !== null) {
    if (isNegative(draft.fees)) errors.fees = "Fees can't be negative"
    else if (Number.isNaN(parsedFees)) errors.fees = 'Enter a number, e.g. 1.5'
    else if (parsedFees > MAX_NUMBER) errors.fees = 'That number is too large'
    else fees = parsedFees
  }

  const strategy = draft.strategy.trim().replace(/\s+/g, ' ')
  if (strategy.length > 40) errors.strategy = 'Use 40 characters or fewer'

  if (Object.keys(errors).length > 0) return { ok: false, errors }

  return {
    ok: true,
    value: {
      symbol,
      side: draft.side,
      quantity: quantity.value!,
      entryPrice: entryPrice.value!,
      entryDate: draft.entryDate,
      exitPrice,
      exitDate,
      fees,
      strategy,
      tags: draft.tags.reduce(addTag, [] as string[]),
      notes: draft.notes.trim(),
    },
  }
}

export function draftsEqual(a: TradeDraft, b: TradeDraft): boolean {
  return (FIELD_ORDER as DraftField[]).every((key) =>
    key === 'tags' ? a.tags.join('\n') === b.tags.join('\n') : a[key] === b[key],
  )
}
