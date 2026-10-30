import { describe, expect, it } from 'vitest'
import type { Trade } from '../db/schema.ts'
import { DEFAULT_SETTINGS } from '../db/settings.ts'
import {
  backupFileName,
  backupReminderDue,
  createBackup,
  csvCell,
  parseBackup,
  planImport,
  tradesCsv,
  type Backup,
} from './backup.ts'

function trade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 'id-1',
    symbol: 'AAPL',
    side: 'long',
    quantity: 10,
    entryPrice: 100,
    entryDate: '2026-10-01',
    exitPrice: 110,
    exitDate: '2026-10-05',
    fees: 2.5,
    strategy: 'Breakout',
    tags: ['A+ setup'],
    notes: 'Clean base, "textbook" entry',
    createdAt: 1_000,
    updatedAt: 2_000,
    ...overrides,
  }
}

const settings = { ...DEFAULT_SETTINGS, currency: 'ILS', startingBalance: 25_000 }
const now = new Date('2026-10-29T12:00:00Z')

function backupWith(trades: Trade[]): Backup {
  return createBackup({ trades, watchlist: [], settings }, now)
}

/** Parses a file built from a raw object, for testing bad input. */
function parseRaw(raw: unknown) {
  return parseBackup(JSON.stringify(raw), now.getTime())
}

const validRaw = () => JSON.parse(JSON.stringify(backupWith([trade()])))

describe('createBackup and parseBackup', () => {
  it('round-trips every table exactly', () => {
    const trades = [
      trade(),
      trade({ id: 'id-2', symbol: 'TSLA', side: 'short', exitPrice: null, exitDate: null }),
      trade({ id: 'id-3', quantity: 0.00012345, entryPrice: 61234.5, tags: [], notes: '' }),
    ]
    const watchlist = [
      { symbol: 'NVDA', addedAt: 5, targetPrice: 150, note: 'earnings' },
      { symbol: 'MSFT', addedAt: 6 },
    ]
    const backup = createBackup({ trades, watchlist, settings }, now)
    const parsed = parseBackup(JSON.stringify(backup, null, 2))
    expect(parsed).toEqual({ ok: true, backup })
  })

  it('leaves the API key out of the file', () => {
    const backup = createBackup(
      { trades: [], watchlist: [], settings: { ...settings, finnhubApiKey: 'secret' } },
      now,
    )
    expect(JSON.stringify(backup)).not.toContain('secret')
    expect(backup.settings).toEqual({
      currency: 'ILS',
      balanceMode: 'starting',
      startingBalance: 25_000,
      startingBalanceCurrency: 'USD',
      cashBalances: [],
    })
  })

  it('names files by date', () => {
    expect(backupFileName('backup', new Date(2026, 9, 29))).toBe('tradelog-backup-2026-10-29.json')
    expect(backupFileName('trades', new Date(2026, 9, 29))).toBe('tradelog-trades-2026-10-29.csv')
  })
})

describe('parseBackup rejects bad files', () => {
  const error = (raw: unknown) => {
    const result = parseRaw(raw)
    return result.ok ? null : result.error
  }

  it('rejects files that are not TradeLog backups', () => {
    expect(parseBackup('not json')).toMatchObject({ ok: false })
    expect(error([])).toMatch(/isn't a TradeLog backup/)
    expect(error({ app: 'other', version: 1 })).toMatch(/isn't a TradeLog backup/)
  })

  it('checks the version', () => {
    expect(error({ ...validRaw(), version: undefined })).toMatch(/no valid version/)
    expect(error({ ...validRaw(), version: 2 })).toMatch(/newer version of TradeLog/)
  })

  it('names each broken trade and imports none of them', () => {
    const raw = validRaw()
    raw.trades.push(
      { ...raw.trades[0], id: 'b', quantity: -1 },
      { ...raw.trades[0], id: 'c', entryDate: '2026-02-30' },
      { ...raw.trades[0], id: 'd', exitDate: null },
      { ...raw.trades[0], id: 'e', exitDate: '2026-09-01' },
    )
    const message = error(raw)!
    expect(message).toMatch(/nothing was imported/)
    expect(message).toContain('Trade 2 (AAPL): quantity must be a number above 0')
    expect(message).toContain('Trade 3 (AAPL): entry date must be YYYY-MM-DD')
    expect(message).toContain('Trade 4 (AAPL): exit date must be YYYY-MM-DD')
    expect(message).toContain('…and 1 more')
  })

  it('rejects duplicate ids, bad sides, fees and tags', () => {
    const raw = validRaw()
    expect(error({ ...raw, trades: [raw.trades[0], raw.trades[0]] })).toMatch(/appears twice/)
    expect(error({ ...raw, trades: [{ ...raw.trades[0], side: 'buy' }] })).toMatch(/long or short/)
    expect(error({ ...raw, trades: [{ ...raw.trades[0], fees: -1 }] })).toMatch(/fees/)
    expect(error({ ...raw, trades: [{ ...raw.trades[0], tags: 'x' }] })).toMatch(/tags/)
    expect(error({ ...raw, trades: [{ ...raw.trades[0], exitPrice: '110' }] })).toMatch(
      /exit price/,
    )
    expect(error({ ...raw, trades: 'all of them' })).toMatch(/Trades isn't a list/)
  })

  it('checks settings', () => {
    const raw = validRaw()
    expect(error({ ...raw, settings: { currency: 'dollars', startingBalance: 0 } })).toMatch(
      /currency/,
    )
    expect(error({ ...raw, settings: { currency: 'USD', startingBalance: -5 } })).toMatch(
      /starting balance/,
    )
    expect(
      error({ ...raw, settings: { ...raw.settings, cashBalances: [{ id: 'c', amount: 'lots' }] } }),
    ).toMatch(/cash balance/)
  })

  it('reads settings from before balances had their own currency', () => {
    const raw = validRaw()
    raw.settings = { currency: 'ils', startingBalance: 25_000 }
    const result = parseRaw(raw)
    expect(result.ok && result.backup.settings).toEqual({
      currency: 'ILS',
      balanceMode: 'starting',
      startingBalance: 25_000,
      startingBalanceCurrency: 'ILS',
      cashBalances: [],
    })
  })

  it('round-trips cash balances', () => {
    const cashBalances = [
      { id: 'a', label: 'Broker', amount: 5_000, currency: 'USD' },
      { id: 'b', label: '', amount: 12_000, currency: 'ILS' },
    ]
    const backup = createBackup(
      {
        trades: [],
        watchlist: [],
        settings: { ...settings, balanceMode: 'current', cashBalances },
      },
      now,
    )
    const result = parseBackup(JSON.stringify(backup))
    expect(result.ok && result.backup.settings).toMatchObject({
      balanceMode: 'current',
      cashBalances,
    })
  })
})

describe('parseBackup tidies valid files', () => {
  it('fills optional fields and normalizes symbols and tags', () => {
    const raw = validRaw()
    const { strategy, notes, createdAt, updatedAt, ...minimal } = raw.trades[0]
    void [strategy, notes, createdAt, updatedAt]
    raw.trades = [{ ...minimal, symbol: ' aapl ', fees: undefined, tags: [' a ', 'a', ''] }]
    raw.watchlist = [{ symbol: 'msft' }, { symbol: 'MSFT', addedAt: 9 }]
    delete raw.settings
    const result = parseRaw(raw)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.backup.trades[0]).toMatchObject({
      symbol: 'AAPL',
      fees: 0,
      tags: ['a'],
      strategy: '',
      notes: '',
      createdAt: now.getTime(),
      updatedAt: now.getTime(),
    })
    expect(result.backup.watchlist).toEqual([{ symbol: 'MSFT', addedAt: now.getTime() }])
    expect(result.backup.settings).toBeNull()
  })

  it('ignores a byte order mark', () => {
    expect(parseBackup('﻿' + JSON.stringify(validRaw())).ok).toBe(true)
  })
})

describe('planImport', () => {
  const mine = [
    trade({ id: 'same', updatedAt: 5 }),
    trade({ id: 'edited-here', updatedAt: 9 }),
    trade({ id: 'edited-in-backup', updatedAt: 3 }),
    trade({ id: 'only-here' }),
  ]
  const backup = backupWith([
    trade({ id: 'same', updatedAt: 5 }),
    trade({ id: 'edited-here', updatedAt: 7, notes: 'old' }),
    trade({ id: 'edited-in-backup', updatedAt: 8, notes: 'new' }),
    trade({ id: 'only-in-backup' }),
  ])
  backup.watchlist = [
    { symbol: 'AAPL', addedAt: 1 },
    { symbol: 'NVDA', addedAt: 2 },
  ]
  const existing = { trades: mine, watchlist: [{ symbol: 'AAPL', addedAt: 0 }] }

  it('merge adds new trades and newer edits, and deletes nothing', () => {
    const plan = planImport(existing, backup, 'merge')
    expect(plan.trades.map((t) => t.id)).toEqual(['edited-in-backup', 'only-in-backup'])
    expect(plan).toMatchObject({ added: 1, updated: 1, unchanged: 2, removed: 0 })
    expect(plan.watchlist.map((w) => w.symbol)).toEqual(['NVDA'])
    expect(plan.watchlistAdded).toBe(1)
  })

  it('replace takes the backup as is and counts what goes away', () => {
    const plan = planImport(existing, backup, 'replace')
    expect(plan.trades).toBe(backup.trades)
    expect(plan.watchlist).toBe(backup.watchlist)
    expect(plan).toMatchObject({ added: 1, updated: 2, unchanged: 1, removed: 1 })
  })
})

describe('tradesCsv', () => {
  it('writes a header and one row per trade, oldest first', () => {
    const csv = tradesCsv([
      trade({ id: 'new', entryDate: '2026-10-09', exitPrice: null, exitDate: null, fees: 0 }),
      trade(),
    ])
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe(
      'Symbol,Side,Status,Quantity,Entry price,Entry date,Exit price,Exit date,Fees,P&L,Return %,Strategy,Tags,Notes,ID',
    )
    expect(lines[1]).toBe(
      'AAPL,long,closed,10,100,2026-10-01,110,2026-10-05,2.5,97.5,9.75,Breakout,A+ setup,"Clean base, ""textbook"" entry",id-1',
    )
    expect(lines[2]).toBe(
      'AAPL,long,open,10,100,2026-10-09,,,0,,,Breakout,A+ setup,"Clean base, ""textbook"" entry",new',
    )
    expect(lines[3]).toBe('')
  })

  it('rounds away floating-point dust', () => {
    const csv = tradesCsv([trade({ entryPrice: 0.1, exitPrice: 0.3, quantity: 3, fees: 0 })])
    expect(csv.split('\r\n')[1]).toContain(',0.6,200,')
  })

  it('escapes quotes, line breaks and formula-like text', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('line 1\nline 2')).toBe('"line 1\nline 2"')
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('-5 lesson')).toBe("'-5 lesson")
    expect(csvCell('@me')).toBe("'@me")
  })
})

describe('backupReminderDue', () => {
  const day = 86_400_000
  const t = (createdAt: number, updatedAt = createdAt) => ({ createdAt, updatedAt })
  const never = { lastBackupAt: null, backupReminderSnoozedUntil: null }

  it('stays quiet with no trades', () => {
    expect(backupReminderDue([], never, 100 * day)).toBe(false)
  })

  it('waits a week after the first trade when never backed up', () => {
    expect(backupReminderDue([t(10 * day)], never, 16 * day)).toBe(false)
    expect(backupReminderDue([t(10 * day), t(15 * day)], never, 17 * day)).toBe(true)
  })

  it('reminds a week after the last backup if anything changed since', () => {
    const backedUp = { lastBackupAt: 20 * day, backupReminderSnoozedUntil: null }
    expect(backupReminderDue([t(10 * day, 21 * day)], backedUp, 26 * day)).toBe(false)
    expect(backupReminderDue([t(10 * day, 21 * day)], backedUp, 27 * day)).toBe(true)
    // Nothing new to back up
    expect(backupReminderDue([t(10 * day, 19 * day)], backedUp, 60 * day)).toBe(false)
  })

  it('hides while snoozed', () => {
    const snoozed = { ...never, backupReminderSnoozedUntil: 31 * day }
    expect(backupReminderDue([t(0)], snoozed, 30 * day)).toBe(false)
    expect(backupReminderDue([t(0)], snoozed, 31 * day)).toBe(true)
  })
})
