import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  approvePendingMemoryWrite,
  editPendingMemoryWrite,
  getPendingMemoryWrites,
  rejectPendingMemoryWrite
} from './memory'

describe('pending memory requests', () => {
  const api = vi.fn().mockResolvedValue({ pending: [], approval_enabled: true })

  beforeEach(() => {
    api.mockClear()
    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: { api }
    })
  })

  it('pins reads and decisions to the owning connection and profile', async () => {
    const scope = { connectionId: 'secondary', profile: 'calvin' }

    await getPendingMemoryWrites(scope)
    await approvePendingMemoryWrite('pending-1', scope)
    await editPendingMemoryWrite('pending-1', 'edited', scope)
    await rejectPendingMemoryWrite('pending-1', scope)

    expect(api.mock.calls.map(([request]) => request)).toEqual([
      { connectionId: 'secondary', path: '/api/memory/pending', priority: 'foreground', profile: 'calvin' },
      {
        connectionId: 'secondary',
        method: 'POST',
        path: '/api/memory/pending/pending-1/approve',
        priority: 'foreground',
        profile: 'calvin'
      },
      {
        body: { content: 'edited' },
        connectionId: 'secondary',
        method: 'PATCH',
        path: '/api/memory/pending/pending-1',
        priority: 'foreground',
        profile: 'calvin'
      },
      {
        connectionId: 'secondary',
        method: 'POST',
        path: '/api/memory/pending/pending-1/reject',
        priority: 'foreground',
        profile: 'calvin'
      }
    ])
  })
})
