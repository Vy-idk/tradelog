import { describe, expect, it } from 'vitest'
import type { EarningsRow } from '../db/schema.ts'
import {
  EARNINGS_TTL,
  earningsDetail,
  earningsDue,
  earningsText,
  parseEarnings,
  upcomingEarnings,
} from './earnings.ts'

const today = '2026-10-30'

function row(overrides: Partial<EarningsRow> = {}): EarningsRow {
  return { symbol: 'VRT', date: '2026-11-19', hour: 'amc', fetchedAt: 0, ...overrides }
}

describe('parseEarnings', () => {
  it("reads Finnhub's answer, keeping the next report", () => {
    const body = {
      earningsCalendar: [
        { symbol: 'VRT', date: '2027-02-10', hour: 'bmo', year: 2027, quarter: 1 },
        { symbol: 'VRT', date: '2026-11-19', hour: 'amc', year: 2026, quarter: 4 },
        { symbol: 'VRT', date: '2026-08-01', hour: 'amc', year: 2026, quarter: 3 },
      ],
    }
    expect(parseEarnings('VRT', body, today, 5)).toEqual({
      symbol: 'VRT',
      date: '2026-11-19',
      hour: 'amc',
      fetchedAt: 5,
    })
  })

  it('counts a report today, and blanks an hour it does not know', () => {
    const body = { earningsCalendar: [{ symbol: 'VRT', date: today, hour: '' }] }
    expect(parseEarnings('VRT', body, today, 5)).toMatchObject({ date: today, hour: '' })
  })

  it("ignores other symbols' reports and bad dates", () => {
    const body = {
      earningsCalendar: [
        { symbol: 'AAPL', date: '2026-11-01', hour: 'amc' },
        { symbol: 'VRT', date: 'soon', hour: 'amc' },
        null,
      ],
    }
    expect(parseEarnings('VRT', body, today, 5).date).toBeNull()
  })

  it('reads an empty or unexpected answer as no report', () => {
    const none = { symbol: 'SPY', date: null, hour: '', fetchedAt: 5 }
    expect(parseEarnings('SPY', { earningsCalendar: [] }, today, 5)).toEqual(none)
    expect(parseEarnings('SPY', {}, today, 5)).toEqual(none)
    expect(parseEarnings('SPY', null, today, 5)).toEqual(none)
  })
})

describe('earningsDue', () => {
  const now = 1_000_000_000_000

  it('asks about symbols it has never seen, and old answers', () => {
    expect(earningsDue(undefined, today, now)).toBe(true)
    expect(earningsDue(row({ fetchedAt: now - EARNINGS_TTL }), today, now)).toBe(true)
  })

  it('reuses a recent answer, including that there is no report', () => {
    expect(earningsDue(row({ fetchedAt: now - 1000 }), today, now)).toBe(false)
    expect(earningsDue(row({ date: null, fetchedAt: now - 1000 }), today, now)).toBe(false)
  })

  it('asks again as soon as a saved date has passed', () => {
    expect(earningsDue(row({ date: '2026-10-29', fetchedAt: now - 1000 }), today, now)).toBe(true)
  })
})

describe('upcomingEarnings', () => {
  it('keeps today and later, and drops a date that has passed', () => {
    expect(upcomingEarnings(row({ date: today }), today)).toBe(today)
    expect(upcomingEarnings(row({ date: '2026-10-29' }), today)).toBeNull()
    expect(upcomingEarnings(undefined, today)).toBeNull()
  })
})

describe('earningsText', () => {
  it('counts down the days, then gives the date', () => {
    expect(earningsText(today, '', today)).toBe('Earnings today')
    expect(earningsText('2026-10-31', '', today)).toBe('Earnings tomorrow')
    expect(earningsText('2026-11-04', '', today)).toBe('Earnings in 5 days')
    expect(earningsText('2026-11-12', '', today)).toBe('Earnings in 13 days')
    expect(earningsText('2026-11-13', '', today)).toMatch(/^Earnings \D*13\D*$/)
  })

  it('says when in the day', () => {
    expect(earningsText(today, 'bmo', today)).toBe('Earnings today before the open')
    expect(earningsText(today, 'amc', today)).toBe('Earnings today after the close')
    expect(earningsText(today, 'dmh', today)).toBe('Earnings today during market hours')
  })
})

describe('earningsDetail', () => {
  it('stays quiet until Finnhub has been asked', () => {
    expect(earningsDetail(undefined, today)).toBeNull()
  })

  it('explains each answer', () => {
    expect(earningsDetail(row({ date: '2026-11-04', hour: '' }), today)).toBe('Earnings in 5 days')
    expect(earningsDetail(row({ date: null }), today)).toBe('No earnings report scheduled yet.')
    expect(earningsDetail(row({ date: null, noAccess: true }), today)).toMatch(/Finnhub plan/)
  })

  it('still gives a date saved before Finnhub started refusing', () => {
    const saved = row({ date: '2026-11-04', hour: '', noAccess: true })
    expect(earningsDetail(saved, today)).toBe('Earnings in 5 days')
  })
})
