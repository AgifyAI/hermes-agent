import { atom } from 'nanostores'

import { persistBoolean, storedBoolean } from '@/lib/storage'
import { modeBound } from '@/store/interface-mode'
import { setFileBrowserOpen } from '@/store/layout'

const TAKEOVER_KEY = 'hermes.desktop.terminalTakeover'

// Simple mode rests the terminal closed without touching this preference; ⌃`
// still brings it up for the session.
const $terminalTakeoverPref = atom(storedBoolean(TAKEOVER_KEY, false))

$terminalTakeoverPref.subscribe(active => persistBoolean(TAKEOVER_KEY, active))

export const $terminalTakeover = modeBound('terminalOpen', $terminalTakeoverPref, active =>
  $terminalTakeoverPref.set(active)
)

export const setTerminalTakeover = (active: boolean) => $terminalTakeover.set(active)

/** A command queued to run in the embedded terminal. The terminal pane flushes
 *  (and clears) it once its session is live, so a value set before the pane
 *  mounts still runs. Cleared after flush so a later remount can't replay it. */
export const $terminalInjection = atom<null | string>(null)

/** A chat card can ask the file/right rail to open a particular review section.
 * The request is a counter rather than a boolean so clicking a second proposal
 * while the rail is already open still focuses the section. */
export type RightSidebarSection = 'memory' | 'queue' | 'scratchpad'

export const $rightSidebarSectionRequest = atom<{ section: RightSidebarSection; token: number } | null>(null)
let rightSidebarSectionToken = 0

export function requestRightSidebarSection(section: RightSidebarSection): void {
  setFileBrowserOpen(true)
  $rightSidebarSectionRequest.set({ section, token: ++rightSidebarSectionToken })
}

/** Open the terminal pane and run a command in it. Used to disconnect external
 *  (CLI-managed) providers, which Hermes can't clear via the API — the user
 *  sees exactly what runs instead of Hermes silently deleting their creds. */
export const runInTerminal = (command: string) => {
  const trimmed = command.trim()

  if (!trimmed) {
    return
  }

  setTerminalTakeover(true)
  $terminalInjection.set(trimmed)
}
