// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $connection, $selectedStoredSessionId, $sessions } from '@/store/session'

import { MemorySection } from './memory-section'

const api = vi.fn()

describe('MemorySection', () => {
  beforeEach(() => {
    api.mockReset()
    api.mockImplementation((request: { path: string }) => (
      request.path === '/api/memory/pending'
        ? Promise.resolve({ approval_enabled: true, pending: [{
            created_at: 1,
            id: 'pending-1',
            origin: 'foreground',
            payload: { action: 'patch', content: 'new fact', old_text: 'old fact', target: 'memory' },
            summary: 'patch in memory'
          }] })
        : Promise.resolve({ id: 'pending-1', ok: true })
    ))
    window.hermesDesktop = { api } as never
    $connection.set({ connectionId: 'secondary', profile: 'calvin' } as never)
    $sessions.set([{ connection_id: 'secondary', id: 'chat-1', profile: 'calvin' }] as never)
    $selectedStoredSessionId.set('chat-1')
  })

  afterEach(() => {
    cleanup()
    $connection.set(null)
    $sessions.set([])
    $selectedStoredSessionId.set(null)
  })

  it('shows the old and proposed text and sends decisions to a secondary profile owner', async () => {
    render(<MemorySection />)
    fireEvent.click(screen.getByRole('button', { name: /memories|mémoires/i }))

    expect(await screen.findByText('old fact')).toBeTruthy()
    expect(screen.getByText('new fact')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /approve|approuver/i }))
    await waitFor(() => expect(api).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: 'secondary',
      method: 'POST',
      path: '/api/memory/pending/pending-1/approve',
      profile: 'calvin'
    })))
  })

  it('does not let a late response from the previous profile repopulate the new owner', async () => {
    let resolveCalvin: ((value: unknown) => void) | undefined
    let resolveDaisy: ((value: unknown) => void) | undefined

    api.mockImplementation((request: { path: string; profile?: string }) => {
      if (request.path !== '/api/memory/pending') {
        return Promise.resolve({ id: 'unused', ok: true })
      }

      return new Promise(resolve => {
        if (request.profile === 'daisy') {
          resolveDaisy = resolve
        } else {
          resolveCalvin = resolve
        }
      })
    })

    render(<MemorySection />)
    fireEvent.click(screen.getByRole('button', { name: /memories|mémoires/i }))
    await waitFor(() => expect(resolveCalvin).toBeTypeOf('function'))

    act(() => {
      $connection.set({ connectionId: 'tertiary', profile: 'daisy' } as never)
      $sessions.set([
        { connection_id: 'tertiary', id: 'chat-2', profile: 'daisy' }
      ] as never)
      $selectedStoredSessionId.set('chat-2')
    })
    await waitFor(() => expect(resolveDaisy).toBeTypeOf('function'))

    act(() => {
      resolveDaisy?.({ approval_enabled: true, pending: [{
        created_at: 2,
        id: 'daisy-pending',
        origin: 'foreground',
        payload: { action: 'add', content: 'Daisy fact', target: 'memory' },
        summary: 'daisy fact'
      }] })
    })
    expect(await screen.findByText('Daisy fact')).toBeTruthy()

    act(() => {
      resolveCalvin?.({ approval_enabled: true, pending: [{
        created_at: 1,
        id: 'calvin-pending',
        origin: 'foreground',
        payload: { action: 'add', content: 'Calvin fact', target: 'memory' },
        summary: 'calvin fact'
      }] })
    })

    await waitFor(() => expect(screen.queryByText('Calvin fact')).toBeNull())
    expect(screen.getByText('Daisy fact')).toBeTruthy()
  })
})
