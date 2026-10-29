import { describe, expect, it } from 'vitest'
import type { Trade } from '../db/schema.ts'
import { compareNewestFirst, filterTrades, rankByUse, strategySuggestions } from './journal.ts'
import { isIsoDate, today } from './dates.ts'

function trade(overrides: Partial<Trade>): Trade {
  return {
    id: crypto.randomUUID(),
    symbol: 'AAPL',
    side: 'long',
    quantity: 1,
    entryPrice: 1,
    entryDate: '2026-10-01',
    exitPrice: null,
    exitDate: null,
    fees: 0,
    strategy: '',
    tags: [],
    notes: '',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

describe('compareNewestFirst', () => {
  it('sorts by entry date, then by when it was logged', () => {
    const a = trade({ id: 'a', entryDate: '2026-10-01', createdAt: 1 })
    const b = trade({ id: 'b', entryDate: '2026-10-03', createdAt: 0 })
    const c = trade({ id: 'c', entryDate: '2026-10-01', createdAt: 5 })
    expect([a, b, c].sort(compareNewestFirst).map((t) => t.id)).toEqual(['b', 'c', 'a'])
  })
})

describe('filterTrades', () => {
  const trades = [
    trade({ id: '1', symbol: 'AAPL', strategy: 'Breakout', tags: ['A+ setup'] }),
    trade({ id: '2', symbol: 'TSLA', strategy: 'Breakout', tags: ['mistake'] }),
    trade({ id: '3', symbol: 'AAPL', strategy: 'Earnings', tags: ['mistake', 'news'] }),
  ]
  const ids = (f: Parameters<typeof filterTrades>[1]) => filterTrades(trades, f).map((t) => t.id)

  it('returns everything with no filters', () => {
    expect(ids({ symbol: '', strategy: '', tag: '' })).toEqual(['1', '2', '3'])
  })

  it('combines filters with AND', () => {
    expect(ids({ symbol: 'AAPL', strategy: '', tag: '' })).toEqual(['1', '3'])
    expect(ids({ symbol: '', strategy: '', tag: 'mistake' })).toEqual(['2', '3'])
    expect(ids({ symbol: 'AAPL', strategy: '', tag: 'mistake' })).toEqual(['3'])
    expect(ids({ symbol: 'TSLA', strategy: 'Earnings', tag: '' })).toEqual([])
  })
})

describe('suggestions', () => {
  it('ranks by use, then alphabetically', () => {
    expect(rankByUse(['b', 'a', '', 'b', 'c', 'a', 'b'])).toEqual(['b', 'a', 'c'])
  })

  it('puts used strategies first and pads with defaults without duplicates', () => {
    const list = strategySuggestions([
      trade({ strategy: 'Gap and go' }),
      trade({ strategy: 'breakout' }),
      trade({ strategy: 'Gap and go' }),
    ])
    expect(list.slice(0, 2)).toEqual(['Gap and go', 'breakout'])
    expect(list).not.toContain('Breakout')
    expect(list).toContain('Pullback')
  })
})

describe('dates', () => {
  it('formats today in local time', () => {
    expect(today(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })

  it('validates real calendar dates', () => {
    expect(isIsoDate('2026-02-28')).toBe(true)
    expect(isIsoDate('2028-02-29')).toBe(true)
    expect(isIsoDate('2026-02-29')).toBe(false)
    expect(isIsoDate('2026-13-01')).toBe(false)
    expect(isIsoDate('')).toBe(false)
  })
})
