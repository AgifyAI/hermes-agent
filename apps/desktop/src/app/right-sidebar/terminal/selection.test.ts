// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { isComposerChord } from '@/lib/keybinds/chords'

import { isMacPlatform, shouldOwnAddSelectionShortcut, terminalTheme } from './selection'

const key = (init: Partial<KeyboardEvent> & { key: string }) =>
  ({
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    type: 'keydown',
    ...init
  }) as KeyboardEvent

/** Chord that the composer-focus ladder accepts on this host. */
const addSelectionKey = () => (isMacPlatform() ? key({ key: 'l', metaKey: true }) : key({ key: 'l', ctrlKey: true }))

describe('shouldOwnAddSelectionShortcut', () => {
  it('only the active tab claims the add-selection shortcut when text is selected (#76116)', () => {
    const chord = addSelectionKey()

    expect(shouldOwnAddSelectionShortcut(chord, { active: true, hasSelection: true })).toBe(true)

    // Inactive mounted tabs must not also fire — that was the N-pill bug.
    expect(shouldOwnAddSelectionShortcut(chord, { active: false, hasSelection: true })).toBe(false)
  })

  it('never claims the shortcut with no selection so clear-screen still reaches the shell', () => {
    const chord = addSelectionKey()

    expect(shouldOwnAddSelectionShortcut(chord, { active: true, hasSelection: false })).toBe(false)
    expect(isComposerChord(chord)).toBe(true)
  })
})

describe('terminalTheme', () => {
  afterEach(() => vi.restoreAllMocks())

  // Echo the probed declaration so the assertion reads which token fed each slot.
  const echoProbe = () =>
    vi
      .spyOn(window, 'getComputedStyle')
      .mockImplementation(el => ({ backgroundColor: (el as HTMLElement).style.backgroundColor }) as CSSStyleDeclaration)

  it('fills every ANSI slot from a Linear token and leaves no probe behind', () => {
    echoProbe()

    const theme = terminalTheme('dark')
    const slots = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const

    for (const slot of slots) {
      const bright = `bright${slot[0]!.toUpperCase()}${slot.slice(1)}` as keyof typeof theme

      expect(theme[slot]).toMatch(/--linear-/)
      expect(theme[bright]).toMatch(/--linear-/)
    }

    expect(theme.background).toMatch(/--linear-bg-panel/)
    expect(document.body.querySelector('span')).toBeNull()
  })

  it('keeps "white" readable on the pale panel by inverting the neutral ramp in light mode', () => {
    echoProbe()

    expect(terminalTheme('dark').white).toMatch(/--linear-text-secondary/)
    expect(terminalTheme('light').white).toMatch(/--linear-text-tertiary/)
    expect(terminalTheme('light').black).toMatch(/--linear-text-primary/)
  })
})
