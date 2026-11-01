export type WindowAcceleratorAction =
  'close-tab' | 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'swallow' | 'ignore'

/**
 * How long after the window gains focus a Close Tab / Reload keyDown is
 * treated as belonging to the app that just lost focus (#105498).
 */
export const FOCUS_GRACE_MS = 200

export interface WindowAcceleratorInput {
  alt?: boolean
  control?: boolean
  isAutoRepeat?: boolean
  key?: string
  meta?: boolean
  shift?: boolean
  type?: string
}

/**
 * Classify a main-process before-input-event for Close Tab and Zoom. (⌘R used
 * to live here as a preview reload; it is now the renderer's session rename
 * chord, and refreshing moved to ⇧⌘R / the menu's forceReload role.)
 *
 * `before-input-event` fires for keydown and keyup. A keyup that arrives after
 * Windows transfers focus (Ctrl+W started in another app) is not a chord this
 * window owns, so only `keyDown` is an accelerator.
 *
 * Close Tab and Reload are destructive, so two more keyDowns are claimed but
 * not acted on ('swallow'): auto-repeats (W held through a browser's own
 * Ctrl+W keeps repeating once this window is foreground) and anything within
 * FOCUS_GRACE_MS of focus arriving (a keydown synthesized on activation).
 * They are still claimed so the renderer's `mod+w` keybind can't act on them.
 */
export function windowAcceleratorAction(
  input: WindowAcceleratorInput,
  isMac: boolean,
  msSinceFocus = Number.POSITIVE_INFINITY
): WindowAcceleratorAction {
  if (input.type !== 'keyDown') {
    return 'ignore'
  }

  const key = String(input.key || '')
  const folded = key.toLowerCase()
  const accel = Boolean((isMac ? input.meta : input.control) && !input.alt)

  if (!accel) {
    return 'ignore'
  }

  if (folded === 'w' && !input.shift) {
    if (input.isAutoRepeat || msSinceFocus < FOCUS_GRACE_MS) {
      return 'swallow'
    }

    return 'close-tab'
  }

  if (key === '0') {
    // Ctrl/Cmd+Shift+0 is not a zoom chord.
    return input.shift ? 'ignore' : 'zoom-reset'
  }

  if (key === '=' || key === '+') {
    // Zoom-in accepts Shift: on US layouts Plus is physically Shift+=, so
    // Cmd+Plus arrives as Cmd+Shift+'+' or '=' (#43517).
    return 'zoom-in'
  }

  if (key === '-' && !input.shift) {
    // Shift+'-' is '_' on most layouts, not zoom-out.
    return 'zoom-out'
  }

  return 'ignore'
}
