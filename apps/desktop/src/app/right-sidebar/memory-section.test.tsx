// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
})
