import { describe, expect, it } from 'vitest'
import type { Trade } from '../db/schema.ts'
import {
  dailyEquity,
  equityCurve,
  openPositions,
  pnlByMonth,
  pnlByStrategy,
  returnPct,
  tradePnl,
  tradeStats,
  unrealizedPnl,
  unrealizedReturnPct,
} from './pnl.ts'

const base = { quantity: 10, entryPrice: 100, fees: 0 }

let seq = 0
/** A closed long of 1 share that makes exactly `pnl`, unless overridden. */
function trade(pnl: number | null, overrides: Partial<Trade> = {}): Trade {
  seq++
  return {
    id: `t${seq}`,
    symbol: 'AAPL',
    side: 'long',
    quantity: 1,
    entryPrice: 100,
    entryDate: '2026-10-01',
    exitPrice: pnl === null ? null : 100 + pnl,
    exitDate: pnl === null ? null : '2026-10-02',
    fees: 0,
    strategy: '',
    tags: [],
    notes: '',
    createdAt: seq,
    updatedAt: seq,
    ...overrides,
  }
}

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
    expect(tradePnl({ ...base, side: 'short', exitPrice: 90, fees: 4 })).toBe(96)
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

describe('tradeStats', () => {
  it('handles zero trades without dividing by zero', () => {
    const s = tradeStats([])
    expect(s.closedCount).toBe(0)
    expect(s.totalPnl).toBe(0)
    expect(s.winRate).toBeNull()
    expect(s.profitFactor).toBeNull()
    expect(s.avgWin).toBeNull()
    expect(s.avgLoss).toBeNull()
    expect(s.avgTrade).toBeNull()
  })

  it('handles only open trades the same way', () => {
    const s = tradeStats([trade(null), trade(null)])
    expect(s.openCount).toBe(2)
    expect(s.closedCount).toBe(0)
    expect(s.winRate).toBeNull()
    expect(s.profitFactor).toBeNull()
  })

  it('excludes open trades from win rate and realized P&L', () => {
    const s = tradeStats([trade(30), trade(-10), trade(null), trade(null, { entryPrice: 5 })])
    expect(s.closedCount).toBe(2)
    expect(s.openCount).toBe(2)
    expect(s.totalPnl).toBe(20)
    expect(s.winRate).toBe(0.5)
  })

  it('computes averages, profit factor and extremes', () => {
    const s = tradeStats([trade(100), trade(50), trade(-20), trade(-30), trade(0)])
    expect(s.wins).toBe(2)
    expect(s.losses).toBe(2)
    expect(s.breakeven).toBe(1)
    // Break-even trades count as closed but not as wins
    expect(s.winRate).toBe(0.4)
    expect(s.totalPnl).toBe(100)
    expect(s.grossProfit).toBe(150)
    expect(s.grossLoss).toBe(-50)
    expect(s.avgWin).toBe(75)
    expect(s.avgLoss).toBe(-25)
    expect(s.avgTrade).toBe(20)
    expect(s.profitFactor).toBe(3)
    expect(s.largestWin).toBe(100)
    expect(s.largestLoss).toBe(-30)
  })

  it('reports an infinite profit factor with wins and no losses', () => {
    const s = tradeStats([trade(10), trade(5)])
    expect(s.profitFactor).toBe(Infinity)
    expect(s.winRate).toBe(1)
    expect(s.avgLoss).toBeNull()
  })

  it('has a zero profit factor with losses and no wins', () => {
    const s = tradeStats([trade(-10)])
    expect(s.profitFactor).toBe(0)
    expect(s.winRate).toBe(0)
  })

  it('counts fees towards P&L and a fee-only loss as a loss', () => {
    const s = tradeStats([trade(10, { fees: 2 }), trade(0, { fees: 1 })])
    expect(s.totalPnl).toBe(7)
    expect(s.totalFees).toBe(3)
    expect(s.wins).toBe(1)
    expect(s.losses).toBe(1)
  })

  it('treats floating-point dust as break-even', () => {
    // (0.3 − 0.1) × 3 − 0.6 isn't exactly 0 in floating point
    const dust = trade(null, { entryPrice: 0.1, exitPrice: 0.3, exitDate: '2026-10-02' })
    const s = tradeStats([{ ...dust, quantity: 3, fees: 0.6 }])
    expect(s.wins + s.losses).toBe(0)
    expect(s.breakeven).toBe(1)
  })
})

describe('equityCurve', () => {
  it('orders by exit date, not entry date or the order logged', () => {
    const late = trade(10, { id: 'late', entryDate: '2026-09-01', exitDate: '2026-10-20' })
    const early = trade(-5, { id: 'early', entryDate: '2026-10-05', exitDate: '2026-10-06' })
    const mid = trade(20, { id: 'mid', entryDate: '2026-10-01', exitDate: '2026-10-10' })
    const curve = equityCurve([late, trade(null), early, mid], 1000)
    expect(curve.map((p) => p.tradeId)).toEqual(['early', 'mid', 'late'])
    expect(curve.map((p) => p.equity)).toEqual([995, 1015, 1025])
    expect(curve.map((p) => p.date)).toEqual(['2026-10-06', '2026-10-10', '2026-10-20'])
  })

  it('breaks same-day ties by entry date, then by when logged', () => {
    const a = trade(1, { id: 'a', entryDate: '2026-10-02', createdAt: 1 })
    const b = trade(1, { id: 'b', entryDate: '2026-10-01', createdAt: 9 })
    const c = trade(1, { id: 'c', entryDate: '2026-10-02', createdAt: 0 })
    expect(equityCurve([a, b, c], 0).map((p) => p.tradeId)).toEqual(['b', 'c', 'a'])
  })

  it('is empty with no closed trades', () => {
    expect(equityCurve([trade(null)], 500)).toEqual([])
  })

  it('collapses to end-of-day equity', () => {
    const curve = equityCurve(
      [
        trade(10, { exitDate: '2026-10-02' }),
        trade(-4, { exitDate: '2026-10-02' }),
        trade(3, { exitDate: '2026-10-05' }),
      ],
      100,
    )
    expect(dailyEquity(curve)).toEqual([
      { date: '2026-10-02', equity: 106 },
      { date: '2026-10-05', equity: 109 },
    ])
  })
})

describe('pnlByMonth', () => {
  it('groups by exit month and fills empty months, across a year end', () => {
    const rows = pnlByMonth([
      trade(10, { exitDate: '2026-02-03' }),
      trade(null),
      trade(-4, { entryDate: '2025-11-01', exitDate: '2025-11-30' }),
      trade(5, { exitDate: '2026-02-27' }),
    ])
    expect(rows).toEqual([
      { month: '2025-11', pnl: -4, count: 1 },
      { month: '2025-12', pnl: 0, count: 0 },
      { month: '2026-01', pnl: 0, count: 0 },
      { month: '2026-02', pnl: 15, count: 2 },
    ])
  })

  it('is empty with no closed trades', () => {
    expect(pnlByMonth([])).toEqual([])
  })
})

describe('pnlByStrategy', () => {
  it('totals each strategy, best first, with blank strategies grouped', () => {
    const rows = pnlByStrategy([
      trade(10, { strategy: 'Breakout' }),
      trade(-30, { strategy: 'Earnings' }),
      trade(-5, { strategy: 'Breakout' }),
      trade(8),
      trade(50, { strategy: 'Breakout', exitPrice: null, exitDate: null }),
    ])
    expect(rows).toEqual([
      { strategy: '', pnl: 8, count: 1, wins: 1 },
      { strategy: 'Breakout', pnl: 5, count: 2, wins: 1 },
      { strategy: 'Earnings', pnl: -30, count: 1, wins: 0 },
    ])
  })
})

describe('unrealizedPnl', () => {
  it('uses the current price as the exit, for longs and shorts', () => {
    expect(unrealizedPnl({ ...base, side: 'long' }, 112)).toBe(120)
    expect(unrealizedPnl({ ...base, side: 'long' }, 95)).toBe(-50)
    expect(unrealizedPnl({ ...base, side: 'short' }, 95)).toBe(50)
    expect(unrealizedPnl({ ...base, side: 'short' }, 112)).toBe(-120)
  })

  it('subtracts the fees logged so far', () => {
    expect(unrealizedPnl({ ...base, side: 'long', fees: 4 }, 110)).toBe(96)
  })

  it('gives the return on the capital put in', () => {
    expect(unrealizedReturnPct({ ...base, side: 'long' }, 105)).toBe(5)
    expect(unrealizedReturnPct({ ...base, side: 'short' }, 105)).toBe(-5)
  })
})

describe('openPositions', () => {
  it('totals open trades that have a price and counts the rest', () => {
    const trades = [
      trade(null, { symbol: 'AAPL', quantity: 10 }),
      trade(null, { symbol: 'TSLA', side: 'short', entryPrice: 200, quantity: 2, fees: 1 }),
      trade(null, { symbol: 'NOPE' }),
      // Closed trades are ignored, even with a price
      trade(25, { symbol: 'AAPL' }),
    ]
    const prices = new Map([
      ['AAPL', 103],
      ['TSLA', 190],
    ])
    expect(openPositions(trades, prices)).toEqual({
      count: 3,
      priced: 2,
      unrealizedPnl: 30 + 19,
      costBasis: 1000 + 400,
    })
  })

  it('is all zeros without open trades', () => {
    expect(openPositions([trade(5)], new Map())).toEqual({
      count: 0,
      priced: 0,
      unrealizedPnl: 0,
      costBasis: 0,
    })
  })
})
