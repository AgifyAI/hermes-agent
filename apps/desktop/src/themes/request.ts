/**
 * Imperative mode switching, for callers with no component to hang a hook on
 * (the agent's `set_theme`). The ThemeProvider drains `$pendingModeApply`
 * through `setMode`, so an imperative switch persists per profile exactly like
 * a manual pick — one policy, one owner.
 */

import { atom } from 'nanostores'

import type { ThemeMode } from './context'

/** One-shot light/dark/system switch the ThemeProvider drains through `setMode` (it clears this). */
export const $pendingModeApply = atom<null | ThemeMode>(null)

/** Ask for a mode switch from outside React; persisted per profile like a manual pick. */
export function requestMode(mode: ThemeMode): void {
  $pendingModeApply.set(mode)
}
