import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from 'react'
import { useSearchParams } from 'react-router-dom'
import Field from '../components/Field.tsx'
import Modal from '../components/Modal.tsx'
import Screen from '../components/Screen.tsx'
import { blurWhenHidden, fieldA11y, inputClass } from '../components/styles.ts'
import {
  exportJsonBackup,
  exportTradesCsv,
  restoreBackup,
  useBackupSource,
  type SaveOutcome,
} from '../db/backup.ts'
import { forgetEarningsRefusals } from '../db/earnings.ts'
import { useFxRates, useFxRefresh } from '../db/fx.ts'
import { testApiKey, testRelay } from '../db/quotes.ts'
import type { Settings as AppSettings, CashBalance } from '../db/schema.ts'
import { updateCashBalances, updateSettings } from '../db/settings.ts'
import {
  backupReminderDue,
  parseBackup,
  planImport,
  type Backup,
  type BackupSource,
  type ImportMode,
  type ParseResult,
} from '../lib/backup.ts'
import { useAmounts } from '../lib/amounts.ts'
import { formatDaysAgo, formatPrice } from '../lib/format.ts'
import type { ExtendedResult } from '../lib/extended.ts'
import { accountCurrencies, FX_CURRENCIES, sumBalances, type FxRates } from '../lib/fx.ts'
import { newId } from '../lib/id.ts'
import type { QuoteResult } from '../lib/prices.ts'
import {
  appVersion,
  checkForUpdate,
  isStandalone,
  usePwa,
  type OfflineStatus,
  type UpdateCheck,
} from '../lib/pwa.ts'
import { parseNumber } from '../lib/tradeDraft.ts'

const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'ILS', 'CAD', 'AUD', 'CHF', 'JPY']

const currencyNames = new Intl.DisplayNames(undefined, { type: 'currency' })
const currencyLabel = (code: string) => `${code} · ${currencyNames.of(code) ?? code}`

/** Currencies with an exchange rate, minus the common ones shown first. */
const otherCurrencies = FX_CURRENCIES.filter((c) => !COMMON_CURRENCIES.includes(c))

/** Common currencies first, then the rest; a saved one that's no longer listed stays on top. */
function CurrencyOptions({ current, short }: { current: string; short?: boolean }) {
  const label = short ? (c: string) => c : currencyLabel
  const common =
    COMMON_CURRENCIES.includes(current) || otherCurrencies.includes(current)
      ? COMMON_CURRENCIES
      : [current, ...COMMON_CURRENCIES]
  return (
    <>
      {common.map((c) => (
        <option key={c} value={c}>
          {label(c)}
        </option>
      ))}
      <optgroup label="More currencies">
        {otherCurrencies.map((c) => (
          <option key={c} value={c}>
            {label(c)}
          </option>
        ))}
      </optgroup>
    </>
  )
}

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mb-6 scroll-mt-4">
      <h2 className="mb-2 text-sm font-medium tracking-wide text-muted uppercase">{title}</h2>
      <div className="space-y-4 rounded-xl border border-border bg-surface p-4">{children}</div>
    </section>
  )
}

const balanceText = (value: number) => (value ? String(value) : '')

/** Reads a typed balance: a number, or an error message. Blank is zero. */
function readAmount(text: string, label: string): number | string {
  const value = parseNumber(text) ?? 0
  if (/^-/.test(text.trim())) return `${label} can't be negative`
  if (Number.isNaN(value)) return 'Enter a number, e.g. 10000'
  if (value > 1e12) return 'That number is too large'
  return value
}

const segmentClass =
  'flex-1 rounded-md px-3 py-2 text-sm font-semibold text-muted aria-pressed:bg-surface aria-pressed:text-inherit aria-pressed:shadow'

function AccountSettings({ settings }: { settings: AppSettings }) {
  const { currency, balanceMode } = settings
  const rates = useFxRates()
  useFxRefresh(accountCurrencies(settings).length > 1)

  return (
    <div className="space-y-4">
      <Field
        id="settings-currency"
        label="Main currency"
        hint="Stats show money in this currency, and can switch to US dollars. Trades are always in dollars."
      >
        <select
          id="settings-currency"
          className={inputClass}
          value={currency}
          // A new main currency is what Stats should show next
          onChange={(e) => updateSettings({ currency: e.target.value, statsCurrency: '' })}
        >
          <CurrencyOptions current={currency} />
        </select>
      </Field>

      <fieldset>
        <legend className="mb-1 text-sm text-muted">Account balance</legend>
        <div className="flex rounded-lg border border-border bg-bg p-1">
          <button
            type="button"
            aria-pressed={balanceMode === 'starting'}
            onClick={() => updateSettings({ balanceMode: 'starting' })}
            className={segmentClass}
          >
            Starting balance
          </button>
          <button
            type="button"
            aria-pressed={balanceMode === 'current'}
            onClick={() => updateSettings({ balanceMode: 'current' })}
            className={segmentClass}
          >
            Cash today
          </button>
        </div>
      </fieldset>

      {balanceMode === 'starting' ? (
        <StartingBalance settings={settings} />
      ) : (
        <CashBalances settings={settings} rates={rates ?? null} />
      )}
    </div>
  )
}

function StartingBalance({ settings }: { settings: AppSettings }) {
  const { startingBalance, startingBalanceCurrency } = settings
  const amounts = useAmounts()
  const [balance, setBalance] = useState(balanceText(startingBalance))
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  // Show the stored value after saving, or when a restore changes it
  const [shown, setShown] = useState(startingBalance)
  if (shown !== startingBalance) {
    setShown(startingBalance)
    setBalance(balanceText(startingBalance))
  }

  async function saveBalance(e?: FormEvent) {
    e?.preventDefault()
    const value = readAmount(balance, 'Starting balance')
    if (typeof value === 'string') return setError(value)
    setError('')
    if (value === startingBalance) return
    await updateSettings({ startingBalance: value })
    setSaved(true)
  }

  return (
    <form noValidate onSubmit={saveBalance}>
      <Field
        id="settings-balance"
        label="Starting balance"
        error={error}
        hint={
          saved
            ? `Saved: ${amounts.money(startingBalance, startingBalanceCurrency)}`
            : 'Account value before your first logged trade; the equity curve starts here'
        }
      >
        <div className="flex gap-2">
          <input
            {...fieldA11y('settings-balance', error || undefined)}
            className={`${inputClass} flex-1 ${blurWhenHidden(amounts.hidden)}`}
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
          <div className="w-24 shrink-0">
            <select
              aria-label="Starting balance currency"
              className={inputClass}
              value={startingBalanceCurrency}
              onChange={(e) => updateSettings({ startingBalanceCurrency: e.target.value })}
            >
              <CurrencyOptions current={startingBalanceCurrency} short />
            </select>
          </div>
        </div>
      </Field>
    </form>
  )
}

function CashBalances({ settings, rates }: { settings: AppSettings; rates: FxRates | null }) {
  const { cashBalances, currency } = settings
  const amounts = useAmounts()
  const total = sumBalances(cashBalances, currency, rates)

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        The cash in your account today, in any currency. TradeLog adds your open trades at current
        prices for your account value, and works back through your closed trades to where you
        started.
      </p>
      {cashBalances.length > 0 && (
        <ul className="space-y-3">
          {cashBalances.map((c, i) => (
            <CashBalanceRow
              key={c.id}
              index={i}
              balance={c}
              onSave={(changes) =>
                updateCashBalances((list) =>
                  list.map((x) => (x.id === c.id ? { ...x, ...changes } : x)),
                )
              }
              onRemove={() => updateCashBalances((list) => list.filter((x) => x.id !== c.id))}
            />
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={() =>
          updateCashBalances((list) => [
            ...list,
            {
              id: newId(),
              label: '',
              amount: 0,
              // Most people add dollars at the broker first, then other cash
              currency: list.some((c) => c.currency === 'USD') ? currency : 'USD',
            },
          ])
        }
        className="w-full rounded-xl border border-border py-3 font-medium"
      >
        Add cash balance
      </button>
      {cashBalances.length > 1 && (
        <p className="text-sm text-muted tabular-nums">
          Total:{' '}
          {total === null
            ? 'needs exchange rates, which load when you’re online'
            : `${amounts.money(total, currency)} at today’s rates`}
        </p>
      )}
    </div>
  )
}

function CashBalanceRow({
  index,
  balance,
  onSave,
  onRemove,
}: {
  index: number
  balance: CashBalance
  onSave: (changes: Partial<Omit<CashBalance, 'id'>>) => void
  onRemove: () => void
}) {
  const id = `settings-cash-${index}`
  const { hidden } = useAmounts()
  const [label, setLabel] = useState(balance.label)
  const [amount, setAmount] = useState(balanceText(balance.amount))
  const [error, setError] = useState('')

  // Show stored values after saving, or when a restore changes them. Compared
  // by value, since every save reloads all balances as new objects.
  const stored = `${balance.label}
${balance.amount}`
  const [shown, setShown] = useState(stored)
  if (shown !== stored) {
    setShown(stored)
    setLabel(balance.label)
    setAmount(balanceText(balance.amount))
  }

  function saveText() {
    const value = readAmount(amount, 'Cash')
    if (typeof value === 'string') return setError(value)
    setError('')
    const trimmed = label.trim()
    if (value !== balance.amount || trimmed !== balance.label) {
      onSave({ label: trimmed, amount: value })
    }
  }

  return (
    <li className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex gap-2">
        <label htmlFor={`${id}-label`} className="sr-only">
          Name
        </label>
        <input
          id={`${id}-label`}
          className={`${inputClass} flex-1`}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={saveText}
          autoComplete="off"
          maxLength={40}
          placeholder="Name, e.g. Broker cash"
        />
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${balance.label || 'this balance'}`}
          className="shrink-0 rounded-lg border border-border px-3 text-sm font-medium text-muted"
        >
          Remove
        </button>
      </div>
      <div className="flex gap-2">
        <label htmlFor={id} className="sr-only">
          Amount
        </label>
        <input
          {...fieldA11y(id, error || undefined)}
          className={`${inputClass} flex-1 ${blurWhenHidden(hidden)}`}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onBlur={saveText}
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="done"
          placeholder="0.00"
        />
        <div className="w-24 shrink-0">
          <select
            aria-label="Currency"
            className={inputClass}
            value={balance.currency}
            onChange={(e) => onSave({ currency: e.target.value })}
          >
            <CurrencyOptions current={balance.currency} short />
          </select>
        </div>
      </div>
      {error && (
        <p id={`${id}-error`} className="text-sm text-loss">
          {error}
        </p>
      )}
    </li>
  )
}

type Status = { tone: 'ok' | 'error'; text: string }

/** What a key test found, in words. */
function keyTestText(result: QuoteResult | undefined): Status {
  if (!result) return { tone: 'error', text: "Couldn't test the key." }
  if (result.ok) {
    return {
      tone: 'ok',
      text: `Key works: ${result.quote.symbol} is at ${formatPrice(result.quote.price)}.`,
    }
  }
  switch (result.error) {
    case 'invalid-key':
      return {
        tone: 'error',
        text: 'Finnhub rejected this key. Copy it again from your Finnhub dashboard.',
      }
    case 'rate-limited':
      return {
        tone: 'error',
        text: 'Finnhub is rate limiting this key. Wait a minute and test again.',
      }
    case 'offline':
      return { tone: 'error', text: "Saved. You're offline, so the key will be checked later." }
    case 'no-access':
    case 'not-found':
      // The key was accepted; only the test symbol had a problem
      return { tone: 'ok', text: 'Key accepted by Finnhub.' }
    default:
      return { tone: 'error', text: "Saved, but Finnhub couldn't be reached to check it." }
  }
}

function PriceSettings({ settings }: { settings: AppSettings }) {
  const { finnhubApiKey } = settings
  const [params] = useSearchParams()
  const [key, setKey] = useState(finnhubApiKey)
  const [reveal, setReveal] = useState(false)
  const [error, setError] = useState('')
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)

  // Show the stored key when it changes elsewhere
  const [shown, setShown] = useState(finnhubApiKey)
  if (shown !== finnhubApiKey) {
    setShown(finnhubApiKey)
    setKey(finnhubApiKey)
  }

  const trimmed = key.trim()
  const changed = trimmed !== finnhubApiKey

  /** Saves the key, then checks it with Finnhub. Blur only saves a change. */
  async function save(e?: FormEvent) {
    e?.preventDefault()
    if (!e && !changed) return
    if (/\s/.test(trimmed)) return setError("API keys don't contain spaces")
    if (trimmed.length > 100) return setError("That's too long for an API key")
    setError('')
    if (changed) {
      await updateSettings({ finnhubApiKey: trimmed })
      await forgetEarningsRefusals()
    }
    setKey(trimmed)
    if (!trimmed) {
      setStatus(finnhubApiKey ? { tone: 'ok', text: 'API key removed. Prices are off.' } : null)
      return
    }
    setTesting(true)
    setStatus(null)
    try {
      setStatus(keyTestText(await testApiKey(trimmed)))
    } finally {
      setTesting(false)
    }
  }

  return (
    <form noValidate onSubmit={save} className="space-y-4">
      <Field
        id="settings-api-key"
        label="Finnhub API key"
        error={error}
        hint="Saved only on this device and never included in backups"
      >
        <div className="flex gap-2">
          <input
            {...fieldA11y('settings-api-key', error || undefined)}
            // A text field with masked dots, so iOS doesn't offer to save it as a password
            className={`${inputClass} flex-1 font-mono ${reveal ? '' : '[-webkit-text-security:disc]'}`}
            value={key}
            onChange={(e) => {
              setKey(e.target.value)
              setStatus(null)
            }}
            onBlur={() => save()}
            autoFocus={params.get('focus') === 'api-key'}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            placeholder="Paste your key"
          />
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            aria-pressed={reveal}
            disabled={!key}
            className="shrink-0 rounded-lg border border-border px-3 text-sm font-medium text-muted disabled:opacity-40"
          >
            {reveal ? 'Hide' : 'Show'}
          </button>
        </div>
      </Field>

      <button
        type="submit"
        disabled={testing || (!trimmed && !finnhubApiKey)}
        className="w-full rounded-xl border border-border py-3 font-medium disabled:opacity-40"
      >
        {testing ? 'Checking…' : changed ? (trimmed ? 'Save and test' : 'Remove key') : 'Test key'}
      </button>

      {status && (
        <p
          role={status.tone === 'error' ? 'alert' : 'status'}
          className={`text-sm ${status.tone === 'error' ? 'text-loss' : 'text-gain'}`}
        >
          {status.text}
        </p>
      )}

      <p className="text-xs text-muted">
        Prices come from Finnhub&apos;s free plan (US stocks, 60 requests a minute).{' '}
        <a
          href="https://finnhub.io/register"
          target="_blank"
          rel="noreferrer"
          className="text-accent underline underline-offset-2"
        >
          Get a free key
        </a>
        , then paste it here. A new device needs the key entered again.
      </p>
    </form>
  )
}

/** What a relay test found, in words. */
function relayTestText(result: ExtendedResult): Status {
  if (result.ok) {
    if (result.failed.size > 0) {
      return {
        tone: 'error',
        text: 'The relay answered, but Yahoo failed for AAPL. Try again in a minute.',
      }
    }
    const q = result.quotes.get('AAPL')
    if (!q) {
      return { tone: 'ok', text: 'Relay works. AAPL has no pre-market or after-hours trade yet.' }
    }
    const session = q.session === 'pre' ? 'pre-market' : 'after hours'
    return { tone: 'ok', text: `Relay works: AAPL ${session} ${formatPrice(q.price)}.` }
  }
  switch (result.error) {
    case 'bad-relay':
      return {
        tone: 'error',
        text: 'That URL answered, but not like the TradeLog relay. Copy the workers.dev address wrangler printed.',
      }
    case 'rate-limited':
      return {
        tone: 'error',
        text: 'Yahoo is rate limiting the relay. Wait a minute and test again.',
      }
    case 'offline':
      return { tone: 'error', text: "Saved. You're offline, so the relay will be checked later." }
    default:
      return {
        tone: 'error',
        text: "Couldn't reach the relay. Check the URL, and that this site is listed in ALLOWED_ORIGINS.",
      }
  }
}

/** A relay URL as saved: no spaces, no trailing slash or /quotes path. */
function normalizeRelayUrl(text: string): string {
  return text
    .trim()
    .replace(/\/quotes\/?$/, '')
    .replace(/\/+$/, '')
}

function RelaySettings({ settings }: { settings: AppSettings }) {
  const { priceRelayUrl } = settings
  const [params] = useSearchParams()
  const [url, setUrl] = useState(priceRelayUrl)
  const [error, setError] = useState('')
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)

  // Show the stored URL when it changes elsewhere
  const [shown, setShown] = useState(priceRelayUrl)
  if (shown !== priceRelayUrl) {
    setShown(priceRelayUrl)
    setUrl(priceRelayUrl)
  }

  const normalized = normalizeRelayUrl(url)
  const changed = normalized !== priceRelayUrl

  /** Saves the URL, then asks the relay for one price. Blur only saves a change. */
  async function save(e?: FormEvent) {
    e?.preventDefault()
    if (!e && !changed) return
    // https, or plain http for a relay running on this computer while developing
    const valid = /^(https:\/\/[^\s/]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)(\/\S*)?$/
    if (normalized && !valid.test(normalized)) {
      return setError('Enter the https:// address of your relay')
    }
    setError('')
    if (changed) await updateSettings({ priceRelayUrl: normalized })
    setUrl(normalized)
    if (!normalized) {
      setStatus(
        priceRelayUrl ? { tone: 'ok', text: 'Relay removed. Showing closing prices only.' } : null,
      )
      return
    }
    setTesting(true)
    setStatus(null)
    try {
      setStatus(relayTestText(await testRelay(normalized)))
    } finally {
      setTesting(false)
    }
  }

  return (
    <form noValidate onSubmit={save} className="space-y-4">
      <Field
        id="settings-relay"
        label="Price relay URL"
        error={error}
        hint="Your Cloudflare Worker, e.g. https://tradelog-prices.you.workers.dev"
      >
        <input
          {...fieldA11y('settings-relay', error || undefined)}
          className={`${inputClass} font-mono text-sm`}
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value)
            setStatus(null)
          }}
          onBlur={() => save()}
          autoFocus={params.get('focus') === 'relay'}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          placeholder="https://…workers.dev"
        />
      </Field>

      <button
        type="submit"
        disabled={testing || (!normalized && !priceRelayUrl)}
        className="w-full rounded-xl border border-border py-3 font-medium disabled:opacity-40"
      >
        {testing
          ? 'Checking…'
          : changed
            ? normalized
              ? 'Save and test'
              : 'Remove relay'
            : 'Test relay'}
      </button>

      {status && (
        <p
          role={status.tone === 'error' ? 'alert' : 'status'}
          className={`text-sm ${status.tone === 'error' ? 'text-loss' : 'text-gain'}`}
        >
          {status.text}
        </p>
      )}

      <p className="text-xs text-muted">
        Pre-market (4:00–9:30 AM New York time) and after-hours (4:00–8:00 PM) prices come from
        Yahoo Finance through your own free Cloudflare Worker, since Yahoo doesn&apos;t let web apps
        call it directly. The setup steps are in the relay folder&apos;s README.
      </p>
    </form>
  )
}

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
        A backup holds your trades, watchlist, currencies and balances. Your API key isn't included.
        CSV is for spreadsheets and can't be restored.
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
                  and <span className="text-loss">
                    deletes {plural(replace.removed, 'trade')}
                  </span>{' '}
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

const offlineText: Record<OfflineStatus, string> = {
  ready: 'Ready. TradeLog opens and saves trades without a connection.',
  pending: 'Saving the app for offline use…',
  dev: 'Off while developing; the deployed app works offline',
  unsupported: "This browser can't run TradeLog offline",
  failed: "Couldn't set up offline use. Reopen the app to try again.",
}

const checkText: Record<Exclude<UpdateCheck, 'idle' | 'checking'>, Status> = {
  latest: { tone: 'ok', text: "You're on the latest version." },
  downloading: { tone: 'ok', text: 'Downloading the new version…' },
  offline: { tone: 'error', text: "You're offline. Connect to check for updates." },
  failed: { tone: 'error', text: "Couldn't check for updates. Try again later." },
}

function AboutSettings() {
  const { offline, updateReady, check } = usePwa()
  const standalone = isStandalone()
  const { version, commit, builtAt } = appVersion
  const status: Status | null = updateReady
    ? { tone: 'ok', text: 'New version ready. TradeLog restarts to switch to it.' }
    : check === 'idle' || check === 'checking'
      ? null
      : checkText[check]

  return (
    <>
      <div>
        <p className="font-medium">TradeLog {version}</p>
        <p className="mt-1 text-sm text-muted tabular-nums">
          Built {dateTime.format(builtAt)}
          {commit && ` · ${commit}`}
        </p>
      </div>

      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-muted">Offline</dt>
          <dd className={offline === 'failed' ? 'text-loss' : ''}>{offlineText[offline]}</dd>
        </div>
        <div>
          <dt className="text-muted">Opened from</dt>
          <dd>{standalone ? 'Home Screen' : 'A browser tab'}</dd>
          {!standalone && (
            <dd className="mt-1 text-xs text-muted">
              On iPhone, open this page in Safari and tap Share → Add to Home Screen, then always
              open TradeLog from its icon. A browser tab keeps a separate copy of your data, and
              Safari can erase it after 7 days without a visit.
            </dd>
          )}
        </div>
      </dl>

      <button
        type="button"
        onClick={() => checkForUpdate()}
        disabled={
          check === 'checking' || updateReady || offline === 'dev' || offline === 'unsupported'
        }
        className="w-full rounded-xl border border-border py-3 font-medium disabled:opacity-40"
      >
        {check === 'checking' ? 'Checking…' : 'Check for updates'}
      </button>

      {status && (
        <p
          role={status.tone === 'error' ? 'alert' : 'status'}
          className={`text-sm ${status.tone === 'error' ? 'text-loss' : 'text-gain'}`}
        >
          {status.text}
        </p>
      )}
    </>
  )
}

function Settings() {
  const source = useBackupSource()
  const [params] = useSearchParams()
  const focusBackup = params.get('focus') === 'backup'
  const loaded = source !== undefined

  // "Restore a backup" on an empty journal lands on the Backup section
  useEffect(() => {
    if (loaded && focusBackup) document.getElementById('settings-backup')?.scrollIntoView()
  }, [loaded, focusBackup])

  return (
    <Screen title="Settings">
      {source && (
        <>
          <Section title="Account">
            <AccountSettings settings={source.settings} />
          </Section>
          <Section title="Prices">
            <PriceSettings settings={source.settings} />
          </Section>
          <Section title="Pre-market and after hours">
            <RelaySettings settings={source.settings} />
          </Section>
          <Section id="settings-backup" title="Backup">
            <BackupSettings source={source} />
          </Section>
          <Section title="About">
            <AboutSettings />
          </Section>
        </>
      )}
    </Screen>
  )
}

export default Settings
