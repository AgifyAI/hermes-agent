import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as SessionControlModule from '@/store/session-control'

const { mockConfirm, mockRefresh, mockRunAction } = vi.hoisted(() => ({
  mockConfirm: vi.fn(),
  mockRefresh: vi.fn(),
  mockRunAction: vi.fn()
}))

vi.mock('@/store/session-control', async importOriginal => {
  const actual = await importOriginal<typeof SessionControlModule>()

  return { ...actual, refreshSessionControl: mockRefresh, runSessionControlAction: mockRunAction }
})
vi.mock('@/store/confirm', () => ({ confirm: mockConfirm }))

import { I18nProvider } from '@/i18n'
import { $activeSessionId } from '@/store/session'
import {
  $sessionControlBySession,
  type SessionControlEntry,
  type SessionControlHeartbeat,
  type SessionControlSnapshot
} from '@/store/session-control'

import { HeartbeatSection } from './heartbeat-section'

const SID = 'runtime-heartbeat'
const heartbeat = (overrides?: Partial<SessionControlHeartbeat>): SessionControlHeartbeat => ({
  created_at: Math.floor(Date.now() / 1000),
  fire_count: 2,
  interval_seconds: 1800,
  last_fired_at: 0,
  prompt: 'System health check',
  status: 'active',
  ...overrides
})
const entry = (snapshot: Partial<SessionControlSnapshot>): SessionControlEntry => ({
  capability: 'supported',
  error: null,
  loading: false,
  pendingAction: null,
  snapshot: { goal: null, heartbeat: null, loop: null, revision: 'r', updated_at: 1, ...snapshot }
})

const renderCard = () =>
  render(
    <I18nProvider configClient={null} initialLocale="en">
      <HeartbeatSection />
    </I18nProvider>
  )

describe('HeartbeatSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    $activeSessionId.set(SID)
    $sessionControlBySession.set({ [SID]: entry({ heartbeat: heartbeat() }) })
    mockConfirm.mockResolvedValue(true)
    mockRefresh.mockResolvedValue(undefined)
    mockRunAction.mockResolvedValue({ display: null, message: null, notice: null, output: null, type: 'exec' })
  })

  afterEach(() => {
    cleanup()
    $activeSessionId.set(null)
    $sessionControlBySession.set({})
    vi.useRealTimers()
  })

  it('shows prompt, interval, fires and a live countdown', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(1_700_000_000_000))
    $sessionControlBySession.set({
      [SID]: entry({ heartbeat: heartbeat({ created_at: 1_700_000_000, last_fired_at: 1_700_000_000 }) })
    })
    renderCard()
    expect(screen.getByText('System health check')).toBeTruthy()
    expect(screen.getByText('every 30m')).toBeTruthy()
    expect(screen.getByText('Fired 2 times')).toBeTruthy()
    expect(screen.getByText('next 00:30:00')).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(screen.getByText('next 00:29:59')).toBeTruthy()
  })

  it('pauses, resumes and clears with a confirmation', async () => {
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Pause heartbeat' }))
    await waitFor(() => expect(mockRunAction).toHaveBeenCalledWith(SID, 'heartbeat.pause', undefined))

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled())
    await waitFor(() => expect(mockRunAction).toHaveBeenCalledWith(SID, 'heartbeat.clear', undefined))
  })

  it('creates a heartbeat from the empty state', async () => {
    $sessionControlBySession.set({ [SID]: entry({ heartbeat: null }) })
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Set a heartbeat' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Heartbeat prompt' }), {
      target: { value: 'Check the build' }
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Every (min)' }), { target: { value: '45' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save heartbeat' }))
    await waitFor(() =>
      expect(mockRunAction).toHaveBeenCalledWith(SID, 'heartbeat.set', {
        interval_seconds: 2700,
        prompt: 'Check the build'
      })
    )
  })

  it('validates the prompt and interval inline', async () => {
    $sessionControlBySession.set({ [SID]: entry({ heartbeat: null }) })
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Set a heartbeat' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save heartbeat' }))
    expect(await screen.findByText('Write the prompt this heartbeat should wake with.')).toBeTruthy()

    fireEvent.change(screen.getByRole('textbox', { name: 'Heartbeat prompt' }), { target: { value: 'ok' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save heartbeat' }))
    expect(await screen.findByText(/whole number of minutes/)).toBeTruthy()
    expect(mockRunAction).not.toHaveBeenCalled()
  })
})
