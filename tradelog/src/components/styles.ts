export const inputClass =
  'block min-h-12 w-full rounded-lg border border-border bg-bg px-3 py-2.5 outline-none placeholder:text-muted/60 focus:border-accent aria-[invalid=true]:border-loss'

export const chipClass =
  'rounded-full border px-3 py-1.5 text-sm border-border text-muted aria-pressed:border-accent aria-pressed:text-accent'

/** Props that wire a control to its Field's label and error message. */
export function fieldA11y(id: string, error: string | undefined) {
  return {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-error` : undefined,
  }
}

/** Signed P&L text in green or red; neutral at exactly zero. */
export function pnlColor(value: number): string {
  if (Math.abs(value) < 0.005) return 'text-muted'
  return value > 0 ? 'text-gain' : 'text-loss'
}
