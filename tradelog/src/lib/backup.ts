import type { CashBalance, Settings, Trade, WatchItem } from '../db/schema.ts'
import { isIsoDate, today } from './dates.ts'
import { returnPct, tradePnl } from './pnl.ts'

export const BACKUP_APP = 'tradelog'
/** Bump when the file layout changes, and teach parseBackup to read the old one. */
export const BACKUP_VERSION = 1

/** Settings worth restoring. The API key stays out of files that end up in iCloud. */
export type BackupSettings = Pick<
  Settings,
  'currency' | 'balanceMode' | 'startingBalance' | 'startingBalanceCurrency' | 'cashBalances'
>

export type Backup = {
  app: typeof BACKUP_APP
  version: typeof BACKUP_VERSION
  /** ISO timestamp */
  exportedAt: string
  trades: Trade[]
  watchlist: WatchItem[]
  /** Null in a hand-made file without settings; restoring then keeps the current ones */
  settings: BackupSettings | null
}

export type BackupSource = {
  trades: Trade[]
  watchlist: WatchItem[]
  settings: Settings
}

export function createBackup(source: BackupSource, now = new Date()): Backup {
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    trades: source.trades,
    watchlist: source.watchlist,
    settings: {
      currency: source.settings.currency,
      balanceMode: source.settings.balanceMode,
      startingBalance: source.settings.startingBalance,
      startingBalanceCurrency: source.settings.startingBalanceCurrency,
      cashBalances: source.settings.cashBalances,
    },
  }
}

export function backupFileName(kind: 'backup' | 'trades', now = new Date()): string {
  return `tradelog-${kind}-${today(now)}.${kind === 'backup' ? 'json' : 'csv'}`
}

export type ParseResult = { ok: true; backup: Backup } | { ok: false; error: string }

type Raw = Record<string, unknown>

const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isPositive = (v: unknown): v is number => isNumber(v) && v > 0

/** A field problem, reported as "Trade 3 (AAPL): <message>". */
class FieldError extends Error {}

function optionalString(raw: Raw, key: string): string {
  const v = raw[key]
  if (v === undefined || v === null) return ''
  if (typeof v !== 'string') throw new FieldError(`${key} isn't text`)
  return v
}

function readTrade(raw: unknown, now: number): Trade {
  if (!isObject(raw)) throw new FieldError("isn't a trade")
  const { id, symbol, side, quantity, entryPrice, entryDate, exitPrice, exitDate } = raw
  if (typeof id !== 'string' || !id) throw new FieldError('missing id')
  if (typeof symbol !== 'string' || !symbol.trim()) throw new FieldError('missing symbol')
  if (side !== 'long' && side !== 'short') throw new FieldError('side must be long or short')
  if (!isPositive(quantity)) throw new FieldError('quantity must be a number above 0')
  if (!isPositive(entryPrice)) throw new FieldError('entry price must be a number above 0')
  if (typeof entryDate !== 'string' || !isIsoDate(entryDate))
    throw new FieldError('entry date must be YYYY-MM-DD')

  const open = (exitPrice ?? null) === null && (exitDate ?? null) === null
  if (!open) {
    if (!isPositive(exitPrice)) throw new FieldError('exit price must be a number above 0')
    if (typeof exitDate !== 'string' || !isIsoDate(exitDate))
      throw new FieldError('exit date must be YYYY-MM-DD')
    if (exitDate < entryDate) throw new FieldError('exit date is before the entry date')
  }

  const fees = raw.fees ?? 0
  if (!isNumber(fees) || fees < 0) throw new FieldError("fees must be a number that isn't negative")

  const tags = raw.tags ?? []
  if (!Array.isArray(tags) || !tags.every((t) => typeof t === 'string'))
    throw new FieldError('tags must be a list of text')

  const { partOf } = raw
  if (partOf !== undefined && partOf !== null && typeof partOf !== 'string')
    throw new FieldError("partOf isn't text")

  const createdAt = isNumber(raw.createdAt) ? raw.createdAt : now
  return {
    id,
    symbol: symbol.trim().toUpperCase(),
    side,
    quantity,
    entryPrice,
    entryDate,
    exitPrice: open ? null : (exitPrice as number),
    exitDate: open ? null : (exitDate as string),
    fees,
    strategy: optionalString(raw, 'strategy').trim(),
    tags: [...new Set(tags.map((t) => t.trim()).filter(Boolean))],
    notes: optionalString(raw, 'notes'),
    ...(partOf ? { partOf } : {}),
    createdAt,
    updatedAt: isNumber(raw.updatedAt) ? raw.updatedAt : createdAt,
  }
}

function readWatchItem(raw: unknown, now: number): WatchItem {
  if (!isObject(raw)) throw new FieldError("isn't a watchlist item")
  const { symbol, targetPrice, note } = raw
  if (typeof symbol !== 'string' || !symbol.trim()) throw new FieldError('missing symbol')
  const item: WatchItem = {
    symbol: symbol.trim().toUpperCase(),
    addedAt: isNumber(raw.addedAt) ? raw.addedAt : now,
  }
  if (targetPrice !== undefined && targetPrice !== null) {
    if (!isPositive(targetPrice)) throw new FieldError('target price must be a number above 0')
    item.targetPrice = targetPrice
  }
  if (note !== undefined && note !== null) item.note = optionalString(raw, 'note')
  return item
}

function readSettings(raw: unknown): BackupSettings | null {
  if (raw === undefined || raw === null) return null
  if (!isObject(raw)) throw new FieldError("isn't a settings object")
  const { currency, startingBalance, balanceMode = 'starting', cashBalances = [] } = raw
  if (!isCurrency(currency)) throw new FieldError('currency must be a 3-letter code')
  if (!isNumber(startingBalance) || startingBalance < 0)
    throw new FieldError("starting balance must be a number that isn't negative")
  // Files from before balances had their own currency used the main one
  const startingBalanceCurrency = raw.startingBalanceCurrency ?? currency
  if (!isCurrency(startingBalanceCurrency))
    throw new FieldError('starting balance currency must be a 3-letter code')
  if (balanceMode !== 'starting' && balanceMode !== 'current')
    throw new FieldError('balance mode must be starting or current')
  if (!Array.isArray(cashBalances)) throw new FieldError('cash balances must be a list')
  return {
    currency: currency.toUpperCase(),
    balanceMode,
    startingBalance,
    startingBalanceCurrency: startingBalanceCurrency.toUpperCase(),
    cashBalances: cashBalances.map(readCashBalance),
  }
}

const isCurrency = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z]{3}$/.test(v)

function readCashBalance(raw: unknown): CashBalance {
  if (!isObject(raw)) throw new FieldError("a cash balance isn't an object")
  const { id, amount, currency } = raw
  if (typeof id !== 'string' || !id) throw new FieldError('a cash balance is missing its id')
  if (!isNumber(amount)) throw new FieldError('a cash balance amount must be a number')
  if (!isCurrency(currency)) throw new FieldError('a cash balance currency must be a 3-letter code')
  return {
    id,
    label: optionalString(raw, 'label').trim(),
    amount,
    currency: currency.toUpperCase(),
  }
}

/** Reads each item, collecting errors instead of stopping at the first. */
function readList<T>(
  list: unknown,
  read: (raw: unknown) => T,
  label: (raw: unknown, index: number) => string,
  errors: string[],
): T[] {
  if (list === undefined) return []
  if (!Array.isArray(list)) {
    errors.push(`${label(null, -1)} isn't a list`)
    return []
  }
  const items: T[] = []
  list.forEach((raw, i) => {
    try {
      items.push(read(raw))
    } catch (err) {
      if (!(err instanceof FieldError)) throw err
      errors.push(`${label(raw, i)}: ${err.message}`)
    }
  })
  return items
}

const MAX_ERRORS_SHOWN = 3

/**
 * Parses and checks a backup file. Any invalid trade rejects the whole file,
 * so a restore never half-imports a journal.
 */
export function parseBackup(text: string, now = Date.now()): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''))
  } catch {
    return { ok: false, error: "This file isn't valid JSON. Pick a TradeLog backup (.json)." }
  }
  if (!isObject(raw) || raw.app !== BACKUP_APP) {
    return { ok: false, error: "This isn't a TradeLog backup file." }
  }
  if (!Number.isInteger(raw.version) || (raw.version as number) < 1) {
    return { ok: false, error: 'This backup has no valid version number.' }
  }
  if ((raw.version as number) > BACKUP_VERSION) {
    return {
      ok: false,
      error: 'This backup was made by a newer version of TradeLog. Update the app and try again.',
    }
  }

  const errors: string[] = []
  const tradeLabel = (t: unknown, i: number) => {
    if (i < 0) return 'Trades'
    const symbol = isObject(t) && typeof t.symbol === 'string' ? ` (${t.symbol})` : ''
    return `Trade ${i + 1}${symbol}`
  }
  const trades = readList(raw.trades, (t) => readTrade(t, now), tradeLabel, errors)
  const watchlist = readList(
    raw.watchlist,
    (w) => readWatchItem(w, now),
    (_, i) => (i < 0 ? 'Watchlist' : `Watchlist item ${i + 1}`),
    errors,
  )
  let settings: BackupSettings | null = null
  try {
    settings = readSettings(raw.settings)
  } catch (err) {
    if (!(err instanceof FieldError)) throw err
    errors.push(`Settings: ${err.message}`)
  }

  const ids = new Set<string>()
  for (const t of trades) {
    if (ids.has(t.id)) errors.push(`Trade ${t.symbol} appears twice (id ${t.id})`)
    ids.add(t.id)
  }

  if (errors.length > 0) {
    const more = errors.length - MAX_ERRORS_SHOWN
    return {
      ok: false,
      error: [
        'This backup has problems, so nothing was imported:',
        ...errors.slice(0, MAX_ERRORS_SHOWN),
        ...(more > 0 ? [`…and ${more} more`] : []),
      ].join('\n'),
    }
  }

  const exportedAt =
    typeof raw.exportedAt === 'string' && !Number.isNaN(Date.parse(raw.exportedAt))
      ? raw.exportedAt
      : new Date(now).toISOString()

  return {
    ok: true,
    backup: {
      app: BACKUP_APP,
      version: BACKUP_VERSION,
      exportedAt,
      trades,
      // One row per symbol, first one wins
      watchlist: watchlist.filter(
        (w, i) => watchlist.findIndex((x) => x.symbol === w.symbol) === i,
      ),
      settings,
    },
  }
}

export type ImportMode = 'merge' | 'replace'

export type ImportPlan = {
  /** Trades to write; for replace, the table is cleared first */
  trades: Trade[]
  watchlist: WatchItem[]
  /** New trades */
  added: number
  /** Merge: trades the backup has a newer edit of. Replace: trades whose edits differ. */
  updated: number
  /** Trades already on this device that the backup leaves alone */
  unchanged: number
  /** Trades on this device that a replace deletes */
  removed: number
  watchlistAdded: number
}

/**
 * What a restore will do. Merge adds trades this device doesn't have and
 * updates ones the backup has a newer edit of; nothing is deleted. The closed
 * part of a partial close is left out when this device changed the open trade
 * since: those shares may be back in it, and adding them would count them
 * twice. Replace makes the journal and watchlist exactly match the backup.
 */
export function planImport(
  existing: Pick<BackupSource, 'trades' | 'watchlist'>,
  backup: Backup,
  mode: ImportMode,
): ImportPlan {
  const current = new Map(existing.trades.map((t) => [t.id, t]))
  const watched = new Set(existing.watchlist.map((w) => w.symbol))

  if (mode === 'replace') {
    const incoming = new Set(backup.trades.map((t) => t.id))
    let added = 0
    let updated = 0
    let unchanged = 0
    for (const t of backup.trades) {
      const mine = current.get(t.id)
      if (!mine) added++
      else if (mine.updatedAt === t.updatedAt) unchanged++
      else updated++
    }
    return {
      trades: backup.trades,
      watchlist: backup.watchlist,
      added,
      updated,
      unchanged,
      removed: existing.trades.filter((t) => !incoming.has(t.id)).length,
      watchlistAdded: backup.watchlist.filter((w) => !watched.has(w.symbol)).length,
    }
  }

  const trades: Trade[] = []
  let added = 0
  let updated = 0
  for (const t of backup.trades) {
    const mine = current.get(t.id)
    if (!mine) {
      const openPart = t.partOf ? current.get(t.partOf) : undefined
      if (openPart && openPart.updatedAt > t.updatedAt) continue
      added++
    } else if (t.updatedAt > mine.updatedAt) updated++
    else continue
    trades.push(t)
  }
  const watchlist = backup.watchlist.filter((w) => !watched.has(w.symbol))
  return {
    trades,
    watchlist,
    added,
    updated,
    unchanged: backup.trades.length - added - updated,
    removed: 0,
    watchlistAdded: watchlist.length,
  }
}

const CSV_COLUMNS = [
  'Symbol',
  'Side',
  'Status',
  'Quantity',
  'Entry price',
  'Entry date',
  'Exit price',
  'Exit date',
  'Fees',
  'P&L',
  'Return %',
  'Strategy',
  'Tags',
  'Notes',
  'ID',
]

/** Rounds away floating-point dust like 97.49999999999999 without losing real precision. */
function csvNumber(value: number | null, decimals = 8): string {
  if (value === null) return ''
  return String(Number(value.toFixed(decimals)))
}

/**
 * Quotes a cell when needed (RFC 4180). Text that a spreadsheet would run as
 * a formula (=, +, -, @) gets a leading apostrophe.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** Trades as CSV for Excel or Google Sheets, oldest first. Numbers stay unformatted. */
export function tradesCsv(trades: Trade[]): string {
  const rows = [...trades]
    .sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.createdAt - b.createdAt)
    .map((t) => {
      const pct = returnPct(t)
      return [
        csvCell(t.symbol),
        t.side,
        t.exitPrice === null ? 'open' : 'closed',
        csvNumber(t.quantity),
        csvNumber(t.entryPrice),
        t.entryDate,
        csvNumber(t.exitPrice),
        t.exitDate ?? '',
        csvNumber(t.fees),
        csvNumber(tradePnl(t), 4),
        csvNumber(pct === null ? null : pct, 2),
        csvCell(t.strategy),
        csvCell(t.tags.join(', ')),
        csvCell(t.notes),
        csvCell(t.id),
      ].join(',')
    })
  return [CSV_COLUMNS.map(csvCell).join(','), ...rows].join('\r\n') + '\r\n'
}

export const BACKUP_REMINDER_DAYS = 7
const DAY = 86_400_000

/**
 * True when the journal has changes that haven't been backed up for a week:
 * a week since the last backup with edits after it, or never backed up and
 * the first trade is a week old. Hidden while snoozed.
 */
export function backupReminderDue(
  trades: Pick<Trade, 'createdAt' | 'updatedAt'>[],
  settings: Pick<Settings, 'lastBackupAt' | 'backupReminderSnoozedUntil'>,
  now = Date.now(),
): boolean {
  if (trades.length === 0) return false
  if (settings.backupReminderSnoozedUntil && now < settings.backupReminderSnoozedUntil) return false
  const due = BACKUP_REMINDER_DAYS * DAY
  const { lastBackupAt } = settings
  if (lastBackupAt === null) return now - Math.min(...trades.map((t) => t.createdAt)) >= due
  const changedSince = trades.some((t) => t.updatedAt > lastBackupAt)
  return changedSince && now - lastBackupAt >= due
}
