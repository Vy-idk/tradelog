import { describe, expect, it } from 'vitest'
import type { Trade } from '../db/schema.ts'
import { feeShare, groupPositions, sharesLeft, splitTrade } from './positions.ts'
import { tradePnl, tradeStats } from './pnl.ts'

function trade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 'a',
    symbol: 'VRT',
    side: 'long',
    quantity: 4,
    entryPrice: 200,
    entryDate: '2026-09-01',
    exitPrice: null,
    exitDate: null,
    fees: 0,
    strategy: 'Momentum',
    tags: ['ai'],
    notes: 'Data centers',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('groupPositions', () => {
  it('combines lots of a symbol, averaging the entry by shares', () => {
    const lots = [
      trade({ id: 'a', quantity: 3, entryPrice: 300, fees: 2 }),
      trade({ id: 'b', quantity: 1, entryPrice: 200 }),
    ]
    const [position, ...rest] = groupPositions(lots, new Map([['VRT', 250]]))
    expect(rest).toEqual([])
    expect(position).toMatchObject({
      key: 'VRT:long',
      symbol: 'VRT',
      side: 'long',
      quantity: 4,
      avgEntry: 275,
      costBasis: 1100,
      unrealizedPnl: -150 + 50 - 2,
    })
    expect(position.returnPct).toBeCloseTo((-102 / 1100) * 100)
    expect(position.lots.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('keeps a long and a short in the same symbol apart', () => {
    const positions = groupPositions(
      [trade({ id: 'a' }), trade({ id: 'b', side: 'short' })],
      new Map(),
    )
    expect(positions.map((p) => p.key)).toEqual(['VRT:long', 'VRT:short'])
  })

  it('has no P&L without a price, but still totals the shares', () => {
    const [position] = groupPositions([trade()], new Map())
    expect(position).toMatchObject({ quantity: 4, unrealizedPnl: null, returnPct: null })
  })

  it('keeps the order positions first appear in', () => {
    const positions = groupPositions(
      [
        trade({ id: 'a', symbol: 'NVDA' }),
        trade({ id: 'b', symbol: 'AAPL' }),
        trade({ id: 'c', symbol: 'NVDA' }),
      ],
      new Map(),
    )
    expect(positions.map((p) => p.symbol)).toEqual(['NVDA', 'AAPL'])
  })

  it('clears floating-point dust from fractional shares', () => {
    const lots = [trade({ id: 'a', quantity: 0.1 }), trade({ id: 'b', quantity: 0.2 })]
    expect(groupPositions(lots, new Map())[0].quantity).toBe(0.3)
  })
})

describe('feeShare', () => {
  it('shares fees by shares, to the cent', () => {
    expect(feeShare(10, 1, 4)).toBe(2.5)
    expect(feeShare(1, 1, 3)).toBe(0.33)
    expect(feeShare(0, 1, 3)).toBe(0)
  })
})

describe('sharesLeft', () => {
  it('subtracts, keeping fractions clean', () => {
    expect(sharesLeft(4, 1)).toBe(3)
    expect(sharesLeft(0.3, 0.1)).toBe(0.2)
  })

  it('is zero for closing it all, more than held, or all but a rounding error', () => {
    expect(sharesLeft(4, 4)).toBe(0)
    expect(sharesLeft(4, 5)).toBe(0)
    expect(sharesLeft(4, 3.999999999)).toBe(0)
  })
})

describe('splitTrade', () => {
  const close = { quantity: 1, exitPrice: 250, exitDate: '2026-10-30', fees: 3 }

  it('closes the sold shares in a new trade and leaves the rest open', () => {
    const { closed, open } = splitTrade(trade({ fees: 4 }), close, 'b', 99)
    expect(closed).toMatchObject({
      id: 'b',
      partOf: 'a',
      quantity: 1,
      exitPrice: 250,
      exitDate: '2026-10-30',
      fees: 3,
      updatedAt: 99,
    })
    expect(open).toMatchObject({
      id: 'a',
      quantity: 3,
      exitPrice: null,
      exitDate: null,
      fees: 3,
      updatedAt: 99,
    })
    expect(open.partOf).toBeUndefined()
  })

  it('carries the entry, strategy, tags and notes to both parts', () => {
    const { closed, open } = splitTrade(trade(), close, 'b', 99)
    for (const part of [closed, open]) {
      expect(part).toMatchObject({
        symbol: 'VRT',
        side: 'long',
        entryPrice: 200,
        entryDate: '2026-09-01',
        strategy: 'Momentum',
        tags: ['ai'],
        notes: 'Data centers',
        createdAt: 1,
      })
    }
  })

  it('keeps the shares and realized P&L adding up', () => {
    const original = trade({ quantity: 4, fees: 4 })
    const { closed, open } = splitTrade(original, { ...close, fees: 1 }, 'b', 99)
    expect(closed.quantity + open.quantity).toBe(original.quantity)
    expect(closed.fees + open.fees).toBe(original.fees)
    expect(tradePnl(closed)).toBe(50 - 1)
    expect(tradeStats([closed, open])).toMatchObject({ closedCount: 1, openCount: 1 })
  })

  it('leaves fractional shares clean', () => {
    const { open } = splitTrade(trade({ quantity: 0.3 }), { ...close, quantity: 0.1 }, 'b', 99)
    expect(open.quantity).toBe(0.2)
  })

  it('leaves the fees on the open part clean too', () => {
    const { open } = splitTrade(trade({ quantity: 3, fees: 1 }), close, 'b', 99)
    expect(open.fees).toBe(0.67)
  })

  it('never leaves negative fees on the open part', () => {
    const { open } = splitTrade(trade({ fees: 0.01 }), { ...close, quantity: 3 }, 'b', 99)
    expect(open.fees).toBeGreaterThanOrEqual(0)
  })
})
