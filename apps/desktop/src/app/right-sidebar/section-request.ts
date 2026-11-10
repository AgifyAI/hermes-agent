import { atom } from 'nanostores'

import { setFileBrowserOpen } from '@/store/layout'

/** A chat card can ask the file/right rail to open a particular review section.
 * The request is a counter rather than a boolean so clicking a second proposal
 * while the rail is already open still focuses the section. */
export type RightSidebarSection = 'goal' | 'memory' | 'queue' | 'scratchpad'

export const $rightSidebarSectionRequest = atom<{ section: RightSidebarSection; token: number } | null>(null)
let rightSidebarSectionToken = 0

export function requestRightSidebarSection(section: RightSidebarSection): void {
  setFileBrowserOpen(true)
  $rightSidebarSectionRequest.set({ section, token: ++rightSidebarSectionToken })
}
