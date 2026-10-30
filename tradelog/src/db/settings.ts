import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Settings } from './schema.ts'

export const DEFAULT_SETTINGS: Settings = {
  id: 'app',
  finnhubApiKey: '',
  priceRelayUrl: '',
  currency: 'USD',
  startingBalance: 0,
  lastBackupAt: null,
  backupReminderSnoozedUntil: null,
}

/** The single settings row merged over defaults, so it's never missing a field. */
export function useSettings(): Settings {
  const row = useLiveQuery(() => db.settings.get('app'))
  return { ...DEFAULT_SETTINGS, ...row }
}

/** Like useSettings, but undefined while loading, so screens don't flash the defaults. */
export function useLoadedSettings(): Settings | undefined {
  return useLiveQuery(async () => ({ ...DEFAULT_SETTINGS, ...(await db.settings.get('app')) }))
}

/** Saves some settings, creating the row on first use. */
export async function updateSettings(changes: Partial<Omit<Settings, 'id'>>): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const current = await db.settings.get('app')
    await db.settings.put({ ...DEFAULT_SETTINGS, ...current, ...changes })
  })
}
