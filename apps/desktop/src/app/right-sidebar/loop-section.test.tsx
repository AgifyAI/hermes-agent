import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  type SessionControlLoop,
  type SessionControlSnapshot
} from '@/store/session-control'

import { LoopSection } from './loop-section'

const SID = 'runtime-loop'
const loop = (overrides?: Partial<SessionControlLoop>): SessionControlLoop => ({
  awaiting_response: false,
  created_at: 1_700_000_000,
  current_delay: 120,
  deferred_by_goal: false,
  interval_seconds: 120,
  last_fired_at: 1_700_000_000,
  max_ticks: 10,
  mode: 'interval',
  next_due_at: Math.floor(Date.now() / 1000) + 60,
  prompt: 'Check pending reviews',
  status: 'active',
  ticks_fired: 3,
  times: 10,
  until: '',
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
      <LoopSection />
    </I18nProvider>
  )

describe('LoopSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    $activeSessionId.set(SID)
    $sessionControlBySession.set({ [SID]: entry({ loop: loop() }) })
    mockConfirm.mockResolvedValue(true)
    mockRefresh.mockResolvedValue(undefined)
    mockRunAction.mockResolvedValue({ display: null, message: null, notice: null, output: null, type: 'exec' })
  })

  afterEach(() => {
    cleanup()
    $activeSessionId.set(null)
    $sessionControlBySession.set({})
  })

  it('shows state, cadence, runs and countdown', () => {
    renderCard()
    expect(screen.getByText('Check pending reviews')).toBeTruthy()
    expect(screen.getByText('every 2m')).toBeTruthy()
    expect(screen.getByText('Run 3/10')).toBeTruthy()
    expect(screen.getByText(/next 00:0/)).toBeTruthy()
  })

  it('mentions when an active goal defers the loop', () => {
    $sessionControlBySession.set({ [SID]: entry({ loop: loop({ deferred_by_goal: true }) }) })
    renderCard()
    expect(screen.getByText(/An active goal currently controls the session/)).toBeTruthy()
  })

  it('pauses and stops the loop, stopping only after a confirmation', async () => {
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Pause loop' }))
    await waitFor(() => expect(mockRunAction).toHaveBeenCalledWith(SID, 'loop.pause', undefined))

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled())
    await waitFor(() => expect(mockRunAction).toHaveBeenCalledWith(SID, 'loop.stop', undefined))
  })

  it('creates a loop from the empty state with prompt, cadence and runs', async () => {
    $sessionControlBySession.set({ [SID]: entry({ loop: null }) })
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Start a loop' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Loop prompt' }), {
      target: { value: 'Audit the queue' }
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Every (min)' }), { target: { value: '10' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Runs' }), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save loop' }))
    await waitFor(() =>
      expect(mockRunAction).toHaveBeenCalledWith(SID, 'loop.set', {
        interval_seconds: 600,
        prompt: 'Audit the queue',
        times: 5
      })
    )
  })

  it('validates an empty prompt and a bad cadence inline', async () => {
    $sessionControlBySession.set({ [SID]: entry({ loop: null }) })
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Start a loop' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save loop' }))
    expect(await screen.findByText('Write the prompt this loop should re-run.')).toBeTruthy()

    fireEvent.change(screen.getByRole('textbox', { name: 'Loop prompt' }), { target: { value: 'ok' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Every (min)' }), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save loop' }))
    expect(await screen.findByText(/whole number of minutes/)).toBeTruthy()
    expect(mockRunAction).not.toHaveBeenCalled()
  })

  it('edits an existing loop', async () => {
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Loop prompt' }), {
      target: { value: 'Check the queue hourly' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save loop' }))
    await waitFor(() =>
      expect(mockRunAction).toHaveBeenCalledWith(SID, 'loop.set', {
        interval_seconds: 120,
        prompt: 'Check the queue hourly',
        times: 10
      })
    )
  })
})
