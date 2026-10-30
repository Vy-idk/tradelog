import { describe, expect, it } from 'vitest'
import type { Trade } from '../db/schema.ts'
import { DEFAULT_SETTINGS } from '../db/settings.ts'
import {
  accountCurrencies,
  accountValue,
  convert,
  openCost,
  parseFxRates,
  startingEquity,
  tradesIn,
  type FxRates,
} from './fx.ts'
import { tradePnl, tradeStats } from './pnl.ts'

const rates: FxRates = {
  base: 'USD',
  rates: { USD: 1, ILS: 3.5, EUR: 0.9 },
  date: '2026-10-29',
  fetchedAt: 0,
}

function trade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 'id-1',
    symbol: 'LMT',
    side: 'long',
    quantity: 4,
    entryPrice: 530,
    entryDate: '2026-05-29',
    exitPrice: 647.14,
    exitDate: '2026-10-29',
    fees: 0,
    strategy: 'Momentum',
    tags: [],
    notes: '',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('parseFxRates', () => {
  it("reads Frankfurter's answer and adds the base", () => {
    const parsed = parseFxRates(
      { amount: 1, base: 'USD', date: '2026-10-29', rates: { ILS: 3.1159, EUR: 0.89847 } },
      5,
    )
    expect(parsed).toEqual({
      base: 'USD',
      rates: { USD: 1, ILS: 3.1159, EUR: 0.89847 },
      date: '2026-10-29',
      fetchedAt: 5,
    })
  })

  it('rejects anything else', () => {
    expect(parseFxRates(null, 0)).toBeNull()
    expect(parseFxRates({ base: 'EUR', date: 'x', rates: { USD: 1 } }, 0)).toBeNull()
    expect(parseFxRates({ base: 'USD', date: 'x', rates: { ILS: -1 } }, 0)).toBeNull()
  })
})

describe('convert', () => {
  it('goes through dollars', () => {
    expect(convert(100, 'USD', 'ILS', rates)).toBeCloseTo(350)
    expect(convert(350, 'ILS', 'USD', rates)).toBeCloseTo(100)
    expect(convert(350, 'ILS', 'EUR', rates)).toBeCloseTo(90)
  })

  it('needs no rates for the same currency, and null for a missing one', () => {
    expect(convert(7, 'GBP', 'GBP', null)).toBe(7)
    expect(convert(7, 'USD', 'GBP', rates)).toBeNull()
    expect(convert(7, 'USD', 'ILS', null)).toBeNull()
  })
})

describe('tradesIn', () => {
  it('scales P&L and stats by the rate', () => {
    const t = trade({ fees: 2 })
    const [shekels] = tradesIn([t], 3.5)
    expect(tradePnl(shekels)).toBeCloseTo(tradePnl(t)! * 3.5)
    expect(
      tradeStats(tradesIn([t, trade({ id: 'b', exitPrice: null, exitDate: null })], 3.5)),
    ).toMatchObject({ closedCount: 1, openCount: 1, totalFees: 7 })
  })
})

describe('startingEquity', () => {
  const closed = trade() // +468.56 realized
  const open = trade({ id: 'open', exitPrice: null, exitDate: null, quantity: 10, entryPrice: 50 })
  const short = trade({
    id: 'short',
    side: 'short',
    exitPrice: null,
    exitDate: null,
    quantity: 2,
    entryPrice: 100,
  })

  it('converts a starting balance into the shown currency', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      startingBalance: 35_000,
      startingBalanceCurrency: 'ILS',
    }
    expect(startingEquity(settings, [closed], 'USD', rates)).toEqual({ ok: true, value: 10_000 })
    expect(startingEquity(settings, [closed], 'ILS', null)).toEqual({ ok: true, value: 35_000 })
    expect(startingEquity(settings, [closed], 'USD', null)).toEqual({ ok: false, missing: 'ILS' })
  })

  it('works back from cash today, open trades at cost and realized P&L', () => {
    expect(openCost([closed, open, short])).toBe(500 - 200)
    const settings = {
      ...DEFAULT_SETTINGS,
      balanceMode: 'current' as const,
      cashBalances: [
        { id: 'a', label: '', amount: 5_000, currency: 'USD' },
        { id: 'b', label: '', amount: 3_500, currency: 'ILS' },
      ],
    }
    const result = startingEquity(settings, [closed, open, short], 'USD', rates)
    expect(result.ok && result.value).toBeCloseTo(5_000 + 1_000 + 300 - 468.56)
    const shekels = startingEquity(settings, [closed, open, short], 'ILS', rates)
    expect(shekels.ok && shekels.value).toBeCloseTo((5_000 + 1_000 + 300 - 468.56) * 3.5)
    expect(startingEquity(settings, [closed], 'USD', null)).toEqual({ ok: false, missing: 'ILS' })
  })

  it('needs no exchange rate for a starting balance of zero', () => {
    const settings = { ...DEFAULT_SETTINGS, startingBalanceCurrency: 'ILS' }
    expect(startingEquity(settings, [closed], 'USD', null)).toEqual({ ok: true, value: 0 })
  })

  it('starts at zero before any cash is entered', () => {
    const settings = { ...DEFAULT_SETTINGS, balanceMode: 'current' as const }
    expect(startingEquity(settings, [closed], 'USD', null)).toEqual({ ok: true, value: 0 })
  })
})

describe('accountValue', () => {
  const closed = trade() // +468.56 realized
  const open = trade({
    id: 'open',
    symbol: 'VRT',
    exitPrice: null,
    exitDate: null,
    quantity: 10,
    entryPrice: 50,
    fees: 2,
  })
  const short = trade({
    id: 'short',
    symbol: 'TSLA',
    side: 'short',
    exitPrice: null,
    exitDate: null,
    quantity: 2,
    entryPrice: 100,
  })
  const prices = new Map([
    ['VRT', 40],
    ['TSLA', 90],
  ])
  const cash = {
    ...DEFAULT_SETTINGS,
    balanceMode: 'current' as const,
    cashBalances: [
      { id: 'a', label: '', amount: 5_000, currency: 'USD' },
      { id: 'b', label: '', amount: 3_500, currency: 'ILS' },
    ],
  }

  it('adds open trades at current prices to the cash held, shorts against it', () => {
    const value = accountValue(cash, [closed, open, short], prices, 'USD', rates)!
    expect(value.cash).toBeCloseTo(6_000)
    expect(value.positions).toBe(400 - 180)
    expect(value.value).toBeCloseTo(6_000 + 220)
    expect(value).toMatchObject({ open: 2, priced: 2, unrealized: -100 - 2 + 20 })
  })

  it('adds everything since to a starting balance', () => {
    const settings = { ...DEFAULT_SETTINGS, startingBalance: 10_000 }
    const value = accountValue(settings, [closed, open, short], prices, 'USD', rates)!
    expect(value.cash).toBeNull()
    expect(value.realized).toBeCloseTo(468.56)
    expect(value.value).toBeCloseTo(10_000 + 468.56 - 82)
  })

  it('counts a trade without a price at cost', () => {
    const value = accountValue(cash, [open], new Map(), 'USD', rates)!
    expect(value).toMatchObject({ positions: 500, unrealized: 0, open: 1, priced: 0 })
    expect(value.value).toBeCloseTo(6_500)
  })

  it('needs no open trades', () => {
    const value = accountValue(cash, [closed], new Map(), 'USD', rates)!
    expect(value).toMatchObject({ positions: 0, open: 0 })
    expect(value.value).toBeCloseTo(6_000)
  })

  it('converts everything into the requested currency', () => {
    const value = accountValue(cash, [closed, open, short], prices, 'ILS', rates)!
    expect(value.value).toBeCloseTo((6_000 + 220) * 3.5)
    expect(value.unrealized).toBeCloseTo(-82 * 3.5)
  })

  it('is null without the exchange rate it needs', () => {
    expect(accountValue(cash, [open], prices, 'USD', null)).toBeNull()
    expect(accountValue(DEFAULT_SETTINGS, [open], prices, 'ILS', null)).toBeNull()
  })

  it('agrees with the equity curve start in both modes', () => {
    const settings = { ...DEFAULT_SETTINGS, startingBalance: 1_000 }
    const start = startingEquity(settings, [closed], 'USD', rates)
    const value = accountValue(settings, [closed], new Map(), 'USD', rates)!
    expect(start.ok && start.value + 468.56).toBeCloseTo(value.value)
  })
})

describe('accountCurrencies', () => {
  it('lists dollars, the main currency and the balances in use', () => {
    expect(accountCurrencies({ ...DEFAULT_SETTINGS, currency: 'ILS' })).toEqual(['USD', 'ILS'])
    expect(
      accountCurrencies({
        ...DEFAULT_SETTINGS,
        balanceMode: 'current',
        cashBalances: [{ id: 'a', label: '', amount: 1, currency: 'EUR' }],
      }),
    ).toEqual(['USD', 'EUR'])
  })
})
