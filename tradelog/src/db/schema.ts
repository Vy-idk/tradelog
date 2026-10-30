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
  /** On the closed part of a partial close: the open trade it was split from */
  partOf?: string
  /**
   * Dollars the app has added to cash for this trade so far (negative: taken
   * out). Missing on trades it never touched cash for, such as ones logged
   * before cash tracking: their effect is already in the cash the user typed.
   */
  cashMoved?: number
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

/** Cash held in one currency, e.g. dollars at the broker or shekels in the bank. */
export type CashBalance = {
  id: string
  /** Optional, e.g. "IBKR cash" */
  label: string
  amount: number
  currency: string
}

/** A symbol checked against Finnhub's US listings. A cache, never backed up. */
export type SymbolInfo = {
  symbol: string
  /** Company or fund name; blank when only a price confirmed it */
  name: string
  valid: boolean
  checkedAt: number
}

/** The last exchange rates fetched, kept for offline use. A cache, never backed up. */
export type FxRatesRow = {
  base: 'USD'
  /** Units of each currency per 1 USD */
  rates: Record<string, number>
  /** YYYY-MM-DD the rates were set */
  date: string
  fetchedAt: number
}

/** The next earnings report for a symbol. A cache, never backed up. */
export type EarningsRow = {
  symbol: string
  /** YYYY-MM-DD of the next report; null when none is scheduled, e.g. for an ETF */
  date: string | null
  /** Before the open, after the close, during market hours, or not known */
  hour: 'bmo' | 'amc' | 'dmh' | ''
  /** True when Finnhub says the API key's plan doesn't include earnings dates */
  noAccess?: boolean
  fetchedAt: number
}

/** The period Stats cover, counted by exit date. */
export type StatsRange = '30d' | '90d' | 'ytd' | '1y' | 'all'

export type Settings = {
  id: 'app'
  finnhubApiKey: string
  /** The Cloudflare Worker that relays Yahoo's pre-market and after-hours prices */
  priceRelayUrl: string
  /** Main currency: Stats show money in it. Trades themselves are always in dollars. */
  currency: string
  /** Start from a known balance, or work back from the cash held today */
  balanceMode: 'starting' | 'current'
  startingBalance: number
  startingBalanceCurrency: string
  /** Cash held today, used when balanceMode is 'current' */
  cashBalances: CashBalance[]
  /** The currency picked on the Stats screen; blank means the main currency */
  statsCurrency: string
  statsRange: StatsRange
  /** Masks money and share counts on screen, for using the app around other people */
  hideAmounts: boolean
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
  /** Caches too */
  symbols!: Table<SymbolInfo, string>
  fxRates!: Table<FxRatesRow, string>
  earnings!: Table<EarningsRow, string>

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
    // The starting balance used to share the one currency setting, so it
    // keeps that currency now that trades are always in dollars
    this.version(4)
      .stores({
        symbols: 'symbol',
        fxRates: 'base',
      })
      .upgrade((tx) =>
        tx
          .table('settings')
          .toCollection()
          .modify((s: Partial<Settings>) => {
            s.startingBalanceCurrency ??= s.currency ?? 'USD'
          }),
      )
    this.version(5).stores({
      earnings: 'symbol',
    })
  }
}

export const db = new TradeLogDB()
