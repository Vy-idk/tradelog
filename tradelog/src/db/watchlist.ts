import { useLiveQuery } from 'dexie-react-hooks'
import { normalizeSymbol, symbolError } from '../lib/tradeDraft.ts'
import { db, type WatchItem } from './schema.ts'

/** The watchlist, alphabetical; undefined while loading. */
export function useWatchlist(): WatchItem[] | undefined {
  return useLiveQuery(async () =>
    (await db.watchlist.toArray()).sort((a, b) => a.symbol.localeCompare(b.symbol)),
  )
}

/** Adds a symbol. Returns an error message instead of throwing for bad input. */
export async function addWatchSymbol(
  text: string,
): Promise<{ symbol: string } | { error: string }> {
  const symbol = normalizeSymbol(text)
  const error = symbolError(symbol)
  if (error) return { error }
  return db.transaction('rw', db.watchlist, async () => {
    if (await db.watchlist.get(symbol)) return { error: `${symbol} is already on your watchlist` }
    await db.watchlist.add({ symbol, addedAt: Date.now() })
    return { symbol }
  })
}

/** Sets or clears the target price and note. */
export async function updateWatchItem(
  symbol: string,
  changes: { targetPrice: number | null; note: string },
): Promise<void> {
  await db.transaction('rw', db.watchlist, async () => {
    const item = await db.watchlist.get(symbol)
    if (!item) return
    const next: WatchItem = { symbol, addedAt: item.addedAt }
    if (changes.targetPrice !== null) next.targetPrice = changes.targetPrice
    if (changes.note) next.note = changes.note
    await db.watchlist.put(next)
  })
}

export async function removeWatchSymbol(symbol: string): Promise<void> {
  await db.watchlist.delete(symbol)
}
