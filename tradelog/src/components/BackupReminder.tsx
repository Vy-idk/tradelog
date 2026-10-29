import { useState } from 'react'
import { exportJsonBackup, useBackupSource } from '../db/backup.ts'
import { updateSettings } from '../db/settings.ts'
import { backupReminderDue } from '../lib/backup.ts'
import { formatDaysAgo } from '../lib/format.ts'

const SNOOZE_MS = 86_400_000

/**
 * Nudges a JSON backup when the journal has gone a week without one. iOS can
 * wipe site data, so a file in iCloud Drive is the only real safety net.
 */
function BackupReminder() {
  const source = useBackupSource()
  const [error, setError] = useState('')

  if (!source || !backupReminderDue(source.trades, source.settings)) return null
  const { lastBackupAt } = source.settings

  async function backUp() {
    setError('')
    try {
      // Called straight from the tap so the share sheet is allowed to open
      await exportJsonBackup(source!)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <aside
      aria-label="Backup reminder"
      className="mb-3 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3"
    >
      <p className="font-medium text-amber-200">
        {lastBackupAt === null
          ? "You haven't backed up your journal yet"
          : `Last backup ${formatDaysAgo(lastBackupAt)}`}
      </p>
      <p className="mt-0.5 text-sm text-muted">
        Your trades live only on this phone. Save a copy to Files or iCloud Drive.
      </p>
      {error && (
        <p role="alert" className="mt-1 text-sm text-loss">
          Couldn't back up: {error}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={backUp}
          className="rounded-lg bg-amber-300 px-3 py-2 text-sm font-semibold text-bg"
        >
          Back up now
        </button>
        <button
          type="button"
          onClick={() => updateSettings({ backupReminderSnoozedUntil: Date.now() + SNOOZE_MS })}
          className="rounded-lg px-3 py-2 text-sm font-medium text-muted"
        >
          Remind me tomorrow
        </button>
      </div>
    </aside>
  )
}

export default BackupReminder
