import { describe, expect, it } from 'vitest'
import { findListing } from './symbols.ts'

describe('findListing', () => {
  const body = {
    count: 3,
    result: [
      {
        description: 'LOCKHEED MARTIN CORP',
        displaySymbol: 'LMT.MX',
        symbol: 'LMT.MX',
        type: 'Common Stock',
      },
      {
        description: 'LOCKHEED MARTIN CORP',
        displaySymbol: 'LMT',
        symbol: 'LMT',
        type: 'Common Stock',
      },
      { description: 'SPDR S&P 500 ETF TRUST', displaySymbol: 'SPY', symbol: 'SPY', type: 'ETP' },
    ],
  }

  it('finds the exact US listing with its name', () => {
    expect(findListing('LMT', body)).toEqual({ name: 'LOCKHEED MARTIN CORP' })
    expect(findListing('SPY', body)).toEqual({ name: 'SPDR S&P 500 ETF TRUST' })
  })

  it("doesn't match a partial symbol or a bad answer", () => {
    expect(findListing('LM', body)).toBeNull()
    expect(findListing('LMT', { count: 0, result: [] })).toBeNull()
    expect(findListing('LMT', { error: 'Please use an API key.' })).toBeNull()
    expect(findListing('LMT', null)).toBeNull()
  })
})
