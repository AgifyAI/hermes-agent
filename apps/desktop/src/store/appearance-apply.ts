/**
 * What `set_theme` and its picker cards change: light/dark mode and layout
 * preset, validated as a whole before anything is applied so an unknown
 * layout never leaves a new mode half-applied.
 *
 * Hermes Desktop has one look (Linear's), so the only accent it accepts is
 * `theme` — the look's own. Mode persists through `requestMode` (drained by
 * the ThemeProvider); a layout applies through the same registry the layout
 * picker reads, switching Simple/Advanced to the preset's tier first because
 * Simple only shows its two sidebar presets.
 */

import { isLayoutNode } from '@/components/pane-shell/tree/model'
import { layoutPresetTier, LAYOUTS_AREA } from '@/components/pane-shell/tree/presets'
import { registry } from '@/contrib/registry'
import type { ThemeMode } from '@/themes/context'
import { requestMode } from '@/themes/request'

import { $interfaceMode, setInterfaceMode } from './interface-mode'
import { applyDesktopLayoutPreset, openLayoutPickPanes } from './pane-focus'

export const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system']

/** The look's own accent: the one accent value there is. */
const OWN_ACCENT = 'theme'

export interface AppearanceValues {
  accent?: string
  layout?: string
  mode?: ThemeMode
}

/** What was applied, in the ids the agent reads. */
export interface AppliedAppearance {
  layout?: string
  mode?: ThemeMode
}

export type AppearanceAnswer =
  { applied: AppliedAppearance; success: true } | { available: string[]; error: string; success: false }

const listedLayoutIds = (): string[] =>
  registry
    .getArea(LAYOUTS_AREA)
    .filter(entry => isLayoutNode(entry.data))
    .map(entry => entry.id)

// The first-run demo layout is borrowed (components/onboarding/first-run/intro.ts registers this): a
// committed layout ends it first, so a Simple/Advanced switch saves the user's own layout, not the demo.
let releaseBorrowedLayout = (): void => {}

export function onLayoutCommit(release: () => void): void {
  releaseBorrowedLayout = release
}

function applyLayout(id: string): void {
  releaseBorrowedLayout()

  // A user's saved layouts are Advanced, like the layout picker's Custom section.
  const mode = layoutPresetTier(id) === 'simple' ? 'simple' : 'advanced'

  if ($interfaceMode.get() !== mode) {
    setInterfaceMode(mode)
  }

  if (applyDesktopLayoutPreset(id)) {
    openLayoutPickPanes(id)
  }
}

export function applyAppearance(values: AppearanceValues): AppearanceAnswer {
  if (values.mode !== undefined && !THEME_MODES.includes(values.mode)) {
    return { available: [...THEME_MODES], error: `Unknown mode "${values.mode}".`, success: false }
  }

  if (values.accent !== undefined && values.accent !== OWN_ACCENT) {
    return {
      available: [OWN_ACCENT],
      error: `Hermes Desktop has one look (Linear's) and no accent colours; "${values.accent}" cannot be applied.`,
      success: false
    }
  }

  if (values.layout !== undefined && !listedLayoutIds().includes(values.layout)) {
    return { available: listedLayoutIds(), error: `Unknown layout "${values.layout}".`, success: false }
  }

  const applied: AppliedAppearance = {}

  if (values.mode !== undefined) {
    requestMode(values.mode)
    applied.mode = values.mode
  }

  if (values.layout !== undefined) {
    applyLayout(values.layout)
    applied.layout = values.layout
  }

  return { applied, success: true }
}
