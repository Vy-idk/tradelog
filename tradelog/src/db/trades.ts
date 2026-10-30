import { useLiveQuery } from 'dexie-react-hooks'
import { newId } from '../lib/id.ts'
import { compareNewestFirst } from '../lib/journal.ts'
import { isClosed } from '../lib/pnl.ts'
import { sharesLeft, splitTrade, type PartialClose } from '../lib/positions.ts'
import { db, type Trade, type TradeInput } from './schema.ts'

/** All trades, newest first; undefined while loading. */
export function useTrades(): Trade[] | undefined {
  return useLiveQuery(async () => (await db.trades.toArray()).sort(compareNewestFirst))
}

/** One trade; undefined while loading, null if it doesn't exist. */
export function useTrade(id: string | undefined): Trade | null | undefined {
  return useLiveQuery(async () => (id ? ((await db.trades.get(id)) ?? null) : null), [id])
}

export async function addTrade(input: TradeInput): Promise<string> {
  const now = Date.now()
  const id = newId()
  await db.trades.add({ ...input, id, createdAt: now, updatedAt: now })
  return id
}

export async function updateTrade(id: string, input: TradeInput): Promise<void> {
  await db.trades.update(id, { ...input, updatedAt: Date.now() })
}

/**
 * Closes some or all of an open trade. Closing part of it splits it in one
 * transaction, so shares can't go missing or be counted twice.
 */
export async function closeTrade(id: string, close: PartialClose): Promise<void> {
  await db.transaction('rw', db.trades, async () => {
    const trade = await db.trades.get(id)
    if (!trade) throw new Error("This trade doesn't exist anymore")
    if (isClosed(trade)) throw new Error('This trade is already closed')
    const now = Date.now()
    if (sharesLeft(trade.quantity, close.quantity) === 0) {
      const { exitPrice, exitDate, fees } = close
      await db.trades.update(id, { exitPrice, exitDate, fees, updatedAt: now })
      return
    }
    const { closed, open } = splitTrade(trade, close, newId(), now)
    await db.trades.put(open)
    await db.trades.add(closed)
  })
}

export async function deleteTrade(id: string): Promise<void> {
  await db.trades.delete(id)
}
