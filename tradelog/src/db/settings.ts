import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Settings } from './schema.ts'

export const DEFAULT_SETTINGS: Settings = {
  id: 'app',
  finnhubApiKey: '',
  currency: 'USD',
  startingBalance: 0,
  lastBackupAt: null,
}

/** The single settings row merged over defaults, so it's never missing a field. */
export function useSettings(): Settings {
  const row = useLiveQuery(() => db.settings.get('app'))
  return { ...DEFAULT_SETTINGS, ...row }
}
