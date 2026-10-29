import { useLiveQuery } from 'dexie-react-hooks'
import { newId } from '../lib/id.ts'
import { compareNewestFirst } from '../lib/journal.ts'
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

export async function closeTrade(
  id: string,
  close: { exitPrice: number; exitDate: string; fees: number },
): Promise<void> {
  await db.trades.update(id, { ...close, updatedAt: Date.now() })
}

export async function deleteTrade(id: string): Promise<void> {
  await db.trades.delete(id)
}
