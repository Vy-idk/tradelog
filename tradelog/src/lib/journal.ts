import type { Trade } from '../db/schema.ts'

/** Newest first: by entry date, then by when the trade was logged. */
export function compareNewestFirst(a: Trade, b: Trade): number {
  if (a.entryDate !== b.entryDate) return a.entryDate < b.entryDate ? 1 : -1
  return b.createdAt - a.createdAt
}

export type JournalFilters = {
  symbol: string
  strategy: string
  tag: string
}

/** Keeps trades that match every filter that is set; blank filters match everything. */
export function filterTrades(trades: Trade[], filters: JournalFilters): Trade[] {
  return trades.filter(
    (t) =>
      (!filters.symbol || t.symbol === filters.symbol) &&
      (!filters.strategy || t.strategy === filters.strategy) &&
      (!filters.tag || t.tags.includes(filters.tag)),
  )
}

/** Distinct non-blank values, most used first, ties alphabetical. */
export function rankByUse(values: string[]): string[] {
  const counts = new Map<string, number>()
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([v]) => v)
}

/** Distinct non-blank values sorted alphabetically, for filter pickers. */
export function distinctSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

export const DEFAULT_STRATEGIES = ['Breakout', 'Pullback', 'Momentum', 'Earnings', 'Reversal']

/** Strategies you've used (most used first), padded with common defaults. */
export function strategySuggestions(trades: Trade[], limit = 8): string[] {
  const used = rankByUse(trades.map((t) => t.strategy))
  const lower = new Set(used.map((s) => s.toLowerCase()))
  const defaults = DEFAULT_STRATEGIES.filter((s) => !lower.has(s.toLowerCase()))
  return [...used, ...defaults].slice(0, limit)
}

/** Tags you've used, most used first. */
export function tagSuggestions(trades: Trade[]): string[] {
  return rankByUse(trades.flatMap((t) => t.tags))
}

/**
 * Journal scroll position, kept across visits to the trade form so going
 * back lands where you left off. Reset to 0 to show the newest trades.
 */
export const journalScroll = { top: 0 }
