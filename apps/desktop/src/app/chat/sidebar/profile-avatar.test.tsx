import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { requestGatewayForProfile } from '@/store/gateway'

import { invalidateProfileAvatar, useProfileAvatar } from './profile-avatar'

vi.mock('@/store/gateway', () => ({
  requestGatewayForAgent: vi.fn(),
  requestGatewayForProfile: vi.fn()
}))

const requestAvatar = vi.mocked(requestGatewayForProfile)

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('profile avatars', () => {
  beforeEach(() => {
    requestAvatar.mockReset()
  })

  it('refreshes an already mounted avatar after its photo is replaced', async () => {
    requestAvatar
      .mockResolvedValueOnce({ data: 'data:image/png;base64,old', found: true })
      .mockResolvedValueOnce({ data: 'data:image/png;base64,new', found: true })

    const view = renderHook(() => useProfileAvatar('replace-me', undefined, true))

    await waitFor(() => expect(view.result.current).toBe('data:image/png;base64,old'))

    act(() => invalidateProfileAvatar('replace-me'))

    await waitFor(() => expect(view.result.current).toBe('data:image/png;base64,new'))
    expect(requestAvatar).toHaveBeenCalledTimes(2)
  })

  it('retries after a transient read failure instead of caching null', async () => {
    requestAvatar
      .mockRejectedValueOnce(new Error('temporary gateway failure'))
      .mockResolvedValueOnce({ data: 'data:image/png;base64,retry', found: true })

    const view = renderHook(() => useProfileAvatar('retry-me', undefined, true))

    await waitFor(() => expect(requestAvatar).toHaveBeenCalledTimes(1))

    act(() => invalidateProfileAvatar('retry-me'))

    await waitFor(() => expect(view.result.current).toBe('data:image/png;base64,retry'))
    expect(requestAvatar).toHaveBeenCalledTimes(2)
  })
})
