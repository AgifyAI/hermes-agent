// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getSession, setSessionScratchpadRemote } from '@/api/sessions'
import type { SessionInfo } from '@/types/hermes'

import { SessionScratchpad } from './scratchpad'

vi.mock('@/api/sessions', () => ({
  getSession: vi.fn(),
  setSessionScratchpadRemote: vi.fn()
}))

const getSessionMock = vi.mocked(getSession)
const setScratchpadMock = vi.mocked(setSessionScratchpadRemote)

const session = (id: string, scratchpad: null | string): SessionInfo => ({
  id,
  scratchpad,
  ended_at: null,
  input_tokens: 0,
  is_active: false,
  last_active: 0,
  message_count: 0,
  model: null,
  output_tokens: 0,
  preview: null,
  source: null,
  started_at: 0,
  title: null,
  tool_call_count: 0
})

describe('SessionScratchpad', () => {
  beforeEach(() => {
    vi.useRealTimers()
    getSessionMock.mockReset()
    setScratchpadMock.mockReset()
    setScratchpadMock.mockResolvedValue({ ok: true })
    window.hermesDesktop = { api: vi.fn() } as never
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('does not write a note merely because it was read or blurred', async () => {
    getSessionMock.mockResolvedValue(session('chat-a', 'existing note'))

    render(<SessionScratchpad sessionId="chat-a" />)
    const editor = await screen.findByRole('textbox')
    expect((editor as HTMLTextAreaElement).value).toBe('existing note')

    fireEvent.blur(editor)
    cleanup()

    expect(setScratchpadMock).not.toHaveBeenCalled()
  })

  it('flushes an edited note to the original chat before switching', async () => {
    getSessionMock.mockImplementation(async id => session(id, id === 'chat-a' ? 'old' : null))

    const view = render(<SessionScratchpad sessionId="chat-a" />)
    const editor = await screen.findByRole('textbox')
    fireEvent.change(editor, { target: { value: 'edited' } })

    view.rerender(<SessionScratchpad sessionId="chat-b" />)
    await waitFor(() => expect(getSessionMock).toHaveBeenCalledWith('chat-b', undefined))

    expect(setScratchpadMock).toHaveBeenCalledWith('chat-a', 'edited', undefined)
  })

  it('serializes saves for one chat so an older response cannot finish last', async () => {
    getSessionMock.mockResolvedValue(session('chat-a', null))
    let resolveFirst: (() => void) | undefined
    let resolveSecond: (() => void) | undefined
    setScratchpadMock
      .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = () => resolve({ ok: true }) }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveSecond = () => resolve({ ok: true }) }))

    render(<SessionScratchpad sessionId="chat-a" />)
    const editor = await screen.findByRole('textbox')
    fireEvent.change(editor, { target: { value: 'first' } })
    await waitFor(() => expect(setScratchpadMock).toHaveBeenCalledTimes(1))

    fireEvent.change(editor, { target: { value: 'second' } })
    await new Promise(resolve => setTimeout(resolve, 400))
    expect(setScratchpadMock).toHaveBeenCalledTimes(1)

    resolveFirst?.()
    await waitFor(() => expect(setScratchpadMock).toHaveBeenCalledTimes(2))
    expect(setScratchpadMock.mock.calls.map(call => call[1])).toEqual(['first', 'second'])

    resolveSecond?.()
  })
})

