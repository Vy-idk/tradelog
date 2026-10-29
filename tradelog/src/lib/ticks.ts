export type Ticks = { ticks: number[]; step: number }

/** Smallest of 1, 2 or 5 × 10ⁿ that is at least `raw`. */
function niceStep(raw: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].find((m) => m * magnitude >= raw - 1e-12)!
  return step * magnitude
}

/**
 * Round axis ticks covering [min, max], about `count` of them, on steps of
 * 1, 2 or 5 × 10ⁿ (e.g. 25,000 / 25,500 / 26,000). A flat range is padded
 * so the line sits in the middle.
 */
export function niceTicks(min: number, max: number, count = 5): Ticks {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { ticks: [0], step: 1 }
  if (max < min) [min, max] = [max, min]
  if (max - min < 1e-9) {
    const pad = Math.max(Math.abs(min) * 0.01, 1)
    min -= pad
    max += pad
  }
  const step = niceStep((max - min) / Math.max(count - 1, 1))
  const first = Math.floor(min / step + 1e-9) * step
  const last = Math.ceil(max / step - 1e-9) * step
  const ticks: number[] = []
  for (let i = 0; first + i * step <= last + step / 2; i++) {
    // toPrecision trims float noise like 0.30000000000000004
    ticks.push(Number((first + i * step).toPrecision(12)))
  }
  return { ticks, step }
}
