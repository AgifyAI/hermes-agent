import { type SidebarSessionEntry } from '@/lib/session-branch-tree'
import { daySectionKey, nominalDayStart, SECOND } from '@/lib/time'

// A flat list row is either a divider or a session entry. Interleaving these
// lets the flat list (and the virtualizer) render separators inline without a
// second layer of nesting. A divider either names a calendar day (resolved
// against the locale's labels at render time, see sessionDayLabel) or carries
// its own label (the WORKING / DONE runs).
export type SidebarListRow =
  | { day: number; key: string; kind: 'divider' }
  | { entry: SidebarSessionEntry; kind: 'session' }
  | { key: string; kind: 'divider'; label: string }

// The row's own age label reads from `last_active || started_at`; bucket off the
// same value so a day section lines up with what the row actually shows.
const recencyMs = (entry: SidebarSessionEntry): number =>
  (entry.session.last_active || entry.session.started_at || 0) * SECOND

// One collapsible section per calendar day, in the order the entries arrive
// (the caller sorts newest-first). Today's section is the unlabelled top of the
// list — it can never be collapsed — so the first divider a user sees is always
// an earlier day ("Yesterday", "Thursday 18 June", …). A day with no sessions
// simply never emits a section. Branch children inherit their parent cluster's
// day and never trigger a divider, so a parent→branches block never splits.
//
// `maxGroups` limits how many day sections are rendered (project previews fold
// the list down to the two most recent days). Entries past the limit are
// dropped, exactly like the old bucket limit.
export function groupEntriesByDay(
  entries: readonly SidebarSessionEntry[],
  nowMs = Date.now(),
  maxGroups = Number.POSITIVE_INFINITY
): SidebarListRow[] {
  const rows: SidebarListRow[] = []
  const emitted = new Set<string>()
  const todayStart = nominalDayStart(nowMs)
  let currentDay: null | number = null
  let dayGroups = 0

  for (const entry of entries) {
    // Nested branch rows travel with their parent cluster; they never open a
    // new day or move the divider cursor.
    if (entry.branchStem) {
      rows.push({ entry, kind: 'session' })

      continue
    }

    const day = nominalDayStart(recencyMs(entry))

    if (day !== currentDay) {
      currentDay = day

      if (dayGroups >= maxGroups) {
        break
      }

      dayGroups++

      const key = daySectionKey(day)
      const alreadyEmitted = emitted.has(key)

      // Mark it emitted even when skipped, so a non-monotonic order (possible
      // inside a project lane) can't re-label the same day or collide React
      // keys.
      emitted.add(key)

      // The newest day on screen leads unlabelled by definition (there is
      // nothing above it), and when that day is today it stays unlabelled —
      // today is not a collapsible section. Any other day gets its heading.
      if (!alreadyEmitted && (dayGroups > 1 || day !== todayStart)) {
        rows.push({ day, key, kind: 'divider' })
      }
    }

    rows.push({ entry, kind: 'session' })
  }

  return rows
}

// Split into two runs — still busy, and everything else — under the same
// dividers the date grouping uses. Branch children ride with their parent, as
// they do there. Entries arrive already ordered, so each run is contiguous.
export function groupEntriesByStatus(
  entries: readonly SidebarSessionEntry[],
  isWorking: (entry: SidebarSessionEntry) => boolean,
  labels: { done: string; working: string }
): SidebarListRow[] {
  const working: SidebarSessionEntry[] = []
  const done: SidebarSessionEntry[] = []
  let cluster = done

  for (const entry of entries) {
    if (!entry.branchStem) {
      cluster = isWorking(entry) ? working : done
    }

    cluster.push(entry)
  }

  return [
    ...(working.length ? [{ key: 'status:working', kind: 'divider' as const, label: labels.working }] : []),
    ...toSessionRows(working),
    ...(done.length ? [{ key: 'status:done', kind: 'divider' as const, label: labels.done }] : []),
    ...toSessionRows(done)
  ]
}

// Wrap entries as plain session rows (no dividers) so the ungrouped path shares
// the same `SidebarListRow[]` shape as the grouped one.
export function toSessionRows(entries: readonly SidebarSessionEntry[]): SidebarListRow[] {
  return entries.map(entry => ({ entry, kind: 'session' }))
}

/** Drop session rows that sit under a closed divider. The divider itself stays
 *  so the group can be opened again. Sessions above the first divider (today's
 *  unlabelled section) are never gated. Returns the input array when nothing is
 *  hidden so callers keep a stable reference. */
export function hideCollapsedGroupRows(
  rows: readonly SidebarListRow[],
  isOpen: (key: string) => boolean
): SidebarListRow[] {
  const out: SidebarListRow[] = []
  let hiding = false

  for (const row of rows) {
    if (row.kind === 'divider') {
      hiding = !isOpen(row.key)
      out.push(row)

      continue
    }

    if (!hiding) {
      out.push(row)
    }
  }

  return out.length === rows.length ? (rows as SidebarListRow[]) : out
}
