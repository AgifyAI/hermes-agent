import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $chatFontFamily } from './chat-font'
import { modePref, RETIRED_APPEARANCE_KEYS, ThemeProvider, useTheme, WINDOW_CHROME } from './context'

const root = () => window.document.documentElement
const cssVar = (name: string) => root().style.getPropertyValue(name)

function ThemeProbe({ onReady }: { onReady: (value: ReturnType<typeof useTheme>) => void }) {
  onReady(useTheme())

  return null
}

describe('ThemeProvider: Linear light/dark', () => {
  beforeEach(() => {
    window.localStorage.clear()
    $chatFontFamily.set('')
  })

  afterEach(cleanup)

  it('paints the stored mode and persists a new pick for the live profile', () => {
    modePref.assign('default', 'dark')
    let ctx: ReturnType<typeof useTheme>
    render(
      <ThemeProvider>
        <ThemeProbe onReady={value => (ctx = value)} />
      </ThemeProvider>
    )

    expect(ctx!.resolvedMode).toBe('dark')
    expect(root().classList.contains('dark')).toBe(true)

    act(() => ctx!.setMode('light'))

    expect(root().classList.contains('dark')).toBe(false)
    expect(modePref.resolve('default')).toBe('light')
  })

  it('primes the next window first paint with the Linear window colour', () => {
    modePref.assign('default', 'dark')
    render(
      <ThemeProvider>
        <div />
      </ThemeProvider>
    )

    expect(window.localStorage.getItem('hermes-boot-background')).toBe(WINDOW_CHROME.dark.background)
    expect(window.localStorage.getItem('hermes-boot-color-scheme')).toBe('dark')
  })

  it('layers a custom chat font in front of the Linear stack and drops it when cleared', () => {
    render(
      <ThemeProvider>
        <div />
      </ThemeProvider>
    )

    expect(cssVar('--dt-font-sans')).toBe('')
    act(() => $chatFontFamily.set('OpenDyslexic'))
    expect(cssVar('--dt-font-sans')).toBe("'OpenDyslexic', var(--linear-font-sans)")
    act(() => $chatFontFamily.set(''))
    expect(cssVar('--dt-font-sans')).toBe('')
  })
})

describe('migration from the multi-theme system', () => {
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
    vi.resetModules()
  })

  it('drops every retired appearance key at boot and keeps the saved mode', async () => {
    for (const key of RETIRED_APPEARANCE_KEYS) {
      window.localStorage.setItem(key, '"catppuccin"')
    }

    window.localStorage.setItem('hermes-desktop-mode-v1', 'dark')
    vi.resetModules()

    const fresh = await import('./context')

    for (const key of fresh.RETIRED_APPEARANCE_KEYS) {
      expect(window.localStorage.getItem(key)).toBeNull()
    }

    expect(fresh.modePref.resolve('default')).toBe('dark')
    expect(root().classList.contains('dark')).toBe(true)
  })
})
