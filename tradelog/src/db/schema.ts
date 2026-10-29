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

export type Settings = {
  id: 'app'
  finnhubApiKey: string
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

  constructor() {
    super('tradelog')
    // Bump the version with an upgrade function for any schema change;
    // never rename a table without a migration.
    this.version(1).stores({
      trades: 'id, symbol, entryDate, exitDate, strategy, *tags',
      watchlist: 'symbol',
      settings: 'id',
    })
  }
}

export const db = new TradeLogDB()
