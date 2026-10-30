import { describe, expect, it } from 'vitest'
import type { Trade } from '../db/schema.ts'
import {
  closedSince,
  dailyEquity,
  equityCurve,
  equitySince,
  holdingDays,
  maxDrawdown,
  openPositions,
  pnlByMonth,
  pnlBySide,
  pnlByStrategy,
  pnlBySymbol,
  pnlByTag,
  pnlByWeekday,
  rangeStart,
  returnPct,
  streaks,
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
      { key: '', pnl: 8, count: 1, wins: 1 },
      { key: 'Breakout', pnl: 5, count: 2, wins: 1 },
      { key: 'Earnings', pnl: -30, count: 1, wins: 0 },
    ])
  })
})

describe('pnlBySymbol', () => {
  it('puts the biggest gain or loss first, either way', () => {
    const rows = pnlBySymbol([
      trade(10, { symbol: 'AAPL' }),
      trade(-40, { symbol: 'TSLA' }),
      trade(25, { symbol: 'NVDA' }),
    ])
    expect(rows.map((r) => r.key)).toEqual(['TSLA', 'NVDA', 'AAPL'])
  })
})

describe('pnlByTag', () => {
  it('counts a trade under each of its tags, and groups the untagged', () => {
    const rows = pnlByTag([
      trade(10, { tags: ['gap', 'fomo'] }),
      trade(-4, { tags: ['fomo'] }),
      trade(1),
    ])
    expect(rows).toEqual([
      { key: 'gap', pnl: 10, count: 1, wins: 1 },
      { key: 'fomo', pnl: 6, count: 2, wins: 1 },
      { key: '', pnl: 1, count: 1, wins: 1 },
    ])
  })
})

describe('pnlBySide', () => {
  it('separates longs from shorts', () => {
    const short = trade(null, { side: 'short', exitPrice: 90, exitDate: '2026-10-02' })
    expect(pnlBySide([trade(5), short])).toEqual([
      { key: 'short', pnl: 10, count: 1, wins: 1 },
      { key: 'long', pnl: 5, count: 1, wins: 1 },
    ])
  })
})

describe('pnlByWeekday', () => {
  it('uses the exit day, Monday first and Sunday last', () => {
    const rows = pnlByWeekday([
      trade(1, { exitDate: '2026-10-25' }), // Sunday
      trade(2, { exitDate: '2026-10-30' }), // Friday
      trade(3, { exitDate: '2026-10-26' }), // Monday
    ])
    expect(rows.map((r) => r.key)).toEqual(['1', '5', '0'])
  })
})

describe('rangeStart', () => {
  const today = '2026-10-30'

  it('counts today as the last day of a rolling range', () => {
    expect(rangeStart('30d', today)).toBe('2026-10-01')
    expect(rangeStart('90d', today)).toBe('2026-08-02')
    expect(rangeStart('1y', today)).toBe('2025-10-31')
  })

  it('starts the year to date on January 1, and all time nowhere', () => {
    expect(rangeStart('ytd', today)).toBe('2026-01-01')
    expect(rangeStart('all', today)).toBeNull()
  })
})

describe('closedSince', () => {
  it('drops trades closed earlier and keeps every open trade', () => {
    const before = trade(1, { id: 'before', exitDate: '2026-09-30' })
    const on = trade(1, { id: 'on', exitDate: '2026-10-01' })
    const open = trade(null, { id: 'open', entryDate: '2020-01-01' })
    const ids = closedSince([before, on, open], '2026-10-01').map((t) => t.id)
    expect(ids).toEqual(['on', 'open'])
  })

  it('keeps everything for all time', () => {
    const trades = [trade(1)]
    expect(closedSince(trades, null)).toBe(trades)
  })
})

describe('equitySince', () => {
  const curve = equityCurve(
    [
      trade(10, { exitDate: '2026-08-10' }),
      trade(-5, { exitDate: '2026-09-10' }),
      trade(20, { exitDate: '2026-10-10' }),
    ],
    100,
  )

  it('starts from what earlier trades built up to', () => {
    const { points, start } = equitySince(curve, 100, '2026-09-01')
    expect(start).toBe(110)
    expect(points.map((p) => p.equity)).toEqual([105, 125])
  })

  it('keeps the starting balance when nothing came before', () => {
    expect(equitySince(curve, 100, '2026-01-01').start).toBe(100)
  })

  it('is empty after the last close, starting at the final equity', () => {
    expect(equitySince(curve, 100, '2026-10-11')).toEqual({ points: [], start: 125 })
  })

  it('returns the whole curve for all time', () => {
    expect(equitySince(curve, 100, null)).toEqual({ points: curve, start: 100 })
  })
})

describe('maxDrawdown', () => {
  it('measures the largest fall from a peak, as an amount and a percentage', () => {
    const curve = equityCurve(
      [
        trade(100, { exitDate: '2026-10-01' }), // 1100, the peak
        trade(-200, { exitDate: '2026-10-02' }), // 900
        trade(-120, { exitDate: '2026-10-03' }), // 780, the trough
        trade(500, { exitDate: '2026-10-04' }), // 1280, a new peak
        trade(-100, { exitDate: '2026-10-05' }), // A smaller fall
      ],
      1000,
    )
    const drawdown = maxDrawdown(curve, 1000)
    expect(drawdown.amount).toBe(-320)
    expect(drawdown.pct).toBeCloseTo((-320 / 1100) * 100)
    expect(drawdown.peakDate).toBe('2026-10-01')
    expect(drawdown.troughDate).toBe('2026-10-03')
  })

  it('counts a fall from the starting balance, with no peak date', () => {
    const curve = equityCurve([trade(-50, { exitDate: '2026-10-01' })], 1000)
    expect(maxDrawdown(curve, 1000)).toEqual({
      amount: -50,
      pct: -5,
      peakDate: null,
      troughDate: '2026-10-01',
    })
  })

  it('looks at end-of-day equity, not the order of trades within a day', () => {
    const curve = equityCurve(
      [
        trade(-30, { exitDate: '2026-10-01', createdAt: 1 }),
        trade(30, { exitDate: '2026-10-01', createdAt: 2 }),
      ],
      100,
    )
    expect(maxDrawdown(curve, 100).amount).toBe(0)
  })

  it('has no percentage without a balance above zero', () => {
    const curve = equityCurve([trade(-50, { exitDate: '2026-10-01' })], 0)
    expect(maxDrawdown(curve, 0)).toMatchObject({ amount: -50, pct: null })
  })

  it('is zero when equity only rises, or with no trades', () => {
    const curve = equityCurve([trade(5), trade(5)], 100)
    expect(maxDrawdown(curve, 100).amount).toBe(0)
    expect(maxDrawdown([], 100).troughDate).toBeNull()
  })
})

describe('streaks', () => {
  const exits = (...pnls: number[]) =>
    pnls.map((pnl, i) =>
      trade(pnl, { exitDate: `2026-10-${String(i + 1).padStart(2, '0')}`, entryDate: '2026-09-01' }),
    )

  it('finds the longest runs and the current one', () => {
    expect(streaks(exits(1, 1, 1, -1, -1, 1))).toEqual({
      longestWin: 3,
      longestLoss: 2,
      current: 1,
    })
  })

  it('reports a current losing run as negative', () => {
    expect(streaks(exits(1, -1, -1)).current).toBe(-2)
  })

  it('lets break-even trades pass without ending a run', () => {
    expect(streaks(exits(1, 0, 1, 0, 1))).toEqual({ longestWin: 3, longestLoss: 0, current: 3 })
  })

  it('follows exit order and ignores open trades', () => {
    const later = trade(-1, { exitDate: '2026-10-20' })
    const earlier = trade(1, { exitDate: '2026-10-10' })
    expect(streaks([later, trade(null), earlier]).current).toBe(-1)
  })

  it('is empty with no closed trades', () => {
    expect(streaks([])).toEqual({ longestWin: 0, longestLoss: 0, current: 0 })
  })
})

describe('holdingDays', () => {
  it('averages calendar days, overall and for winners and losers', () => {
    const held = holdingDays([
      trade(5, { entryDate: '2026-10-01', exitDate: '2026-10-03' }),
      trade(5, { entryDate: '2026-10-01', exitDate: '2026-10-05' }),
      trade(-5, { entryDate: '2026-10-01', exitDate: '2026-10-10' }),
      trade(0, { entryDate: '2026-10-01', exitDate: '2026-10-01' }),
      trade(null),
    ])
    expect(held.all).toBe(15 / 4)
    expect(held.wins).toBe(3)
    expect(held.losses).toBe(9)
  })

  it('is null with nothing to average', () => {
    expect(holdingDays([trade(5)]).losses).toBeNull()
    expect(holdingDays([]).all).toBeNull()
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
