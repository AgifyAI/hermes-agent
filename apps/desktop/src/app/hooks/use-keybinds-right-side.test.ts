import { renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/themes/context', () => ({
  useTheme: () => ({ resolvedMode: 'dark' as const, setMode: () => undefined })
}))

vi.mock('@/lib/platform', async importOriginal => ({
  ...(await importOriginal<object>()),
  isMacPlatform: () => true
}))

const toggleTerminalPane = vi.hoisted(() => vi.fn())

vi.mock('@/app/right-sidebar/terminal/reveal-focus', async importOriginal => ({
  ...(await importOriginal<object>()),
  toggleTerminalPane
}))

import { useKeybinds } from '@/app/hooks/use-keybinds'
import { findGroupOfPane, group, type LayoutNode, split } from '@/components/pane-shell/tree/model'
import { $layoutTree } from '@/components/pane-shell/tree/store'
import { registry } from '@/contrib/registry'

const BROWSER = 'preview-tile:url:browser'
const wrapper = ({ children }: { children: ReactNode }) => createElement(MemoryRouter, null, children)

let unmountKeybinds: (() => void) | undefined

beforeAll(() => {
  const placements = { sessions: 'left', files: 'right', [BROWSER]: 'main', workspace: 'main' }

  for (const [id, placement] of Object.entries(placements)) {
    registry.register({ id, area: 'panes', title: id, data: { placement }, render: () => null })
  }
})

beforeEach(() => {
  toggleTerminalPane.mockClear()
  unmountKeybinds = renderHook(
    () =>
      useKeybinds({
        archiveSelectedSession: () => undefined,
        openNewSessionTab: () => undefined,
        requestGateway: <T>() => Promise.resolve(undefined as T),
        startFreshSession: () => undefined,
        toggleCommandCenter: () => undefined,
        toggleSelectedPin: () => undefined
      }),
    { wrapper }
  ).unmount
})

afterEach(() => {
  unmountKeybinds?.()
  $layoutTree.set(null)
})

function press(key: string, target: EventTarget = window, shiftKey = false) {
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'Key' + key.toUpperCase(),
      key,
      metaKey: true,
      shiftKey
    })
  )
}

describe('Mac right sidebar shortcuts', () => {
  it('opens the right column and keeps it open on the second press', () => {
    $layoutTree.set(split('row', [group(['workspace']), { ...group([BROWSER]), minimized: true }]))

    for (let pressCount = 0; pressCount < 2; pressCount++) {
      press('b', window, true)
      const rightGroup = findGroupOfPane($layoutTree.get() as LayoutNode, BROWSER)
      expect(rightGroup?.id).toBeDefined()
      expect(rightGroup?.minimized).toBeFalsy()
    }
    expect(toggleTerminalPane).not.toHaveBeenCalled()
  })

  it('dispatches Command J to the terminal while its text input is focused', () => {
    const input = document.createElement('textarea')
    input.dataset.terminal = ''
    document.body.append(input)
    try {
      input.focus()
      press('j', input)
      expect(toggleTerminalPane).toHaveBeenCalledOnce()
    } finally {
      input.remove()
    }
  })
})
