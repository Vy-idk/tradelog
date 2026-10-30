export const FINNHUB_SEARCH_URL = 'https://finnhub.io/api/v1/search'

/** A symbol Finnhub didn't know is asked about again after this long, e.g. for a new IPO. */
export const UNKNOWN_SYMBOL_TTL = 86_400_000

export type SymbolCheck =
  | { status: 'valid'; symbol: string; name: string }
  | { status: 'invalid'; symbol: string }
  /** Couldn't ask Finnhub, so the symbol may or may not exist */
  | {
      status: 'unchecked'
      symbol: string
      reason: 'no-key' | 'invalid-key' | 'offline' | 'rate-limited' | 'failed'
    }

/** Why a symbol couldn't be checked, as a hint under the field. */
export const uncheckedText: Record<
  Extract<SymbolCheck, { status: 'unchecked' }>['reason'],
  string
> = {
  'no-key': 'Add a Finnhub API key in Settings to check symbols',
  'invalid-key': "Couldn't check the symbol: Finnhub rejected your API key",
  offline: "You're offline, so the symbol wasn't checked",
  'rate-limited': "Finnhub is busy, so the symbol wasn't checked",
  failed: "Couldn't reach Finnhub to check the symbol",
}

/**
 * Finds the exact listing in Finnhub's /search answer:
 * { count, result: [{ symbol, displaySymbol, description, type }] }.
 * Foreign listings carry an exchange suffix (LMT.MX), so an exact match is US.
 */
export function findListing(symbol: string, body: unknown): { name: string } | null {
  if (typeof body !== 'object' || body === null) return null
  const { result } = body as { result?: unknown }
  if (!Array.isArray(result)) return null
  for (const item of result) {
    if (typeof item !== 'object' || item === null) continue
    const { symbol: s, displaySymbol, description } = item as Record<string, unknown>
    if (s === symbol || displaySymbol === symbol) {
      return { name: typeof description === 'string' ? description.trim() : '' }
    }
  }
  return null
}
