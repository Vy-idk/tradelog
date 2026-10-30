import Dexie, { type Table } from 'dexie'

export type Side = 'long' | 'short'

export type Trade = {
  id: string
  /** Uppercase, e.g. AAPL */
  symbol: string
  side: Side
  /** Shares or units */
  quantity: number
  /** Per share */
  entryPrice: number
  /** YYYY-MM-DD */
  entryDate: string
  /** Null while the trade is open */
  exitPrice: number | null
  /** YYYY-MM-DD, null while the trade is open */
  exitDate: string | null
  /** Total commissions for the round trip */
  fees: number
  strategy: string
  tags: string[]
  notes: string
  createdAt: number
  updatedAt: number
}

/** The fields a user enters; id and timestamps are filled in on save */
export type TradeInput = Omit<Trade, 'id' | 'createdAt' | 'updatedAt'>

export type WatchItem = {
  symbol: string
  addedAt: number
  targetPrice?: number
  note?: string
}

/** The last price fetched for a symbol, kept so it still shows offline. */
export type Quote = {
  symbol: string
  /** Last traded price */
  price: number
  /** Change since the previous close */
  change: number
  changePct: number
  prevClose: number
  open: number
  high: number
  low: number
  /** When the exchange set this price (ms); 0 if unknown */
  priceTime: number
  /** When TradeLog fetched it (ms) */
  fetchedAt: number
}

/** A pre-market or after-hours trade from Yahoo Finance, via the price relay. */
export type ExtendedQuote = {
  symbol: string
  session: 'pre' | 'post'
  price: number
  /** Change from the regular session's last close */
  change: number
  changePct: number
  /** That regular-session close */
  regularPrice: number
  /** When the trade happened (ms) */
  time: number
  /** When TradeLog fetched it (ms) */
  fetchedAt: number
}

export type Settings = {
  id: 'app'
  finnhubApiKey: string
  /** The Cloudflare Worker that relays Yahoo's pre-market and after-hours prices */
  priceRelayUrl: string
  currency: string
  startingBalance: number
  lastBackupAt: number | null
  /** The backup reminder stays hidden until this time after tapping "Later" */
  backupReminderSnoozedUntil: number | null
}

export class TradeLogDB extends Dexie {
  trades!: Table<Trade, string>
  watchlist!: Table<WatchItem, string>
  settings!: Table<Settings, string>
  /** A cache, not journal data: never backed up or restored */
  quotes!: Table<Quote, string>
  /** Also a cache, like quotes */
  extendedQuotes!: Table<ExtendedQuote, string>

  constructor() {
    super('tradelog')
    // Bump the version with an upgrade function for any schema change;
    // never rename a table without a migration.
    this.version(1).stores({
      trades: 'id, symbol, entryDate, exitDate, strategy, *tags',
      watchlist: 'symbol',
      settings: 'id',
    })
    // Adds a table, so no upgrade function is needed
    this.version(2).stores({
      quotes: 'symbol',
    })
    this.version(3).stores({
      extendedQuotes: 'symbol',
    })
  }
}

export const db = new TradeLogDB()
