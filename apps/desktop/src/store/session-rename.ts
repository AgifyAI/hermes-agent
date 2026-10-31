import { atom } from 'nanostores'

/** One session awaiting a rename, opened either from a row menu or the
 *  `session.rename` keybind (⌘R). A single dialog is mounted with the sidebar
 *  and reads this atom, so both entry points share one modal and one submit
 *  path. */
export interface SessionRenameTarget {
  sessionId: string
  title: string
  profile?: string
}

export const $sessionRenameTarget = atom<SessionRenameTarget | null>(null)

export function requestSessionRename(target: SessionRenameTarget): void {
  $sessionRenameTarget.set(target)
}

export function closeSessionRename(): void {
  $sessionRenameTarget.set(null)
}
