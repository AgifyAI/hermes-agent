import { describe, expect, it } from 'vitest'

import type { SessionInfo } from '@/types/hermes'

import { makeSessionInfo } from '../test/session-info'

import type { SidebarSessionEntry } from './session-branch-tree'
import { groupEntriesByDay, groupEntriesByStatus, hideCollapsedGroupRows, toSessionRows } from './session-date-groups'

const session = (id: string, overrides: Partial<SessionInfo> = {}): SessionInfo =>
  makeSessionInfo({ id, message_count: 1, source: 'cli', title: id, ...overrides })

const entry = (s: SessionInfo, branchStem?: string): SidebarSessionEntry =>
  branchStem ? { branchStem, session: s } : { session: s }

// Fixed "now": Thursday 18 Jun 2026, local noon. The sidebar's nominal day
// starts at 4 AM local, so anything before that still belongs to yesterday.
const NOW = new Date(2026, 5, 18, 12, 0, 0).getTime()

const at = (year: number, month: number, day: number, hour = 10, minute = 0): number =>
  Math.floor(new Date(year, month, day, hour, minute, 0).getTime() / 1000)

const group = (entries: SidebarSessionEntry[], nowMs = NOW) => groupEntriesByDay(entries, nowMs)

const burstOfTwo = (): SidebarSessionEntry[] => [
  entry(session('fresh-a', { last_active: at(2026, 5, 18, 11) })),
  entry(session('fresh-b', { last_active: at(2026, 5, 18, 10, 58) }))
]

const dividerKeys = (rows: ReturnType<typeof groupEntriesByDay>): string[] =>
  rows.flatMap(row => (row.kind === 'divider' ? [row.key] : []))

describe('groupEntriesByDay', () => {
  it('leads with today unlabelled, then one collapsible section per earlier day', () => {
    const rows = group([
      entry(session('a', { last_active: at(2026, 5, 18, 11) })),
      entry(session('b', { last_active: at(2026, 5, 18, 8) })),
      entry(session('c', { last_active: at(2026, 5, 17, 15) })),
      entry(session('d', { last_active: at(2026, 5, 17, 9) })),
      entry(session('e', { last_active: at(2026, 5, 16, 15) })),
      entry(session('f', { last_active: at(2026, 5, 2, 15) }))
    ])

    expect(rows.slice(0, 2).every(row => row.kind === 'session')).toBe(true)
    expect(dividerKeys(rows)).toEqual(['day:2026-06-17', 'day:2026-06-16', 'day:2026-06-02'])
  })

  it('emits no divider when everything is from today', () => {
    const rows = group([
      entry(session('a', { last_active: at(2026, 5, 18, 11) })),
      entry(session('b', { last_active: at(2026, 5, 18, 9) })),
      entry(session('c', { last_active: at(2026, 5, 18, 5) }))
    ])

    expect(rows.every(row => row.kind === 'session')).toBe(true)
  })

  it('labels the first section when the newest session is not from today', () => {
    // Nothing today: the list opens on yesterday, which stays a section so it
    // reads as a day and can be collapsed.
    const rows = group([
      entry(session('a', { last_active: at(2026, 5, 17, 15) })),
      entry(session('b', { last_active: at(2026, 5, 16, 15) }))
    ])

    expect(rows[0]).toMatchObject({ key: 'day:2026-06-17', kind: 'divider' })
    expect(dividerKeys(rows)).toEqual(['day:2026-06-17', 'day:2026-06-16'])
  })

  it('rolls the 4 AM boundary into the previous evening', () => {
    // Viewed at 00:58: tonight plus last evening is one day; the afternoon
    // before it opens the first section.
    const smallHours = new Date(2026, 5, 19, 0, 58).getTime()

    const rows = group(
      [
        entry(session('a', { last_active: at(2026, 5, 19, 0, 30) })),
        entry(session('b', { last_active: at(2026, 5, 18, 23, 50) })),
        entry(session('c', { last_active: at(2026, 5, 18, 20) })),
        entry(session('d', { last_active: at(2026, 5, 17, 20) }))
      ],
      smallHours
    )

    expect(rows.slice(0, 3).every(row => row.kind === 'session')).toBe(true)
    expect(dividerKeys(rows)).toEqual(['day:2026-06-17'])
  })

  it('limits complete day sections without splitting bursts or branch clusters', () => {
    const burst = [
      entry(session('burst-0', { last_active: at(2026, 5, 18, 11) })),
      entry(session('burst-1', { last_active: at(2026, 5, 18, 10, 58) }))
    ]

    const entries = [
      ...burst,
      entry(session('yesterday', { last_active: at(2026, 5, 17, 15) })),
      entry(session('yesterday-2', { last_active: at(2026, 5, 17, 9) })),
      entry(session('older', { last_active: at(2026, 5, 10, 9) }))
    ]

    // Two day sections total: today (unlabelled) + yesterday.
    const limited = groupEntriesByDay(entries, NOW, 2)

    expect(dividerKeys(limited)).toEqual(['day:2026-06-17'])
    expect(limited.slice(0, 2).every(row => row.kind === 'session')).toBe(true)
    expect(groupEntriesByDay(entries, NOW, 1)).toEqual(toSessionRows(burst))
    expect(groupEntriesByDay([], NOW, 2)).toEqual([])
  })

  it('keeps a branch child inside its parent cluster instead of opening a section', () => {
    const parent = session('parent', { last_active: at(2026, 5, 18, 9) })
    const child = session('child', { last_active: at(2026, 5, 17, 9), parent_session_id: 'parent' })

    const rows = group([...burstOfTwo(), entry(parent), entry(child, '└─ ')])

    expect(dividerKeys(rows)).toEqual([])
    expect(rows.at(-1)).toMatchObject({ entry: { session: { id: 'child' } } })
  })

  it('never emits the same day twice under a non-monotonic order', () => {
    // Project lanes can hand over an out-of-order lane: a day divider is
    // emitted once, and a later repeat of that day folds into the open group
    // without a second heading.
    const rows = group([
      entry(session('a', { last_active: at(2026, 5, 16) })),
      entry(session('b', { last_active: at(2026, 5, 15) })),
      entry(session('c', { last_active: at(2026, 5, 16) }))
    ])

    expect(dividerKeys(rows)).toEqual(['day:2026-06-16', 'day:2026-06-15'])
  })

  it('falls back to started_at when last_active is missing', () => {
    const rows = group([
      entry(session('head', { last_active: at(2026, 5, 18, 11) })),
      entry(session('s', { last_active: 0, started_at: at(2026, 5, 10) }))
    ])

    expect(dividerKeys(rows)).toEqual(['day:2026-06-10'])
  })
})

describe('groupEntriesByStatus', () => {
  it('splits the runs under their own labels, keeping branch children attached', () => {
    const parent = session('parent')
    const child = session('child')
    const other = session('other')

    const rows = groupEntriesByStatus(
      [entry(parent), entry(child, '└─ '), entry(other)],
      s => s.session.id === 'parent',
      { working: 'Working', done: 'Done' }
    )

    expect(rows).toEqual([
      { key: 'status:working', kind: 'divider', label: 'Working' },
      { entry: entry(parent), kind: 'session' },
      { entry: entry(child, '└─ '), kind: 'session' },
      { key: 'status:done', kind: 'divider', label: 'Done' },
      { entry: entry(other), kind: 'session' }
    ])
  })
})

describe('hideCollapsedGroupRows', () => {
  const dayRow = (day: number, key: string) => ({ day, key, kind: 'divider' as const })

  it('returns the same array when every group is open', () => {
    const rows = [
      { entry: entry(session('a')), kind: 'session' as const },
      dayRow(1, 'day:2026-06-17'),
      { entry: entry(session('b')), kind: 'session' as const }
    ]

    expect(hideCollapsedGroupRows(rows, () => true)).toBe(rows)
  })

  it('keeps the divider and drops sessions under a closed day', () => {
    const rows = [
      { entry: entry(session('head')), kind: 'session' as const },
      dayRow(1, 'day:2026-06-17'),
      { entry: entry(session('y1')), kind: 'session' as const },
      { entry: entry(session('y2'), '└─ '), kind: 'session' as const },
      dayRow(2, 'day:2026-06-16'),
      { entry: entry(session('older')), kind: 'session' as const }
    ]

    const visible = hideCollapsedGroupRows(rows, key => key !== 'day:2026-06-17')

    expect(visible).toEqual([rows[0], rows[1], rows[4], rows[5]])
  })

  it('never hides the unlabelled today section above the first divider', () => {
    const rows = [
      { entry: entry(session('a')), kind: 'session' as const },
      { entry: entry(session('b')), kind: 'session' as const },
      dayRow(1, 'day:2026-06-17'),
      { entry: entry(session('c')), kind: 'session' as const }
    ]

    const visible = hideCollapsedGroupRows(rows, () => false)

    expect(visible.map(row => (row.kind === 'session' ? row.entry.session.id : row.key))).toEqual([
      'a',
      'b',
      'day:2026-06-17'
    ])
  })
})

describe('toSessionRows', () => {
  it('wraps entries as session rows with no dividers', () => {
    const entries = [entry(session('a')), entry(session('b'), '└─ ')]

    expect(toSessionRows(entries)).toEqual([
      { entry: entries[0], kind: 'session' },
      { entry: entries[1], kind: 'session' }
    ])
  })
})
