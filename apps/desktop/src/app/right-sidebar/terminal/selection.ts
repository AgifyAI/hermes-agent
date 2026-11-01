import type { ITheme, Terminal } from '@xterm/xterm'
import type { CSSProperties } from 'react'

import { isComposerChord } from '@/lib/keybinds/chords'
import { isMacPlatform } from '@/lib/platform'

type TerminalThemeSlot = keyof ITheme

// The terminal paints from the Linear layer. Status tokens carry the ANSI hues,
// the same in both modes; xterm's minimumContrastRatio clamps each against the
// surface at render time, so bright variants share their base token.
const ANSI_HUE_TOKENS: Partial<Record<TerminalThemeSlot, string>> = {
  red: '--linear-red',
  green: '--linear-green',
  yellow: '--linear-yellow',
  blue: '--linear-blue',
  magenta: '--linear-pink',
  cyan: '--linear-cyan',
  brightRed: '--linear-red',
  brightGreen: '--linear-green',
  brightYellow: '--linear-yellow',
  brightBlue: '--linear-blue',
  brightMagenta: '--linear-pink',
  brightCyan: '--linear-cyan'
}

// Neutrals follow the mode and diverge on purpose: on the pale panel "white"
// must stay readable, so light mode inverts the black/white ramp. An opaque
// selection colour is what xterm blends to 30% over the surface.
const SURFACE_TOKENS: Partial<Record<TerminalThemeSlot, string>> = {
  background: '--linear-bg-panel',
  cursorAccent: '--linear-bg-panel',
  cursor: '--linear-text-primary',
  foreground: '--linear-text-secondary',
  selectionBackground: '--linear-text-tertiary'
}

const NEUTRAL_TOKENS: Record<'light' | 'dark', Partial<Record<TerminalThemeSlot, string>>> = {
  dark: {
    black: '--linear-bg-tertiary',
    brightBlack: '--linear-text-quaternary',
    white: '--linear-text-secondary',
    brightWhite: '--linear-text-primary'
  },
  light: {
    black: '--linear-text-primary',
    brightBlack: '--linear-text-tertiary',
    white: '--linear-text-tertiary',
    brightWhite: '--linear-text-quaternary'
  }
}

// Concrete colours for the WebGL renderer + contrast clamp. Custom props don't
// resolve via getComputedStyle, so probe a real background-color. Read AFTER
// the theme provider repaints (mount / rAF post-change) or neutrals lag a frame.
export function terminalTheme(mode: 'light' | 'dark'): ITheme {
  const tokens = { ...ANSI_HUE_TOKENS, ...SURFACE_TOKENS, ...NEUTRAL_TOKENS[mode === 'dark' ? 'dark' : 'light'] }
  const probe = document.createElement('span')
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none'
  document.body.appendChild(probe)

  const theme = Object.fromEntries(
    Object.entries(tokens).map(([slot, token]) => {
      probe.style.backgroundColor = `var(${token})`

      return [slot, getComputedStyle(probe).backgroundColor]
    })
  ) as ITheme

  probe.remove()

  return theme
}

export { isMacPlatform }

/** Whether this terminal session should own a global ⌘/Ctrl+L keydown.
 *  `active` gates the fanout: every open tab stays mounted, so an inactive
 *  tab must never claim the press (#76116). */
export function shouldOwnAddSelectionShortcut(event: KeyboardEvent, opts: { active: boolean; hasSelection: boolean }) {
  return opts.active && opts.hasSelection && isComposerChord(event)
}

export function terminalSelectionLabel(term: Terminal, shellName: string, text: string) {
  const pos = term.getSelectionPosition()

  if (pos) {
    return pos.start.y === pos.end.y ? `${shellName}:${pos.start.y}` : `${shellName}:${pos.start.y}-${pos.end.y}`
  }

  const lines = Math.max(1, text.trim().split(/\r?\n/).length)

  return `${shellName}:${lines} line${lines === 1 ? '' : 's'}`
}

export function terminalSelectionAnchor(host: HTMLDivElement): CSSProperties | null {
  const rect = Array.from(host.querySelectorAll<HTMLElement>('.xterm-selection div'))
    .map(node => node.getBoundingClientRect())
    .filter(r => r.width > 0 && r.height > 0)
    .at(-1)

  if (!rect) {
    return null
  }

  const hostRect = host.getBoundingClientRect()
  const buttonWidth = 128
  const left = Math.min(Math.max(rect.left - hostRect.left, 8), Math.max(8, host.clientWidth - buttonWidth - 8))
  const top = Math.min(Math.max(rect.bottom - hostRect.top + 4, 8), Math.max(8, host.clientHeight - 34))

  return { left, top }
}
