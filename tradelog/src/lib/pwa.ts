import { useSyncExternalStore } from 'react'
import { registerSW } from 'virtual:pwa-register'

export type OfflineStatus =
  /** The browser has no service workers */
  | 'unsupported'
  /** `npm run dev` serves files live, without the service worker */
  | 'dev'
  /** First visit: the files are still downloading */
  | 'pending'
  /** Every file is cached, so the app opens without a connection */
  | 'ready'
  | 'failed'

export type UpdateCheck = 'idle' | 'checking' | 'latest' | 'downloading' | 'offline' | 'failed'

export type PwaState = {
  offline: OfflineStatus
  /** A new version is downloaded and waits to take over (see UpdateWhenIdle) */
  updateReady: boolean
  /** The last "Check for updates" tap */
  check: UpdateCheck
}

/** Coming back to the app checks for a new version at most this often */
const RESUME_CHECK_MS = 60_000
/** And it checks this often while it stays open */
const OPEN_CHECK_MS = 60 * 60_000

let state: PwaState = {
  offline: !('serviceWorker' in navigator) ? 'unsupported' : import.meta.env.DEV ? 'dev' : 'pending',
  updateReady: false,
  check: 'idle',
}
const listeners = new Set<() => void>()
let registration: ServiceWorkerRegistration | undefined
let activateUpdate: (() => Promise<void>) | undefined
let applying = false
let lastCheckAt = 0

function set(changes: Partial<PwaState>) {
  state = { ...state, ...changes }
  for (const listener of listeners) listener()
}

/** Asks the server for a new service worker; true if one is on its way. */
async function fetchUpdate(): Promise<boolean> {
  if (!registration) throw new Error('No service worker')
  lastCheckAt = Date.now()
  await registration.update()
  return Boolean(registration.installing || registration.waiting)
}

/** A quiet check, e.g. when the app comes back from the background. */
function checkInBackground() {
  if (!navigator.onLine || Date.now() - lastCheckAt < RESUME_CHECK_MS) return
  fetchUpdate().catch(() => {})
}

/**
 * Registers the service worker that caches the app for offline use. iOS
 * keeps a home screen app alive in the background, so a reopened app checks
 * for a new version itself instead of waiting for the next cold start.
 */
export function startPwa() {
  if (state.offline !== 'pending') return
  activateUpdate = registerSW({
    immediate: true,
    onOfflineReady: () => set({ offline: 'ready' }),
    onNeedRefresh: () => set({ updateReady: true }),
    onRegisteredSW: (_url, r) => {
      registration = r
      // Registering fetches the service worker, which is itself a check
      lastCheckAt = Date.now()
      // An active worker has already cached everything
      if (r?.active) set({ offline: 'ready' })
    },
    onRegisterError: () => set({ offline: 'failed' }),
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkInBackground()
  })
  window.addEventListener('online', checkInBackground)
  setInterval(checkInBackground, OPEN_CHECK_MS)
}

/** For the Settings button. A found update installs, then applies itself when idle. */
export async function checkForUpdate(): Promise<void> {
  if (state.updateReady) return
  if (!navigator.onLine) return set({ check: 'offline' })
  set({ check: 'checking' })
  try {
    set({ check: (await fetchUpdate()) ? 'downloading' : 'latest' })
  } catch {
    set({ check: navigator.onLine ? 'failed' : 'offline' })
  }
}

/** Switches to the waiting version; the page reloads once it takes over. */
export function applyUpdate() {
  if (!state.updateReady || applying || !activateUpdate) return
  applying = true
  activateUpdate().catch(() => {
    applying = false
  })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function usePwa(): PwaState {
  return useSyncExternalStore(subscribe, () => state)
}

/** True when opened from the home screen rather than in a browser tab. */
export function isStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone
  return iosStandalone === true || window.matchMedia('(display-mode: standalone)').matches
}

export const appVersion = {
  version: __APP_VERSION__,
  commit: __APP_COMMIT__,
  builtAt: new Date(__APP_BUILT_AT__),
}
