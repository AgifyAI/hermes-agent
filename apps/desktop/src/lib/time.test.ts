import { describe, expect, it } from 'vitest'

import {
  DAY,
  daySectionKey,
  formatAgo,
  HOUR,
  isTodayTimestamp,
  MINUTE,
  nominalDayStart,
  SECOND,
  sessionDayLabel
} from './time'

const labels = {
  ageNow: 'now',
  ageSeconds: (s: number) => `${s}s ago`,
  ageMinutes: (m: number) => `${m}m ago`,
  ageHours: (h: number) => `${h}h ago`,
  ageDays: (d: number) => `${d}d ago`
}

const now = 1_000 * DAY
const ago = (delta: number) => formatAgo(now - delta, labels, now)

describe('formatAgo', () => {
  it('reads "now" under two seconds, then seconds', () => {
    expect(ago(0)).toBe('now')
    expect(ago(1.5 * SECOND)).toBe('now')
    expect(ago(5 * SECOND)).toBe('5s ago')
  })

  it('buckets to the coarsest unit, floored', () => {
    expect(ago(3 * MINUTE)).toBe('3m ago')
    expect(ago(2 * HOUR + 59 * MINUTE)).toBe('2h ago')
    expect(ago(5 * DAY)).toBe('5d ago')
  })

  it('clamps future timestamps to "now"', () => {
    expect(ago(-HOUR)).toBe('now')
  })
})

// Thursday 18 Jun 2026, local noon (15 Jun 2026 is a Monday).
const THU_NOON = new Date(2026, 5, 18, 12, 0, 0).getTime()

const dayStartAt = (year: number, month: number, day: number, hour = 10) =>
  nominalDayStart(new Date(year, month, day, hour, 0, 0).getTime())

describe('nominalDayStart', () => {
  it('rolls the day boundary at 4 AM, not midnight', () => {
    // 1 AM Saturday still belongs to Friday's run.
    expect(nominalDayStart(new Date(2026, 5, 20, 1, 30).getTime())).toBe(new Date(2026, 5, 19).getTime())
    expect(nominalDayStart(new Date(2026, 5, 20, 4, 30).getTime())).toBe(new Date(2026, 5, 20).getTime())
  })
})

describe('sessionDayLabel', () => {
  const dayLabels = { today: 'Today', yesterday: 'Yesterday' }

  const labelAt = (year: number, month: number, day: number, hour = 10) =>
    sessionDayLabel(dayStartAt(year, month, day, hour), dayLabels, THU_NOON)

  it('translates today and yesterday', () => {
    expect(labelAt(2026, 5, 18)).toBe('Today')
    expect(labelAt(2026, 5, 17)).toBe('Yesterday')
  })

  it('assigns the small hours to the previous evening', () => {
    // Viewed just after midnight, last evening's sessions are still "today".
    const smallHours = new Date(2026, 5, 19, 0, 58).getTime()

    expect(sessionDayLabel(dayStartAt(2026, 5, 18, 23), dayLabels, smallHours)).toBe('Today')
    expect(sessionDayLabel(dayStartAt(2026, 5, 17, 15), dayLabels, smallHours)).toBe('Yesterday')
  })

  it('formats older days as day + abbreviated month, adding the year only when it differs', () => {
    // Locale-agnostic contract: the month abbreviation comes from Intl, but the
    // order is always day-first ("20 Oct" / "20 oct."), never the locale's
    // month-first ordering. Assert against the shared formatter, not frozen
    // en-US strings, so the test passes under any host locale.
    const shortMonth = new Intl.DateTimeFormat(undefined, { month: 'short' })
    const sameYear = dayStartAt(2026, 5, 16)

    expect(sessionDayLabel(sameYear, dayLabels, THU_NOON)).toBe(`16 ${shortMonth.format(sameYear)}`)

    const priorYear = dayStartAt(2025, 11, 3)

    expect(sessionDayLabel(priorYear, dayLabels, THU_NOON)).toBe(`3 ${shortMonth.format(priorYear)} 2025`)
  })
})

describe('isTodayTimestamp', () => {
  it('uses the same nominal-day (4 AM) boundary as the day sections', () => {
    expect(isTodayTimestamp(Math.floor(new Date(2026, 5, 18, 5).getTime() / 1000), THU_NOON)).toBe(true)
    expect(isTodayTimestamp(Math.floor(new Date(2026, 5, 18, 3).getTime() / 1000), THU_NOON)).toBe(false)
    expect(isTodayTimestamp(Math.floor(new Date(2026, 5, 17, 23).getTime() / 1000), THU_NOON)).toBe(false)
  })

  it('counts the small hours as the previous evening', () => {
    const smallHours = new Date(2026, 5, 19, 0, 58).getTime()

    expect(isTodayTimestamp(Math.floor(new Date(2026, 5, 18, 23).getTime() / 1000), smallHours)).toBe(true)
    // 3 AM is already the previous nominal day: it belongs to Jun 17's section.
    expect(isTodayTimestamp(Math.floor(new Date(2026, 5, 18, 3).getTime() / 1000), smallHours)).toBe(false)
    expect(isTodayTimestamp(Math.floor(new Date(2026, 5, 17, 20).getTime() / 1000), smallHours)).toBe(false)
  })
})

describe('daySectionKey', () => {
  it('keys each nominal day once, zero-padded, ignoring the time of day', () => {
    expect(daySectionKey(dayStartAt(2026, 5, 18, 5))).toBe('day:2026-06-18')
    expect(daySectionKey(dayStartAt(2026, 5, 18, 22))).toBe('day:2026-06-18')
    expect(daySectionKey(dayStartAt(2026, 11, 3))).toBe('day:2026-12-03')
  })
})
