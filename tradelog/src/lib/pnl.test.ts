import { describe, expect, it } from 'vitest'
import { returnPct, tradePnl } from './pnl.ts'

const base = { quantity: 10, entryPrice: 100, fees: 0 }

describe('tradePnl', () => {
  it('long winner and loser', () => {
    expect(tradePnl({ ...base, side: 'long', exitPrice: 110 })).toBe(100)
    expect(tradePnl({ ...base, side: 'long', exitPrice: 95 })).toBe(-50)
  })

  it('short winner and loser', () => {
    expect(tradePnl({ ...base, side: 'short', exitPrice: 90 })).toBe(100)
    expect(tradePnl({ ...base, side: 'short', exitPrice: 105 })).toBe(-50)
  })

  it('subtracts fees', () => {
    expect(tradePnl({ ...base, side: 'long', exitPrice: 110, fees: 2.5 })).toBe(97.5)
    expect(tradePnl({ ...base, side: 'long', exitPrice: 100, fees: 1 })).toBe(-1)
  })

  it('is null while the trade is open', () => {
    expect(tradePnl({ ...base, side: 'long', exitPrice: null })).toBeNull()
  })
})

describe('returnPct', () => {
  it('is P&L over entry cost', () => {
    expect(returnPct({ ...base, side: 'long', exitPrice: 110 })).toBe(10)
    expect(returnPct({ ...base, side: 'short', exitPrice: 105, fees: 0 })).toBe(-5)
  })

  it('is null while open', () => {
    expect(returnPct({ ...base, side: 'long', exitPrice: null })).toBeNull()
  })
})
