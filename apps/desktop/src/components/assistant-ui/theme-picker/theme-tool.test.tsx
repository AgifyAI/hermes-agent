import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { atom } from 'nanostores'
import { Fragment } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { PRIMARY_SESSION_VIEW, type SessionView, SessionViewProvider } from '@/app/chat/session-view'
import { registerLayoutPresets } from '@/app/contrib/layout-presets'
import { $terminalTakeover } from '@/app/right-sidebar/store'
import { I18nProvider } from '@/i18n'
import { $fileBrowserOpen } from '@/store/layout'
import { rememberServerRequest, resetServerRequestsForTests } from '@/store/server-requests'
import { $themePicks, parkThemePick } from '@/store/theme-pick'
import { ThemeProvider } from '@/themes/context'
import { $pendingModeApply } from '@/themes/request'

import { ThemeTool } from './theme-tool'

const SESSION = 'theme-session'

const view: SessionView = { ...PRIMARY_SESSION_VIEW, $runtimeId: atom(SESSION), $storedId: atom('stored-theme') }

function row(props: Partial<ToolCallMessagePartProps>) {
  // SAFETY: ThemeTool reads only args, result, toolName and toolCallId; the rest of the part API is unused.
  const part = { args: {}, toolCallId: 'call-1', toolName: 'set_theme', ...props } as ToolCallMessagePartProps

  return (
    <I18nProvider configClient={null} initialLocale="en">
      <ThemeProvider>
        <SessionViewProvider value={view}>
          <ThemeTool {...part} />
        </SessionViewProvider>
      </ThemeProvider>
    </I18nProvider>
  )
}

function renderRow(props: Partial<ToolCallMessagePartProps>) {
  return render(row(props))
}

function park(picker: 'accent' | 'layout') {
  const respond = vi.fn()

  rememberServerRequest({ fail: vi.fn(), id: 'srq-7', method: 'theme.pick', params: {}, respond })
  parkThemePick({ picker, requestId: 'srq-7', sessionId: SESSION })

  return respond
}

describe('ThemeTool', () => {
  beforeAll(() => {
    registerLayoutPresets()
  })

  afterEach(() => {
    cleanup()
    $themePicks.set({})
    $pendingModeApply.set(null)
    $terminalTakeover.set(false)
    $fileBrowserOpen.set(false)
    resetServerRequestsForTests()
  })

  it('asks the accent card question as light/dark/system, since the look is Linear only', () => {
    const respond = park('accent')

    renderRow({ args: { picker: 'accent' } })
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }))

    expect(respond).toHaveBeenCalledWith({ picked: { mode: 'dark' } })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(screen.getByText('Dark').closest('[data-theme-settled]')).not.toBeNull()
  })

  it('draws the layout card for a call made through the tool_call bridge', () => {
    const respond = park('layout')

    renderRow({
      args: { calls: [{ arguments: { picker: 'layout' }, name: 'set_theme' }] },
      toolName: 'tool_call'
    })
    fireEvent.click(screen.getByRole('button', { name: /Elite/ }))

    expect(respond).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(respond).toHaveBeenCalledWith({ picked: { layout: 'terminal-deck' } })
  })

  it('keeps a staged layout when its preview remounts the card', () => {
    const respond = park('layout')
    const props = { args: { picker: 'layout' } }
    // A layout preview re-parents the chat; a new key remounts the row the same way.
    const { rerender } = render(<Fragment key="before">{row(props)}</Fragment>)

    fireEvent.click(screen.getByRole('button', { name: /Elite/ }))
    rerender(<Fragment key="after">{row(props)}</Fragment>)

    expect(screen.getByRole('button', { name: /Elite/ }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(respond).toHaveBeenCalledWith({ picked: { layout: 'terminal-deck' } })
  })

  it('opens the terminal and files for Elite, and a cancelled preview closes them again', async () => {
    park('layout')

    const { rerender } = renderRow({ args: { picker: 'layout' } })

    fireEvent.click(screen.getByRole('button', { name: /Elite/ }))

    expect($terminalTakeover.get()).toBe(true)
    expect($fileBrowserOpen.get()).toBe(true)

    rerender(row({ args: { picker: 'layout' }, result: { cancelled: true } }))

    await waitFor(() => expect($terminalTakeover.get()).toBe(false))
    expect($fileBrowserOpen.get()).toBe(false)
  })
})
