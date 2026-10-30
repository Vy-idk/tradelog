import { useEffect, useRef, useState } from 'react'

/** Pull distance (after resistance) that triggers a refresh */
const THRESHOLD = 64
const MAX_PULL = 96
/** Height the indicator rests at while refreshing */
const HOLD = 48
/** Keeps the spinner up long enough to register, even for cached prices */
const MIN_SPIN_MS = 500

type Props = {
  onRefresh: () => Promise<unknown>
  disabled?: boolean
}

/**
 * Touch pull-to-refresh for the screen's scroll area (the closest <main>).
 * Touch only: pair it with a refresh button for mouse and keyboard users.
 */
function PullToRefresh({ onRefresh, disabled = false }: Props) {
  const anchor = useRef<HTMLDivElement>(null)
  const [pull, setPull] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)

  // The touch listeners are attached once and read the latest values here
  const latest = useRef({ onRefresh, disabled, busy })
  useEffect(() => {
    latest.current = { onRefresh, disabled, busy }
  })

  useEffect(() => {
    const main = anchor.current?.closest('main')
    if (!main) return
    let startY: number | null = null
    let distance = 0

    const reset = () => {
      startY = null
      distance = 0
      setDragging(false)
    }

    const onStart = (e: TouchEvent) => {
      const { disabled, busy } = latest.current
      startY =
        !disabled && !busy && main.scrollTop <= 0 && e.touches.length === 1
          ? e.touches[0].clientY
          : null
      distance = 0
    }

    const onMove = (e: TouchEvent) => {
      if (startY === null) return
      const dy = e.touches[0].clientY - startY
      if (dy <= 0 || main.scrollTop > 0) {
        // Pushed back up: hand the gesture back to normal scrolling
        if (distance > 0) {
          setPull(0)
          setDragging(false)
        }
        startY = null
        return
      }
      // Without this, iOS rubber-bands the whole scroll area instead
      if (e.cancelable) e.preventDefault()
      distance = Math.min(MAX_PULL, dy * 0.5)
      setDragging(true)
      setPull(distance)
    }

    const onEnd = () => {
      if (startY === null) return
      const pulled = distance
      reset()
      if (pulled < THRESHOLD) {
        setPull(0)
        return
      }
      setBusy(true)
      setPull(HOLD)
      const minSpin = new Promise((r) => setTimeout(r, MIN_SPIN_MS))
      Promise.all([latest.current.onRefresh().catch(() => {}), minSpin]).finally(() => {
        setBusy(false)
        setPull(0)
      })
    }

    const onCancel = () => {
      reset()
      setPull(0)
    }

    main.addEventListener('touchstart', onStart, { passive: true })
    main.addEventListener('touchmove', onMove, { passive: false })
    main.addEventListener('touchend', onEnd)
    main.addEventListener('touchcancel', onCancel)
    return () => {
      main.removeEventListener('touchstart', onStart)
      main.removeEventListener('touchmove', onMove)
      main.removeEventListener('touchend', onEnd)
      main.removeEventListener('touchcancel', onCancel)
    }
  }, [])

  const ready = pull >= THRESHOLD
  return (
    <div
      ref={anchor}
      aria-hidden
      style={{ height: pull }}
      className={`flex items-end justify-center overflow-hidden ${
        dragging ? '' : 'transition-[height] duration-200 ease-out'
      }`}
    >
      <div className="mb-2 grid size-8 place-items-center rounded-full border border-border bg-surface text-muted">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={busy ? 'animate-spin text-accent' : ready ? 'text-accent' : ''}
          style={busy ? undefined : { transform: `rotate(${(pull / THRESHOLD) * 270}deg)` }}
        >
          <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
          <path d="M21 3v5h-5" />
        </svg>
      </div>
    </div>
  )
}

export default PullToRefresh
