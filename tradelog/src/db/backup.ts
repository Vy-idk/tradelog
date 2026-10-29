import { useLiveQuery } from 'dexie-react-hooks'
import {
  backupFileName,
  createBackup,
  planImport,
  tradesCsv,
  type Backup,
  type BackupSource,
  type ImportMode,
  type ImportPlan,
} from '../lib/backup.ts'
import { db } from './schema.ts'
import { DEFAULT_SETTINGS, updateSettings } from './settings.ts'

/** Everything a backup contains, kept loaded so exporting needs no await before sharing. */
export function useBackupSource(): BackupSource | undefined {
  return useLiveQuery(async () => {
    const [trades, watchlist, settings] = await Promise.all([
      db.trades.toArray(),
      db.watchlist.toArray(),
      db.settings.get('app'),
    ])
    return { trades, watchlist, settings: { ...DEFAULT_SETTINGS, ...settings } }
  })
}

export type SaveOutcome = 'shared' | 'downloaded' | 'cancelled'

/**
 * On phones, opens the share sheet so iOS offers Save to Files or iCloud
 * Drive; elsewhere, downloads the file. Must run straight from a tap: Safari
 * only allows sharing while the tap is fresh, so nothing may be awaited first.
 */
async function saveFile(file: File): Promise<SaveOutcome> {
  const touch = window.matchMedia('(pointer: coarse)').matches
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return 'shared'
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled'
      // NotAllowedError and friends: fall back to a plain download
    }
  }
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  document.body.append(link)
  link.click()
  link.remove()
  // Give the browser a moment to start reading the blob before revoking it
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return 'downloaded'
}

/** Saves a full JSON backup and records when, unless the share sheet was dismissed. */
export async function exportJsonBackup(source: BackupSource): Promise<SaveOutcome> {
  const now = new Date()
  const json = JSON.stringify(createBackup(source, now), null, 2)
  const file = new File([json], backupFileName('backup', now), { type: 'application/json' })
  const outcome = await saveFile(file)
  if (outcome !== 'cancelled') await updateSettings({ lastBackupAt: now.getTime() })
  return outcome
}

export async function exportTradesCsv(source: BackupSource): Promise<SaveOutcome> {
  // The byte order mark makes Excel read the file as UTF-8
  const file = new File(['﻿', tradesCsv(source.trades)], backupFileName('trades'), {
    type: 'text/csv',
  })
  return saveFile(file)
}

/**
 * Restores a parsed backup in one transaction, so a failure leaves the
 * journal untouched. Plans against the data as it is inside the transaction.
 */
export async function restoreBackup(backup: Backup, mode: ImportMode): Promise<ImportPlan> {
  return db.transaction('rw', db.trades, db.watchlist, db.settings, async () => {
    const [trades, watchlist] = await Promise.all([db.trades.toArray(), db.watchlist.toArray()])
    const plan = planImport({ trades, watchlist }, backup, mode)
    if (mode === 'replace') {
      await Promise.all([db.trades.clear(), db.watchlist.clear()])
    }
    await Promise.all([db.trades.bulkPut(plan.trades), db.watchlist.bulkPut(plan.watchlist)])
    if (mode === 'replace') {
      const current = { ...DEFAULT_SETTINGS, ...(await db.settings.get('app')) }
      const exportedAt = Date.parse(backup.exportedAt)
      await db.settings.put({
        ...current,
        ...backup.settings,
        // The journal now matches the backup file, so it counts as backed up then
        lastBackupAt: Math.max(current.lastBackupAt ?? 0, exportedAt),
      })
    }
    return plan
  })
}
