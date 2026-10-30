import { useLiveQuery } from 'dexie-react-hooks'
import {
  moveCash,
  planClose,
  planDelete,
  planSave,
  tracksCash,
  withCashMoved,
  worthTelling,
} from '../lib/cash.ts'
import { showCashNotice } from '../lib/cashNotice.ts'
import type { FxRates } from '../lib/fx.ts'
import { newId } from '../lib/id.ts'
import { compareNewestFirst } from '../lib/journal.ts'
import { isClosed } from '../lib/pnl.ts'
import type { PartialClose } from '../lib/positions.ts'
import { db, type Trade, type TradeInput } from './schema.ts'
import { DEFAULT_SETTINGS } from './settings.ts'

/** All trades, newest first; undefined while loading. */
export function useTrades(): Trade[] | undefined {
  return useLiveQuery(async () => (await db.trades.toArray()).sort(compareNewestFirst))
}

/** One trade; undefined while loading, null if it doesn't exist. */
export function useTrade(id: string | undefined): Trade | null | undefined {
  return useLiveQuery(async () => (id ? ((await db.trades.get(id)) ?? null) : null), [id])
}

/**
 * Writes a trade change and the cash it moves in one transaction, so a failure
 * can't leave them out of step. `write` saves the trade and returns the dollars
 * to move. Balances and rates are read here, not taken from a screen.
 */
async function withCash(write: (tracking: boolean) => Promise<number>): Promise<void> {
  const move = await db.transaction('rw', db.trades, db.settings, db.fxRates, async () => {
    const settings = { ...DEFAULT_SETTINGS, ...(await db.settings.get('app')) }
    const delta = await write(tracksCash(settings))
    if (delta === 0) return null
    const rates = (await db.fxRates.get('USD')) as FxRates | undefined
    const moved = moveCash(settings.cashBalances, delta, rates, newId)
    await db.settings.put({ ...settings, cashBalances: moved.balances })
    return moved
  })
  if (move && worthTelling(move)) showCashNotice(move)
}

export async function addTrade(input: TradeInput): Promise<string> {
  const now = Date.now()
  const id = newId()
  await withCash(async (tracking) => {
    const { delta, moved } = planSave(null, input, tracking)
    const trade = { ...input, id, createdAt: now, updatedAt: now }
    await db.trades.add(withCashMoved(trade, moved))
    return delta
  })
  return id
}

export async function updateTrade(id: string, input: TradeInput): Promise<void> {
  await withCash(async (tracking) => {
    const trade = await db.trades.get(id)
    if (!trade) throw new Error("This trade doesn't exist anymore")
    const { delta, moved } = planSave(trade, input, tracking)
    await db.trades.put(withCashMoved({ ...trade, ...input, updatedAt: Date.now() }, moved))
    return delta
  })
}

/**
 * Closes some or all of an open trade. Closing part of it splits it in one
 * transaction, so shares can't go missing or be counted twice.
 */
export async function closeTrade(id: string, close: PartialClose): Promise<void> {
  await withCash(async (tracking) => {
    const trade = await db.trades.get(id)
    if (!trade) throw new Error("This trade doesn't exist anymore")
    if (isClosed(trade)) throw new Error('This trade is already closed')
    const { closed, open, delta } = planClose(trade, close, tracking, newId(), Date.now())
    await db.trades.put(closed)
    if (open) await db.trades.put(open)
    return delta
  })
}

export async function deleteTrade(id: string): Promise<void> {
  await withCash(async (tracking) => {
    const trade = await db.trades.get(id)
    if (!trade) return 0
    await db.trades.delete(id)
    return planDelete(trade, tracking)
  })
}
