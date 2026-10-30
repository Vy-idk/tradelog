import { useSyncExternalStore } from 'react'
import type { CashMove } from './cash.ts'

// Kept outside React: the trade form closes as it saves, so the notice has to
// outlive the screen that caused it
let current: CashMove | null = null
const listeners = new Set<() => void>()

function set(move: CashMove | null) {
  current = move
  for (const listener of listeners) listener()
}

export const showCashNotice = (move: CashMove) => set(move)
export const clearCashNotice = () => set(null)

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The conversion or shortfall from the last save, until it's dismissed. */
export function useCashNotice(): CashMove | null {
  return useSyncExternalStore(subscribe, () => current)
}
