import { describe, expect, it } from 'vitest'
import type { Trade } from '../db/schema.ts'
import {
  addTag,
  draftFromTrade,
  draftsEqual,
  emptyDraft,
  parseNumber,
  validateDraft,
  type TradeDraft,
} from './tradeDraft.ts'

const valid: TradeDraft = {
  ...emptyDraft('2026-10-01'),
  symbol: 'aapl',
  quantity: '100',
  entryPrice: '189.5',
}

describe('parseNumber', () => {
  it('reads plain decimals', () => {
    expect(parseNumber('12')).toBe(12)
    expect(parseNumber(' 12.50 ')).toBe(12.5)
    expect(parseNumber('.5')).toBe(0.5)
    expect(parseNumber('5.')).toBe(5)
  })

  it('reads a lone comma as the decimal separator', () => {
    expect(parseNumber('12,5')).toBe(12.5)
  })

  it('returns null for blank and NaN for junk', () => {
    expect(parseNumber('')).toBeNull()
    expect(parseNumber('   ')).toBeNull()
    expect(parseNumber('abc')).toBeNaN()
    expect(parseNumber('1.2.3')).toBeNaN()
    expect(parseNumber('0x10')).toBeNaN()
    expect(parseNumber('Infinity')).toBeNaN()
    expect(parseNumber('-5')).toBeNaN()
  })
})

describe('validateDraft', () => {
  it('accepts a minimal open trade and normalizes it', () => {
    const result = validateDraft({ ...valid, symbol: ' aapl ', strategy: '  Break   out ' })
    expect(result).toEqual({
      ok: true,
      value: {
        symbol: 'AAPL',
        side: 'long',
        quantity: 100,
        entryPrice: 189.5,
        entryDate: '2026-10-01',
        exitPrice: null,
        exitDate: null,
        fees: 0,
        strategy: 'Break out',
        tags: [],
        notes: '',
      },
    })
  })

  it('requires symbol, quantity, entry price and entry date', () => {
    const result = validateDraft(emptyDraft(''))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(Object.keys(result.errors).sort()).toEqual(
      ['entryDate', 'entryPrice', 'quantity', 'symbol'].sort(),
    )
  })

  it('rejects zero, negative and non-numeric amounts', () => {
    for (const quantity of ['0', '-3', 'ten']) {
      const result = validateDraft({ ...valid, quantity })
      expect(result.ok, quantity).toBe(false)
      if (!result.ok) expect(result.errors.quantity).toBeTruthy()
    }
    const negative = validateDraft({ ...valid, entryPrice: '-1' })
    expect(!negative.ok && negative.errors.entryPrice).toBe('Entry price must be more than 0')
  })

  it('rejects symbols with spaces or odd characters', () => {
    for (const symbol of ['AA PL', '$AAPL', '.AAPL', 'A'.repeat(16)]) {
      expect(validateDraft({ ...valid, symbol }).ok, symbol).toBe(false)
    }
    for (const symbol of ['BRK.B', 'BTC-USD', 'TEVA.TA', 'ES=F']) {
      expect(validateDraft({ ...valid, symbol }).ok, symbol).toBe(true)
    }
  })

  it('allows zero fees but not negative fees', () => {
    expect(validateDraft({ ...valid, fees: '0' }).ok).toBe(true)
    const result = validateDraft({ ...valid, fees: '-1' })
    expect(!result.ok && result.errors.fees).toBe("Fees can't be negative")
  })

  it('needs exit price and exit date together', () => {
    const priceOnly = validateDraft({ ...valid, exitPrice: '200' })
    expect(!priceOnly.ok && priceOnly.errors.exitDate).toBeTruthy()

    const dateOnly = validateDraft({ ...valid, exitDate: '2026-10-05' })
    expect(!dateOnly.ok && dateOnly.errors.exitPrice).toBeTruthy()

    const both = validateDraft({ ...valid, exitPrice: '200', exitDate: '2026-10-05', fees: '2' })
    expect(both.ok && both.value).toMatchObject({ exitPrice: 200, exitDate: '2026-10-05', fees: 2 })
  })

  it('rejects an exit before the entry, but allows same-day trades', () => {
    const before = validateDraft({ ...valid, exitPrice: '200', exitDate: '2026-09-30' })
    expect(!before.ok && before.errors.exitDate).toBe('Exit date is before the entry date')
    expect(validateDraft({ ...valid, exitPrice: '200', exitDate: '2026-10-01' }).ok).toBe(true)
  })

  it('rejects impossible dates', () => {
    expect(validateDraft({ ...valid, entryDate: '2026-02-30' }).ok).toBe(false)
    expect(validateDraft({ ...valid, entryDate: '10/01/2026' }).ok).toBe(false)
  })

  it('dedupes tags case-insensitively', () => {
    const result = validateDraft({ ...valid, tags: ['A+ setup', 'a+ setup', ' mistake '] })
    expect(result.ok && result.value.tags).toEqual(['A+ setup', 'mistake'])
  })
})

describe('addTag', () => {
  it('trims, collapses spaces and skips blanks and duplicates', () => {
    expect(addTag([], '  A+   setup ')).toEqual(['A+ setup'])
    expect(addTag(['mistake'], 'Mistake')).toEqual(['mistake'])
    expect(addTag(['mistake'], '   ')).toEqual(['mistake'])
  })
})

describe('draftFromTrade', () => {
  const trade: Trade = {
    id: 'x',
    symbol: 'TSLA',
    side: 'short',
    quantity: 10,
    entryPrice: 250.25,
    entryDate: '2026-10-01',
    exitPrice: null,
    exitDate: null,
    fees: 0,
    strategy: 'Earnings',
    tags: ['news'],
    notes: 'Gap fill',
    createdAt: 1,
    updatedAt: 1,
  }

  it('round-trips through validation unchanged', () => {
    const result = validateDraft(draftFromTrade(trade))
    expect(result).toEqual({
      ok: true,
      value: {
        symbol: 'TSLA',
        side: 'short',
        quantity: 10,
        entryPrice: 250.25,
        entryDate: '2026-10-01',
        exitPrice: null,
        exitDate: null,
        fees: 0,
        strategy: 'Earnings',
        tags: ['news'],
        notes: 'Gap fill',
      },
    })
  })

  it('writes tiny numbers without exponent notation', () => {
    expect(draftFromTrade({ ...trade, entryPrice: 0.0000001 }).entryPrice).toBe('0.0000001')
  })

  it('compares drafts by value', () => {
    expect(draftsEqual(draftFromTrade(trade), draftFromTrade(trade))).toBe(true)
    expect(draftsEqual(draftFromTrade(trade), { ...draftFromTrade(trade), tags: [] })).toBe(false)
  })
})
