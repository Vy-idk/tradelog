import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'
import { FX_RATES_URL, FX_TTL, parseFxRates, type FxRates } from '../lib/fx.ts'
import { db } from './schema.ts'

const REQUEST_TIMEOUT = 10_000

/** The saved exchange rates; null before the first fetch, undefined while loading. */
export function useFxRates(): FxRates | null | undefined {
  return useLiveQuery(async () => ((await db.fxRates.get('USD')) as FxRates | undefined) ?? null)
}

let pending: Promise<void> | null = null

/** Fetches rates older than FX_TTL and saves them. Never throws; failures keep the old ones. */
export function refreshFxRates(): Promise<void> {
  pending ??= (async () => {
    try {
      const saved = await db.fxRates.get('USD')
      if (saved && Date.now() - saved.fetchedAt < FX_TTL) return
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
      try {
        const res = await fetch(FX_RATES_URL, { signal: controller.signal })
        if (!res.ok) return
        const rates = parseFxRates(await res.json(), Date.now())
        if (rates) await db.fxRates.put(rates)
      } finally {
        clearTimeout(timer)
      }
    } catch {
      // Offline or the service is down: the saved rates stay in use
    } finally {
      pending = null
    }
  })()
  return pending
}

/** Keeps the saved rates fresh while a screen that converts money is open. */
export function useFxRefresh(needed: boolean): void {
  useEffect(() => {
    if (!needed) return
    void refreshFxRates()
    const onOnline = () => void refreshFxRates()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [needed])
}
