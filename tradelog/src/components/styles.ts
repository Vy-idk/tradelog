export const inputClass =
  'block min-h-12 w-full rounded-lg border border-border bg-bg px-3 py-2.5 outline-none placeholder:text-muted/60 focus:border-accent aria-[invalid=true]:border-loss'

/** A typed amount can't be masked, so it blurs until it's tapped to edit. */
export const blurWhenHidden = (hidden: boolean) => (hidden ? 'blur-sm focus:blur-none' : '')

/** Small buttons and links, e.g. an empty state's next step */
export const primaryActionClass = 'rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-bg'
export const secondaryActionClass = 'rounded-lg border border-border px-4 py-2.5 text-sm font-medium'

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
