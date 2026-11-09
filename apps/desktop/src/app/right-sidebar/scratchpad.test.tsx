// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 400))
    })
    expect(setScratchpadMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveFirst?.()
    })
    await waitFor(() => expect(setScratchpadMock).toHaveBeenCalledTimes(2))
    expect(setScratchpadMock.mock.calls.map(call => call[1])).toEqual(['first', 'second'])

    await act(async () => {
      resolveSecond?.()
    })
  })

  it('keeps a failed note visible and offers a retry', async () => {
    getSessionMock.mockResolvedValue(session('chat-a', null))
    setScratchpadMock
      .mockRejectedValueOnce(new Error('old backend does not support scratchpad'))
      .mockResolvedValueOnce({ ok: true })

    render(<SessionScratchpad labels={{ retry: 'Retry' }} sessionId="chat-a" />)
    const editor = await screen.findByRole('textbox')
    fireEvent.change(editor, { target: { value: 'keep this note' } })

    await waitFor(() => expect(screen.getByText('Retry')).not.toBeNull())
    expect((editor as HTMLTextAreaElement).value).toBe('keep this note')

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(setScratchpadMock).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('keeps an in-flight failure recoverable after switching chats', async () => {
    getSessionMock.mockImplementation(async id => session(id, null))
    let rejectFirst: ((reason?: unknown) => void) | undefined
    setScratchpadMock
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectFirst = reject
          })
      )
      .mockResolvedValueOnce({ ok: true })

    const view = render(<SessionScratchpad labels={{ retry: 'Retry' }} sessionId="chat-a" />)
    const editor = await screen.findByRole('textbox')
    fireEvent.change(editor, { target: { value: 'offline draft' } })
    await waitFor(() => expect(setScratchpadMock).toHaveBeenCalledTimes(1))

    view.rerender(<SessionScratchpad labels={{ retry: 'Retry' }} sessionId="chat-b" />)
    await waitFor(() => expect(getSessionMock).toHaveBeenCalledWith('chat-b', undefined))
    rejectFirst?.(new Error('gateway unavailable'))

    view.rerender(<SessionScratchpad labels={{ retry: 'Retry' }} sessionId="chat-a" />)
    const restored = await screen.findByRole('textbox')
    await waitFor(() => expect((restored as HTMLTextAreaElement).value).toBe('offline draft'))
    expect(screen.getByRole('button', { name: 'Retry' })).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(setScratchpadMock).toHaveBeenCalledTimes(2))
    expect((restored as HTMLTextAreaElement).value).toBe('offline draft')
  })

  it('does not let a late server read overwrite newer typing after return', async () => {
    let readsForA = 0
    let resolveReturnedRead: (() => void) | undefined
    getSessionMock.mockImplementation(async id => {
      if (id === 'chat-c' && readsForA++ > 0) {
        return new Promise(resolve => {
          resolveReturnedRead = () => resolve(session('chat-c', 'server old note'))
        })
      }

      return session(id, id === 'chat-c' ? 'server old note' : null)
    })
    setScratchpadMock.mockRejectedValueOnce(new Error('gateway unavailable'))

    const view = render(<SessionScratchpad labels={{ retry: 'Retry' }} sessionId="chat-c" />)
    const editor = await screen.findByRole('textbox')
    fireEvent.change(editor, { target: { value: 'old draft' } })
    await waitFor(() => expect(setScratchpadMock).toHaveBeenCalledTimes(1))
    view.rerender(<SessionScratchpad labels={{ retry: 'Retry' }} sessionId="chat-d" />)
    await waitFor(() => expect(getSessionMock).toHaveBeenCalledWith('chat-d', undefined))

    view.rerender(<SessionScratchpad labels={{ retry: 'Retry' }} sessionId="chat-c" />)
    const returnedEditor = await screen.findByRole('textbox')
    fireEvent.change(returnedEditor, { target: { value: 'new draft after return' } })
    resolveReturnedRead?.()

    await waitFor(() => expect((returnedEditor as HTMLTextAreaElement).value).toBe('new draft after return'))
  })

  it('retries a failed read without sending an empty note', async () => {
    getSessionMock
      .mockRejectedValueOnce(new Error('gateway unavailable'))
      .mockResolvedValueOnce(session('chat-a', 'note from the gateway'))

    render(<SessionScratchpad labels={{ retry: 'Retry' }} sessionId="chat-a" />)
    await waitFor(() => expect(screen.getByText('Retry')).not.toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    const editor = await screen.findByRole('textbox')
    await waitFor(() => expect((editor as HTMLTextAreaElement).value).toBe('note from the gateway'))
    expect(setScratchpadMock).not.toHaveBeenCalled()
  })

  it('persists and reloads through the owning gateway profile', async () => {
    const owner = { connectionId: 'mac-mini', profile: 'default' }
    let persisted: null | string = null
    getSessionMock.mockImplementation(async (id, profile) => {
      expect(profile).toEqual(owner)

      return session(id, persisted)
    })
    setScratchpadMock.mockImplementation(async (id, value, profile) => {
      expect(profile).toEqual(owner)
      persisted = value

      return { ok: true }
    })

    const first = render(<SessionScratchpad labels={{ retry: 'Retry' }} profile={owner} sessionId="chat-a" />)
    const editor = await screen.findByRole('textbox')
    fireEvent.change(editor, { target: { value: 'gateway note' } })
    await waitFor(() => expect(setScratchpadMock).toHaveBeenCalledTimes(1))
    first.unmount()

    render(<SessionScratchpad labels={{ retry: 'Retry' }} profile={owner} sessionId="chat-a" />)
    const reopened = await screen.findByRole('textbox')
    await waitFor(() => expect((reopened as HTMLTextAreaElement).value).toBe('gateway note'))
  })
})

