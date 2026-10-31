// Canonical time/date formatting. Shared `Intl` instances (created once, not
// per-render) + relative-time helpers. Every surface that shows a timestamp or
// an age pulls from here so the rendered strings stay consistent app-wide.

export const SECOND = 1000
export const MINUTE = 60_000
export const HOUR = 3_600_000
export const DAY = 86_400_000

// ── Absolute date/time formatters ──────────────────────────────────────────
// `hh:mm` clock (thread today/yesterday lines).
export const fmtClock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

// Compact "day + clock", no year/seconds (artifacts, thread fallback, cron runs).
export const fmtDayTime = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  month: 'short'
})

// Medium date + short time (command center session detail).
export const fmtDateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

// Weekday + full date + clock (message time tooltips).
export const fmtFullDateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' })

// Date only, "5 Jun 2026" (starmap tooltip).
export const fmtDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

// Weekday + day + month — the sessions sidebar's day-section heading ("Thursday
// 18 June"). A second formatter adds the year once a day is not in the current
// one; Intl resolves both from the runtime locale.
export const fmtDayHeading = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'long',
  weekday: 'long'
})
export const fmtDayHeadingYear = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'long',
  weekday: 'long',
  year: 'numeric'
})

// ── Relative time ──────────────────────────────────────────────────────────
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' })

// Localized bidirectional "in 5 min" / "2 hr ago" — coarsest sensible unit so a
// daily job reads "in 14 hr", not "in 840 min".
export function relativeTime(targetMs: number, nowMs = Date.now()): string {
  const diff = targetMs - nowMs
  const abs = Math.abs(diff)
  const sign = diff < 0 ? -1 : 1

  if (abs < MINUTE) {
    return rtf.format(sign * Math.round(abs / SECOND), 'second')
  }

  if (abs < HOUR) {
    return rtf.format(sign * Math.round(abs / MINUTE), 'minute')
  }

  if (abs < DAY) {
    return rtf.format(sign * Math.round(abs / HOUR), 'hour')
  }

  return rtf.format(sign * Math.round(abs / DAY), 'day')
}

export const startOfLocalDay = (ms: number): number => {
  const d = new Date(ms)

  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

// The human day doesn't end at midnight — it ends when you sleep. Sessions
// from the small hours belong to the previous evening's run, so the day
// boundary sits at 4 AM local (same trick activity/sleep trackers use).
// A 12:30 AM session groups with 11:50 PM instead of splitting off.
export const DAY_ROLLOVER_HOUR = 4

// Start of the *nominal* local day a timestamp belongs to, honoring the 4 AM
// rollover: Saturday 1 AM → start of Friday.
export const nominalDayStart = (ms: number): number => startOfLocalDay(ms - DAY_ROLLOVER_HOUR * HOUR)

// Stable section id for one nominal day: the same day always collapses under
// the same key, across reloads and across the two render paths.
export function daySectionKey(dayStart: number): string {
  const d = new Date(dayStart)
  const month = `${d.getMonth() + 1}`.padStart(2, '0')
  const date = `${d.getDate()}`.padStart(2, '0')

  return `day:${d.getFullYear()}-${month}-${date}`
}

// Fixed day-section labels, resolved from i18n. Every other day is formatted
// by Intl (see fmtDayHeading).
export interface SessionDayLabels {
  today: string
  yesterday: string
}

// Localized heading for one day section. `dayStart` is a `nominalDayStart()`
// value. Today and yesterday get their translated label; an older day reads as
// its weekday + date, with the year once it isn't the current one. Today is
// normally the unlabelled top of the list — the label is only needed when the
// list isn't sorted newest-first (project lanes) and today appears mid-list.
export function sessionDayLabel(dayStart: number, labels: SessionDayLabels, nowMs = Date.now()): string {
  const todayStart = nominalDayStart(nowMs)
  const dayDiff = Math.round((todayStart - dayStart) / DAY)

  if (dayDiff <= 0) {
    return labels.today
  }

  if (dayDiff === 1) {
    return labels.yesterday
  }

  const sameYear = new Date(dayStart).getFullYear() === new Date(todayStart).getFullYear()

  return (sameYear ? fmtDayHeading : fmtDayHeadingYear).format(dayStart)
}

export type ElapsedUnit = 'day' | 'hour' | 'minute' | 'second'

// Coarsest elapsed bucket for a (clamped-nonnegative) duration, floored. The
// caller owns rendering — compact "5m", "5m ago", etc. — so no format is baked
// in here.
export function coarseElapsed(deltaMs: number): { unit: ElapsedUnit; value: number } {
  const ms = Math.max(0, deltaMs)

  if (ms >= DAY) {
    return { unit: 'day', value: Math.floor(ms / DAY) }
  }

  if (ms >= HOUR) {
    return { unit: 'hour', value: Math.floor(ms / HOUR) }
  }

  if (ms >= MINUTE) {
    return { unit: 'minute', value: Math.floor(ms / MINUTE) }
  }

  return { unit: 'second', value: Math.floor(ms / SECOND) }
}

// Localized strings for `formatAgo`; shaped to accept `t.agents` directly.
export interface AgoLabels {
  ageNow: string
  ageSeconds: (seconds: number) => string
  ageMinutes: (minutes: number) => string
  ageHours: (hours: number) => string
  ageDays: (days: number) => string
}

// Compact localized "2h ago" / "3m ago" / "now" for a past timestamp, bucketed
// via `coarseElapsed` so every age label reads consistently.
export function formatAgo(fromMs: number, labels: AgoLabels, nowMs = Date.now()): string {
  const { unit, value } = coarseElapsed(nowMs - fromMs)

  if (unit === 'second') {
    return value < 2 ? labels.ageNow : labels.ageSeconds(value)
  }

  const by = { day: labels.ageDays, hour: labels.ageHours, minute: labels.ageMinutes }

  return by[unit](value)
}
