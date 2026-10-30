import { describe, expect, it } from 'vitest'
import type { CashBalance, Settings, Trade } from '../db/schema.ts'
import {
  cashNotes,
  moveCash,
  planClose,
  planDelete,
  planSave,
  tracksCash,
  withCashMoved,
  worthTelling,
} from './cash.ts'
import { startingEquity, type FxRates } from './fx.ts'
import { equityCurve } from './pnl.ts'

const rates: FxRates = {
  base: 'USD',
  rates: { USD: 1, ILS: 3.5, EUR: 0.9 },
  date: '2026-10-29',
  fetchedAt: 0,
}

const usd = (amount: number, id = 'usd'): CashBalance => ({
  id,
  label: '',
  amount,
  currency: 'USD',
})
const ils = (amount: number): CashBalance => ({ id: 'ils', label: '', amount, currency: 'ILS' })
const eur = (amount: number): CashBalance => ({ id: 'eur', label: '', amount, currency: 'EUR' })

const makeId = () => 'new'

// Fixed to en-US: the app's own formatter follows the device's locale
const money = (value: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value)

function trade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 't',
    symbol: 'LMT',
    side: 'long',
    quantity: 100,
    entryPrice: 10,
    entryDate: '2026-10-01',
    exitPrice: null,
    exitDate: null,
    fees: 0,
    strategy: '',
    tags: [],
    notes: '',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

const closedAt = (exitPrice: number) => ({ exitPrice, exitDate: '2026-10-20' })

describe('tracksCash', () => {
  it('needs current cash mode and at least one balance', () => {
    expect(tracksCash({ balanceMode: 'current', cashBalances: [usd(1)] })).toBe(true)
    expect(tracksCash({ balanceMode: 'current', cashBalances: [] })).toBe(false)
    expect(tracksCash({ balanceMode: 'starting', cashBalances: [usd(1)] })).toBe(false)
  })
})

describe('moveCash', () => {
  it('takes exactly what dollars hold and converts nothing', () => {
    const move = moveCash([usd(1000), ils(3500)], -1000, rates, makeId)
    expect(move.balances).toEqual([usd(0), ils(3500)])
    expect(move.converted).toEqual([])
    expect(move.short).toBe(0)
    expect(worthTelling(move)).toBe(false)
  })

  it('converts the shortfall from another currency', () => {
    const move = moveCash([usd(500), ils(10_000)], -1500, rates, makeId)
    expect(move.balances).toEqual([usd(0), ils(6500)])
    expect(move.converted).toEqual([{ currency: 'ILS', amount: 3500, dollars: 1000, rate: 3.5 }])
    expect(move.short).toBe(0)
    expect(cashNotes(move, money, true)).toEqual(['Converted ₪3,500.00 to $1,000.00 at 3.50'])
    expect(cashNotes(move, money, false)[0]).toMatch(/^Converts /)
  })

  it('works through several foreign balances in list order', () => {
    // $200 from dollars, ₪700 is $200, and €90 of the €900 is the last $100
    const move = moveCash([ils(700), usd(200), eur(900)], -500, rates, makeId)
    expect(move.balances).toEqual([ils(0), usd(0), eur(810)])
    expect(move.converted.map((c) => c.currency)).toEqual(['ILS', 'EUR'])
    expect(move.short).toBe(0)
  })

  it('uses dollars across several dollar balances', () => {
    const move = moveCash([usd(100, 'a'), usd(100, 'b')], -150, rates, makeId)
    expect(move.balances).toEqual([usd(0, 'a'), usd(50, 'b')])
  })

  it('puts what nothing covers on the dollar balance', () => {
    const move = moveCash([usd(100), ils(350)], -1000, rates, makeId)
    expect(move.balances).toEqual([usd(-800), ils(0)])
    expect(move.short).toBe(800)
    expect(move.noRate).toEqual([])
    expect(cashNotes(move, money, true).at(-1)).toBe(
      '$800.00 short, so your dollar balance went negative.',
    )
  })

  it('adds a dollar balance when there is none to hold the shortfall', () => {
    const move = moveCash([ils(350)], -300, rates, makeId)
    expect(move.balances).toEqual([ils(0), { ...usd(-200), id: 'new' }])
  })

  it('leaves a balance alone when its rate is missing, and says so', () => {
    const move = moveCash([usd(100), ils(10_000)], -1000, null, makeId)
    expect(move.balances).toEqual([usd(-900), ils(10_000)])
    expect(move.short).toBe(900)
    expect(move.noRate).toEqual(['ILS'])
    const notes = cashNotes(move, money, false)
    expect(notes[0]).toContain('No exchange rate for ILS')
    expect(notes[1]).toBe('$900.00 short, so your dollar balance goes negative.')
  })

  it("doesn't need a rate it never uses", () => {
    const move = moveCash([usd(100), ils(10_000)], -100, null, makeId)
    expect(move.noRate).toEqual([])
  })

  it('skips balances that are already negative', () => {
    const move = moveCash([usd(-50), ils(350)], -100, rates, makeId)
    expect(move.balances).toEqual([usd(-50), ils(0)])
    expect(move.short).toBe(0)
  })

  it('brings money in as dollars, adding a balance if needed', () => {
    expect(moveCash([ils(1), usd(5)], 10, rates, makeId).balances).toEqual([ils(1), usd(15)])
    expect(moveCash([ils(1)], 10, rates, makeId).balances).toEqual([
      ils(1),
      { ...usd(10), id: 'new' },
    ])
  })

  it('leaves balances as they are when nothing moves', () => {
    expect(moveCash([ils(1)], 0, rates, makeId).balances).toEqual([ils(1)])
  })

  it('leaves no floating-point dust', () => {
    // 0.1 + 0.2 and thirds would otherwise leave tiny balances or a false shortfall
    const dollars = moveCash([usd(0.1 + 0.2)], -0.3, rates, makeId)
    expect(dollars.balances).toEqual([usd(0)])
    expect(dollars.short).toBe(0)

    const thirds: FxRates = { ...rates, rates: { USD: 1, ILS: 3 } }
    const converted = moveCash([ils(10)], -10 / 3, thirds, makeId)
    expect(converted.balances).toEqual([ils(0)])
    expect(converted.short).toBe(0)
    expect(worthTelling({ ...converted, converted: [], short: 0.004 })).toBe(false)
    expect(Object.is(converted.balances[0].amount, -0)).toBe(false)
  })
})

describe('planSave', () => {
  it('moves nothing while cash is not tracked', () => {
    expect(planSave(null, trade(), false)).toEqual({ delta: 0, moved: undefined })
  })

  it('takes cost and fees for an open long', () => {
    expect(planSave(null, trade({ fees: 5 }), true)).toEqual({ delta: -1005, moved: -1005 })
  })

  it('adds proceeds less fees for an open short', () => {
    const short = trade({ side: 'short', fees: 5 })
    expect(planSave(null, short, true).delta).toBe(995)
  })

  it('applies only the P&L of a trade logged already closed', () => {
    expect(planSave(null, trade({ ...closedAt(12), fees: 5 }), true).delta).toBe(195)
    expect(planSave(null, trade({ ...closedAt(9) }), true).delta).toBe(-100)
  })

  it('moves the difference when a tracked trade is edited', () => {
    const logged = trade({ cashMoved: -1000 })
    expect(planSave(logged, trade({ quantity: 120 }), true)).toEqual({ delta: -200, moved: -1200 })
    expect(planSave(logged, trade({ notes: 'why' }), true)).toEqual({ delta: 0, moved: -1000 })
  })

  it('pays back a short when it closes, and takes back proceeds when reopened', () => {
    const short = trade({ side: 'short', fees: 5, cashMoved: 995 })
    const closed = trade({ side: 'short', fees: 5, ...closedAt(9), cashMoved: 95 })
    expect(planSave(short, closed, true)).toEqual({ delta: -900, moved: 95 })
    expect(planSave(closed, short, true)).toEqual({ delta: 900, moved: 995 })
  })

  it('keeps the record through a note while cash is off, but not a money change', () => {
    const logged = trade({ cashMoved: -1000 })
    expect(planSave(logged, trade({ notes: 'why' }), false)).toEqual({ delta: 0, moved: -1000 })
    expect(planSave(logged, trade({ quantity: 120 }), false)).toEqual({
      delta: 0,
      moved: undefined,
    })
  })

  describe('a trade from before cash tracking', () => {
    const older = trade({ fees: 4 })

    it('leaves typed cash alone when edited', () => {
      expect(planSave(older, trade({ entryPrice: 11, fees: 4 }), true)).toEqual({
        delta: 0,
        moved: undefined,
      })
      const closed = trade({ ...closedAt(12) })
      expect(planSave(closed, trade({ ...closedAt(13) }), true).delta).toBe(0)
    })

    it('takes the sale back when reopened, so closing again adds it only once', () => {
      const closed = trade({ fees: 4, ...closedAt(12) })
      const reopen = planSave(closed, trade({ fees: 4 }), true)
      expect(reopen).toEqual({ delta: -1200, moved: -1200 })
      const open = trade({ fees: 4, cashMoved: reopen.moved })
      expect(planSave(open, closed, true).delta).toBe(1200)
    })

    it('adds what the sale brings in when closed, less fees', () => {
      const next = trade({ fees: 4, ...closedAt(12) })
      expect(planSave(older, next, true)).toEqual({ delta: 1196, moved: 1196 })
    })

    it('pays the buyback when a short closes', () => {
      const short = trade({ side: 'short' })
      const next = trade({ side: 'short', ...closedAt(9) })
      expect(planSave(short, next, true).delta).toBe(-900)
    })

    it('counts as tracked once closed, so reopening takes the proceeds back', () => {
      const next = trade({ ...closedAt(12) })
      const closed = withCashMoved(next, planSave(trade(), next, true).moved)
      expect(planSave(closed, trade(), true)).toEqual({ delta: -1200, moved: 0 })
    })
  })
})

describe('planDelete', () => {
  it('takes back what the app moved', () => {
    expect(planDelete({ cashMoved: -1005 }, true)).toBe(1005)
    expect(planDelete({ cashMoved: 195 }, true)).toBe(-195)
  })

  it('leaves typed cash alone for older trades and while cash is off', () => {
    expect(planDelete({}, true)).toBe(0)
    expect(planDelete({ cashMoved: -1005 }, false)).toBe(0)
  })
})

describe('planClose', () => {
  const close = { quantity: 100, exitPrice: 12, exitDate: '2026-10-20', fees: 5 }

  it('adds the proceeds of a full close, keeping the id', () => {
    const logged = trade({ fees: 5, cashMoved: -1005 })
    const plan = planClose(logged, close, true, 'x', 9)
    expect(plan.delta).toBe(1200)
    expect(plan.open).toBeNull()
    expect(plan.closed).toMatchObject({ id: 't', cashMoved: 195, updatedAt: 9, exitPrice: 12 })
  })

  it('charges fees raised at the exit', () => {
    const logged = trade({ fees: 5, cashMoved: -1005 })
    expect(planClose(logged, { ...close, fees: 8 }, true, 'x', 9).delta).toBe(1197)
  })

  it('adds the proceeds of a partial close and shares the record out', () => {
    const logged = trade({ fees: 10, cashMoved: -1010 })
    const plan = planClose(logged, { ...close, quantity: 40, fees: 5 }, true, 'x', 9)
    // 40 × 12 = 480, less the $1 of exit fees above the $4 share already paid
    expect(plan.delta).toBe(479)
    expect(plan.open).toMatchObject({ id: 't', quantity: 60, fees: 6, cashMoved: -606 })
    expect(plan.closed).toMatchObject({ id: 'x', quantity: 40, cashMoved: 75, partOf: 't' })
    // Deleting both parts lands back where the cash started
    expect(planDelete(plan.open!, true) + planDelete(plan.closed, true) + plan.delta).toBe(1010)
  })

  it('splits an older trade without tracking the part still open', () => {
    const plan = planClose(trade(), { ...close, quantity: 40, fees: 5 }, true, 'x', 9)
    expect(plan.delta).toBe(475)
    expect(plan.closed.cashMoved).toBe(475)
    expect(plan.open!.cashMoved).toBeUndefined()
  })

  it('moves nothing and drops the record while cash is off', () => {
    const logged = trade({ cashMoved: -1000 })
    const partial = planClose(logged, { ...close, quantity: 40 }, false, 'x', 9)
    expect(partial.delta).toBe(0)
    expect(partial.closed.cashMoved).toBeUndefined()
    expect(partial.open!.cashMoved).toBeUndefined()
    expect(planClose(logged, close, false, 'x', 9).closed.cashMoved).toBeUndefined()
  })
})

describe('equity curve start', () => {
  type Book = {
    settings: Pick<
      Settings,
      'balanceMode' | 'startingBalance' | 'startingBalanceCurrency' | 'cashBalances'
    >
    trades: Trade[]
  }

  const book = (cashBalances: CashBalance[], trades: Trade[] = []): Book => ({
    settings: {
      balanceMode: 'current',
      startingBalance: 0,
      startingBalanceCurrency: 'USD',
      cashBalances,
    },
    trades,
  })

  const start = ({ settings, trades }: Book) => {
    const result = startingEquity(settings, trades, 'USD', rates)
    if (!result.ok) throw new Error('missing rate')
    return result.value
  }

  const moved = (b: Book, delta: number, trades: Trade[]): Book => ({
    settings: {
      ...b.settings,
      cashBalances: moveCash(b.settings.cashBalances, delta, rates, makeId).balances,
    },
    trades,
  })

  it('stays put through a long with fees: open, part close, full close', () => {
    const first = book([usd(1000), ils(3500)])
    expect(start(first)).toBe(2000)

    const input = trade({ quantity: 150, fees: 9 })
    const add = planSave(null, input, true)
    const opened = withCashMoved(input, add.moved)
    const held = moved(first, add.delta, [opened])
    // $1,000 plus ₪2,131.50 for the other $509
    expect(held.settings.cashBalances).toEqual([usd(0), ils(1718.5)])
    expect(start(held)).toBeCloseTo(2000, 6)

    const part = planClose(
      opened,
      { quantity: 50, exitPrice: 12, exitDate: '2026-10-20', fees: 3 },
      true,
      'p',
      2,
    )
    const split = moved(held, part.delta, [part.closed, part.open!])
    expect(start(split)).toBeCloseTo(2000, 6)

    const rest = planClose(
      part.open!,
      { quantity: 100, exitPrice: 8, exitDate: '2026-10-21', fees: 6 },
      true,
      'q',
      3,
    )
    const done = moved(split, rest.delta, [part.closed, rest.closed])
    expect(start(done)).toBeCloseTo(2000, 6)

    // By hand: paid $1,509 with fees, sold for 50 × 12 + 100 × 8 = $1,400, and the
    // exit fees equal the $9 already paid, so the account is $109 down
    const end = equityCurve(done.trades, start(done)).at(-1)!.equity
    expect(end).toBeCloseTo(2000 - 109, 6)
    expect(done.settings.cashBalances).toEqual([usd(1400), ils(1718.5)])
  })

  it('stays put through a short', () => {
    const first = book([usd(1000)])
    const input = trade({ side: 'short', fees: 5 })
    const add = planSave(null, input, true)
    const opened = withCashMoved(input, add.moved)
    const held = moved(first, add.delta, [opened])
    expect(start(held)).toBeCloseTo(1000, 6)
    const close = { quantity: 100, exitPrice: 9, exitDate: '2026-10-20', fees: 5 }
    const plan = planClose(opened, close, true, 'x', 2)
    expect(start(moved(held, plan.delta, [plan.closed]))).toBeCloseTo(1000, 6)
  })

  it('stays put when an older trade closes', () => {
    const older = trade({ fees: 4 })
    const first = book([usd(500)], [older])
    expect(start(first)).toBe(1500)
    const close = { quantity: 100, exitPrice: 12, exitDate: '2026-10-20', fees: 4 }
    const plan = planClose(older, close, true, 'x', 2)
    expect(start(moved(first, plan.delta, [plan.closed]))).toBeCloseTo(1500, 6)
  })

  it('stays put when a trade is edited or deleted', () => {
    const first = book([usd(5000)])
    const input = trade({ fees: 5 })
    const add = planSave(null, input, true)
    const opened = withCashMoved(input, add.moved)
    const held = moved(first, add.delta, [opened])

    const edit = trade({ quantity: 120, entryPrice: 11, fees: 7 })
    const change = planSave(opened, edit, true)
    const edited = withCashMoved(edit, change.moved)
    const after = moved(held, change.delta, [edited])
    expect(start(after)).toBeCloseTo(5000, 6)

    const gone = moved(after, planDelete(edited, true), [])
    expect(start(gone)).toBeCloseTo(5000, 6)
    expect(gone.settings.cashBalances).toEqual([usd(5000)])
  })
})
