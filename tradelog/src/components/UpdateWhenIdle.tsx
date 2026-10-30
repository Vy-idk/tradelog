import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { applyUpdate, usePwa } from '../lib/pwa.ts'

/** Lets a blur finish saving (Settings saves fields on blur) before the reload */
const SETTLE_MS = 1000

/** Nothing half-entered would be lost by reloading right now. */
function idle(pathname: string): boolean {
  if (pathname.startsWith('/trade/')) return false
  if (document.querySelector('dialog[open]')) return false
  const focused = document.activeElement
  return !(
    focused instanceof HTMLInputElement ||
    focused instanceof HTMLTextAreaElement ||
    focused instanceof HTMLSelectElement
  )
}

/**
 * Switches to a newly downloaded version as soon as nothing is being
 * edited: no trade form, open dialog or focused field. Usually that's right
 * after launch, so the update looks like part of opening the app.
 */
function UpdateWhenIdle() {
  const { updateReady } = usePwa()
  const { pathname } = useLocation()

  useEffect(() => {
    if (!updateReady) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const attempt = () => {
      clearTimeout(timer)
      timer = setTimeout(() => idle(pathname) && applyUpdate(), SETTLE_MS)
    }
    attempt()
    // Dialogs closing and fields losing focus are the moments it may become idle
    document.addEventListener('focusout', attempt)
    document.addEventListener('close', attempt, true)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('focusout', attempt)
      document.removeEventListener('close', attempt, true)
    }
  }, [updateReady, pathname])

  return null
}

export default UpdateWhenIdle
