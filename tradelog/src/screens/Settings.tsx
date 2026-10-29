import { useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import Field from '../components/Field.tsx'
import Modal from '../components/Modal.tsx'
import Screen from '../components/Screen.tsx'
import { fieldA11y, inputClass } from '../components/styles.ts'
import {
  exportJsonBackup,
  exportTradesCsv,
  restoreBackup,
  useBackupSource,
  type SaveOutcome,
} from '../db/backup.ts'
import type { Settings as AppSettings } from '../db/schema.ts'
import { updateSettings } from '../db/settings.ts'
import {
  backupReminderDue,
  parseBackup,
  planImport,
  type Backup,
  type BackupSource,
  type ImportMode,
  type ParseResult,
} from '../lib/backup.ts'
import { formatDaysAgo, formatMoney } from '../lib/format.ts'
import { parseNumber } from '../lib/tradeDraft.ts'

const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'ILS', 'CAD', 'AUD', 'CHF', 'JPY']

const currencyNames = new Intl.DisplayNames(undefined, { type: 'currency' })
const currencyLabel = (code: string) => `${code} · ${currencyNames.of(code) ?? code}`

/** Every currency the browser knows, minus the common ones shown first. */
const otherCurrencies = (() => {
  try {
    return Intl.supportedValuesOf('currency').filter((c) => !COMMON_CURRENCIES.includes(c))
  } catch {
    return []
  }
})()

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-medium tracking-wide text-muted uppercase">{title}</h2>
      <div className="space-y-4 rounded-xl border border-border bg-surface p-4">{children}</div>
    </section>
  )
}

const balanceText = (value: number) => (value ? String(value) : '')

function AccountSettings({ settings }: { settings: AppSettings }) {
  const { currency, startingBalance } = settings
  const [balance, setBalance] = useState(balanceText(startingBalance))
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  // Show the stored value after saving, or when a restore changes it
  const [shown, setShown] = useState(startingBalance)
  if (shown !== startingBalance) {
    setShown(startingBalance)
    setBalance(balanceText(startingBalance))
  }

  const currencies = COMMON_CURRENCIES.includes(currency)
    ? COMMON_CURRENCIES
    : [currency, ...COMMON_CURRENCIES]

  async function saveBalance(e?: FormEvent) {
    e?.preventDefault()
    const text = balance.trim()
    const value = parseNumber(text) ?? 0
    if (/^-/.test(text)) return setError("Starting balance can't be negative")
    if (Number.isNaN(value)) return setError('Enter a number, e.g. 10000')
    if (value > 1e12) return setError('That number is too large')
    setError('')
    if (value === startingBalance) return
    await updateSettings({ startingBalance: value })
    setSaved(true)
  }

  return (
    <form noValidate onSubmit={saveBalance} className="space-y-4">
      <Field id="settings-currency" label="Currency">
        <select
          id="settings-currency"
          className={inputClass}
          value={currency}
          onChange={(e) => updateSettings({ currency: e.target.value })}
        >
          {currencies.map((c) => (
            <option key={c} value={c}>
              {currencyLabel(c)}
            </option>
          ))}
          {otherCurrencies.length > 0 && (
            <optgroup label="All currencies">
              {otherCurrencies.map((c) => (
                <option key={c} value={c}>
                  {currencyLabel(c)}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </Field>
      <Field
        id="settings-balance"
        label="Starting balance"
        error={error}
        hint={
          saved
            ? `Saved: ${formatMoney(startingBalance, currency)}`
            : 'Account value before your first logged trade; the equity curve starts here'
        }
      >
        <input
          {...fieldA11y('settings-balance', error || undefined)}
          className={inputClass}
          value={balance}
          onChange={(e) => {
            setBalance(e.target.value)
            setSaved(false)
          }}
          onBlur={() => saveBalance()}
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="done"
          placeholder="0.00"
        />
      </Field>
    </form>
  )
}

type Status = { tone: 'ok' | 'error'; text: string }

const savedText: Record<Exclude<SaveOutcome, 'cancelled'>, string> = {
  shared: 'saved',
  downloaded: 'downloaded',
}

function BackupSettings({ source }: { source: BackupSource }) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [picked, setPicked] = useState<ParseResult | null>(null)
  const { lastBackupAt } = source.settings
  const due = backupReminderDue(source.trades, {
    lastBackupAt,
    backupReminderSnoozedUntil: null,
  })

  async function run(action: () => Promise<Status | null>) {
    setStatus(null)
    try {
      setStatus(await action())
    } catch (err) {
      setStatus({ tone: 'error', text: err instanceof Error ? err.message : String(err) })
    }
  }

  // Both exports are called straight from the tap, before any await (see saveFile)
  const exportJson = () =>
    run(async () => {
      const outcome = await exportJsonBackup(source)
      if (outcome === 'cancelled') return null
      const trades = plural(source.trades.length, 'trade')
      return { tone: 'ok', text: `Backup ${savedText[outcome]} with ${trades}.` }
    })

  const exportCsv = () =>
    run(async () => {
      const outcome = await exportTradesCsv(source)
      if (outcome === 'cancelled') return null
      return { tone: 'ok', text: `Trades CSV ${savedText[outcome]}.` }
    })

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Clear it so picking the same file again still fires onChange
    e.target.value = ''
    if (!file) return
    setStatus(null)
    try {
      setPicked(parseBackup(await file.text()))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setPicked({ ok: false, error: `Couldn't read the file: ${message}` })
    }
  }

  return (
    <>
      <div>
        <p className={`font-medium ${due ? 'text-loss' : ''}`}>
          {lastBackupAt === null ? 'Never backed up' : `Last backup ${formatDaysAgo(lastBackupAt)}`}
        </p>
        <p className="mt-1 text-sm text-muted">
          {lastBackupAt !== null && `${dateTime.format(lastBackupAt)}. `}
          Your journal lives only on this device. Save a backup to Files or iCloud Drive at least
          once a week.
        </p>
      </div>

      <div className="grid gap-3">
        <button
          type="button"
          onClick={exportJson}
          className="rounded-xl bg-accent py-3 font-semibold text-bg"
        >
          Export backup (JSON)
        </button>
        <button
          type="button"
          onClick={exportCsv}
          disabled={source.trades.length === 0}
          className="rounded-xl border border-border py-3 font-medium disabled:opacity-40"
        >
          Export trades (CSV)
        </button>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="rounded-xl border border-border py-3 font-medium"
        >
          Restore from backup…
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          onChange={onFile}
          className="hidden"
          aria-hidden
          tabIndex={-1}
        />
      </div>

      {status && (
        <p
          role={status.tone === 'error' ? 'alert' : 'status'}
          className={`text-sm ${status.tone === 'error' ? 'text-loss' : 'text-gain'}`}
        >
          {status.text}
        </p>
      )}

      <p className="text-xs text-muted">
        A backup holds your trades, watchlist, currency and starting balance. Your API key isn't
        included. CSV is for spreadsheets and can't be restored.
      </p>

      <RestoreDialog
        picked={picked}
        source={source}
        onClose={() => setPicked(null)}
        onDone={(text) => {
          setPicked(null)
          setStatus({ tone: 'ok', text })
        }}
        onError={(text) => {
          setPicked(null)
          setStatus({ tone: 'error', text })
        }}
      />
    </>
  )
}

function restoredText(mode: ImportMode, plan: ReturnType<typeof planImport>): string {
  if (mode === 'replace') return `Restored ${plural(plan.trades.length, 'trade')} from the backup.`
  if (plan.added + plan.updated + plan.watchlistAdded === 0)
    return 'Nothing new: this device already has everything in that backup.'
  const parts = [`${plural(plan.added, 'trade')} added`]
  if (plan.updated) parts.push(`${plan.updated} updated`)
  if (plan.watchlistAdded) parts.push(`${plural(plan.watchlistAdded, 'watchlist symbol')} added`)
  return `Merged: ${parts.join(', ')}.`
}

function RestoreDialog({
  picked,
  source,
  onClose,
  onDone,
  onError,
}: {
  picked: ParseResult | null
  source: BackupSource
  onClose: () => void
  onDone: (message: string) => void
  onError: (message: string) => void
}) {
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [busy, setBusy] = useState(false)
  const backup: Backup | null = picked?.ok ? picked.backup : null

  const plans = useMemo(
    () =>
      backup && {
        merge: planImport(source, backup, 'merge'),
        replace: planImport(source, backup, 'replace'),
      },
    [backup, source],
  )

  async function restore(mode: ImportMode) {
    if (!backup || busy) return
    setBusy(true)
    try {
      onDone(restoredText(mode, await restoreBackup(backup, mode)))
    } catch (err) {
      onError(`Restore failed, nothing was changed: ${err instanceof Error ? err.message : err}`)
    } finally {
      setBusy(false)
      setConfirmReplace(false)
    }
  }

  if (picked && !picked.ok) {
    return (
      <Modal open onClose={onClose} title="Can't restore this file">
        <p className="whitespace-pre-line text-muted">{picked.error}</p>
        <button
          type="button"
          autoFocus
          onClick={onClose}
          className="mt-5 w-full rounded-xl border border-border py-3 font-medium"
        >
          OK
        </button>
      </Modal>
    )
  }

  const merge = plans?.merge
  const replace = plans?.replace
  // One dialog with two steps: closing it to open a second one would fire onClose
  return (
    <Modal
      open={backup !== null}
      onClose={onClose}
      title={confirmReplace ? 'Replace your journal?' : 'Restore backup?'}
    >
      {backup && merge && replace && !confirmReplace && (
        <div className="space-y-4">
          <p className="text-muted">
            From {dateTime.format(new Date(backup.exportedAt))} ·{' '}
            {plural(backup.trades.length, 'trade')}
            {backup.watchlist.length > 0 &&
              ` · ${plural(backup.watchlist.length, 'watchlist symbol')}`}
          </p>
          <div className="rounded-lg bg-bg p-3 text-sm">
            <p className="font-medium">Merge</p>
            <p className="mt-0.5 text-muted">
              {merge.added + merge.updated + merge.watchlistAdded === 0
                ? 'Nothing to add: this device already has everything in the backup.'
                : `Adds ${plural(merge.added, 'new trade')}${
                    merge.updated > 0 ? ` and updates ${merge.updated} with newer edits` : ''
                  }. Nothing on this device is deleted.`}
            </p>
          </div>
          <div className="rounded-lg bg-bg p-3 text-sm">
            <p className="font-medium">Replace</p>
            <p className="mt-0.5 text-muted">
              Makes this device match the backup exactly
              {replace.updated > 0 &&
                `, resetting ${plural(replace.updated, 'edited trade')} to the backup's copy`}
              {replace.removed > 0 && (
                <>
                  {' '}
                  and <span className="text-loss">deletes {plural(replace.removed, 'trade')}</span>{' '}
                  that aren't in it
                </>
              )}
              .
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setConfirmReplace(true)}
              disabled={busy}
              className="rounded-xl border border-loss/40 py-3 font-semibold text-loss disabled:opacity-50"
            >
              Replace…
            </button>
            <button
              type="button"
              onClick={() => restore('merge')}
              disabled={busy}
              className="rounded-xl bg-accent py-3 font-semibold text-bg disabled:opacity-50"
            >
              Merge
            </button>
          </div>
          <button
            type="button"
            // Cancel gets focus so a stray Enter never restores
            autoFocus
            onClick={onClose}
            className="w-full rounded-xl py-2 text-muted"
          >
            Cancel
          </button>
        </div>
      )}

      {backup && replace && confirmReplace && (
        <>
          <p className="text-muted">
            Your {plural(source.trades.length, 'trade')} will be replaced by the{' '}
            {plural(replace.trades.length, 'trade')} in the backup
            {replace.removed > 0 && `, and ${replace.removed} will be deleted`}. Export a backup
            first if you might need them. This can't be undone.
          </p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              type="button"
              autoFocus
              onClick={() => setConfirmReplace(false)}
              className="rounded-xl border border-border py-3 font-medium"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => restore('replace')}
              disabled={busy}
              className="rounded-xl bg-loss py-3 font-semibold text-bg disabled:opacity-50"
            >
              Replace
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}

function Settings() {
  const source = useBackupSource()

  return (
    <Screen title="Settings">
      {source && (
        <>
          <Section title="Account">
            <AccountSettings settings={source.settings} />
          </Section>
          <Section title="Backup">
            <BackupSettings source={source} />
          </Section>
        </>
      )}
    </Screen>
  )
}

export default Settings
