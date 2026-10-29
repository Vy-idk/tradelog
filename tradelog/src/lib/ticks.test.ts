import { describe, expect, it } from 'vitest'
import { axisMoneyFormatter } from './format.ts'
import { niceTicks } from './ticks.ts'

describe('niceTicks', () => {
  it('covers the range with round 1-2-5 steps', () => {
    expect(niceTicks(25_100, 26_950)).toEqual({
      ticks: [25_000, 25_500, 26_000, 26_500, 27_000],
      step: 500,
    })
    expect(niceTicks(-365, 1905)).toEqual({ ticks: [-1000, 0, 1000, 2000], step: 1000 })
    expect(niceTicks(0.1, 0.35)).toEqual({ ticks: [0.1, 0.2, 0.3, 0.4], step: 0.1 })
  })

  it('pads a flat range', () => {
    const { ticks } = niceTicks(500, 500)
    expect(ticks[0]).toBeLessThan(500)
    expect(ticks.at(-1)).toBeGreaterThan(500)
    expect(niceTicks(0, 0).ticks).toEqual([-1, -0.5, 0, 0.5, 1])
  })
})

describe('axisMoneyFormatter', () => {
  // The symbol depends on the locale ($ or US$), so compare without it
  const labels = (ticks: number[]) =>
    ticks.map(axisMoneyFormatter(ticks, 'USD')).map((l) => l.replace(/[^\d.,KM−]/g, ''))

  it('uses short labels when they stay distinct', () => {
    expect(labels([25_000, 25_500, 26_000])).toEqual(['25K', '25.5K', '26K'])
    expect(labels([1_000_000, 1_250_000])).toEqual(['1M', '1.25M'])
    expect(labels([-250, 0, 250])).toEqual(['−250', '0', '250'])
  })

  it('falls back to full numbers when short ones would repeat', () => {
    expect(labels([25_000, 25_010, 25_020])).toEqual(['25,000', '25,010', '25,020'])
    expect(labels([0.5, 1, 1.5])).toEqual(['0.50', '1.00', '1.50'])
  })
})
