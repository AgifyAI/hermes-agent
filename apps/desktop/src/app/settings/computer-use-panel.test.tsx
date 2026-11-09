// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProfileScope } from '@/hermes'
import type { ComputerUseStatus } from '@/types/hermes'

const mocks = vi.hoisted(() => ({
  getActionStatus: vi.fn(),
  getComputerUseStatus: vi.fn(),
  grantComputerUsePermissions: vi.fn(),
  notify: vi.fn(),
  notifyError: vi.fn(),
  upsertDesktopActionTask: vi.fn()
}))

vi.mock('@/hermes', () => ({
  getActionStatus: mocks.getActionStatus,
  getComputerUseStatus: mocks.getComputerUseStatus,
  grantComputerUsePermissions: mocks.grantComputerUsePermissions,
  profileScopeKey: (scope?: ProfileScope) => {
    if (scope && typeof scope === 'object') {
      return `${scope.connectionId ?? ''}::${scope.profile ?? 'default'}`
    }

    return scope ?? 'default'
  }
}))

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      settings: {
        computerUse: {
          accessibility: 'Accessibility',
          driverHealth: 'Driver health',
          screenRecording: 'Screen Recording'
        }
      }
    }
  })
}))

vi.mock('@/store/activity', () => ({ upsertDesktopActionTask: mocks.upsertDesktopActionTask }))
vi.mock('@/store/notifications', () => ({ notify: mocks.notify, notifyError: mocks.notifyError }))

import { ComputerUsePanel } from './computer-use-panel'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void

  const promise = new Promise<T>(next => {
    resolve = next
  })

  return { promise, resolve }
}

function status(version: string, ready: boolean): ComputerUseStatus {
  return {
    accessibility: null,
    can_grant: false,
    checks: [],
    error: null,
    installed: true,
    platform: 'linux',
    platform_supported: true,
    ready,
    screen_recording: null,
    screen_recording_capturable: null,
    source: null,
    version
  }
}

describe('ComputerUsePanel scope isolation', () => {
  beforeEach(() => {
    mocks.getActionStatus.mockReset()
    mocks.getComputerUseStatus.mockReset()
    mocks.grantComputerUsePermissions.mockReset()
    mocks.notify.mockReset()
    mocks.notifyError.mockReset()
    mocks.upsertDesktopActionTask.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('does not let a late status from the previous profile replace the new profile', async () => {
    const first = deferred<ComputerUseStatus>()
    const second = deferred<ComputerUseStatus>()
    const scopeA = { connectionId: 'gateway-a', profile: 'profile-a' }
    const scopeB = { connectionId: 'gateway-b', profile: 'profile-b' }

    mocks.getComputerUseStatus.mockImplementation((scope: ProfileScope) => {
      return scope === scopeA ? first.promise : second.promise
    })

    const rendered = render(<ComputerUsePanel profile={scopeA} />)

    await waitFor(() => expect(mocks.getComputerUseStatus).toHaveBeenCalledWith(scopeA))

    rendered.rerender(<ComputerUsePanel profile={scopeB} />)
    await waitFor(() => expect(mocks.getComputerUseStatus).toHaveBeenCalledWith(scopeB))

    await act(async () => {
      second.resolve(status('profile-b', false))
      await second.promise
    })
    expect(await screen.findByText('profile-b')).toBeTruthy()

    await act(async () => {
      first.resolve(status('profile-a', true))
      await first.promise
    })

    expect(screen.getByText('profile-b')).toBeTruthy()
    expect(screen.queryByText('profile-a')).toBeNull()
    expect(screen.queryByText('Computer Use is ready. Ask the agent to capture an app and click around.')).toBeNull()
  })
})
