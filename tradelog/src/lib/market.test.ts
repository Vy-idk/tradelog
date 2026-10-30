import { describe, expect, it } from 'vitest'
import { priceSession, sessionAt } from './market.ts'

const at = (iso: string) => Date.parse(iso)

describe('sessionAt', () => {
  // Thursday Oct 29, 2026 is daylight time in New York (UTC−4)
  it('splits a weekday into pre-market, regular and after hours, New York time', () => {
    expect(sessionAt(at('2026-10-29T07:59:00Z'))).toBe('closed') // 3:59
    expect(sessionAt(at('2026-10-29T08:00:00Z'))).toBe('pre') // 4:00
    expect(sessionAt(at('2026-10-29T13:29:00Z'))).toBe('pre') // 9:29
    expect(sessionAt(at('2026-10-29T13:30:00Z'))).toBe('regular') // 9:30
    expect(sessionAt(at('2026-10-29T20:00:00Z'))).toBe('regular') // 16:00 closing print
    expect(sessionAt(at('2026-10-29T20:01:00Z'))).toBe('post') // 16:01
    expect(sessionAt(at('2026-10-29T23:59:00Z'))).toBe('post') // 19:59
    expect(sessionAt(at('2026-10-30T00:00:00Z'))).toBe('closed') // 20:00
  })

  it('follows New York across the end of daylight time', () => {
    // Monday Nov 2, 2026 is standard time (UTC−5)
    expect(sessionAt(at('2026-11-02T14:00:00Z'))).toBe('pre') // 9:00
    expect(sessionAt(at('2026-11-02T14:30:00Z'))).toBe('regular') // 9:30
  })

  it('is closed at weekends', () => {
    expect(sessionAt(at('2026-10-31T15:00:00Z'))).toBe('closed') // Saturday 11:00
    expect(sessionAt(at('2026-11-01T22:00:00Z'))).toBe('closed') // Sunday 17:00
  })
})

describe('priceSession', () => {
  it('labels pre-market and after-hours prices', () => {
    expect(priceSession(at('2026-10-29T12:15:00Z'), at('2026-10-29T12:16:00Z'))).toBe('pre')
    expect(priceSession(at('2026-10-29T23:30:00Z'), at('2026-10-29T23:31:00Z'))).toBe('post')
  })

  it('calls a regular-session price the close once that session is over', () => {
    const close = at('2026-10-29T20:00:00Z')
    expect(priceSession(close, at('2026-10-29T23:00:00Z'))).toBe('close') // same evening
    expect(priceSession(close, at('2026-10-30T12:00:00Z'))).toBe('close') // next pre-market
    expect(priceSession(close, at('2026-10-30T15:00:00Z'))).toBe('close') // next day, no trade yet
  })

  it('leaves a live regular-session price unlabelled', () => {
    expect(priceSession(at('2026-10-29T18:00:00Z'), at('2026-10-29T18:01:00Z'))).toBeNull()
  })

  it('has no label when the price time is unknown', () => {
    expect(priceSession(0, at('2026-10-29T23:00:00Z'))).toBeNull()
  })
})
