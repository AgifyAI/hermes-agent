import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as SessionControlModule from '@/store/session-control'

const { mockConfirm, mockRequestPromptSend, mockRunSessionControlAction } = vi.hoisted(() => ({
  mockConfirm: vi.fn(),
  mockRequestPromptSend: vi.fn(),
  mockRunSessionControlAction: vi.fn()
}))

vi.mock('@/store/session-control', async importOriginal => {
  const actual = await importOriginal<typeof SessionControlModule>()

  return {
    ...actual,
    refreshSessionControl: vi.fn().mockResolvedValue(undefined),
    runSessionControlAction: mockRunSessionControlAction
  }
})

vi.mock('@/store/confirm', () => ({ confirm: mockConfirm }))
vi.mock('@/app/chat/composer/prompt-send', () => ({ requestComposerPromptSend: mockRequestPromptSend }))

import { I18nProvider } from '@/i18n'
import { clearQueuedPrompts, getQueuedPrompts } from '@/store/composer-queue'
import { $activeSessionId, $selectedStoredSessionId } from '@/store/session'
import {
  $sessionControlBySession,
  type SessionControlEntry,
  type SessionControlGoal,
  type SessionControlSnapshot
} from '@/store/session-control'
import { $sessionStates } from '@/store/session-states'

import { GoalSection } from './goal-section'
import { $rightSidebarSectionRequest } from './section-request'

const SID = 'runtime-1'
const STORED = 'stored-1'

const sampleGoal = (overrides?: Partial<SessionControlGoal>): SessionControlGoal => ({
  contract: { boundaries: '', constraints: '', outcome: '', stop_when: '', verification: '' },
  gates: [],
  max_turns: 256,
  phase: 'active',
  rounds_started: 2,
  status: 'active',
  subgoals: ['Keep the API stable'],
  time_used_seconds: 125,
  title: 'Ship the automations panel',
  token_budget: 100_000,
  tokens_used: 12_345,
  turns_used: 2,
  ...overrides
})

const sampleSnapshot = (overrides?: Partial<SessionControlSnapshot>): SessionControlSnapshot => ({
  goal: sampleGoal(),
  heartbeat: null,
  loop: null,
  revision: 'rev-1',
  updated_at: 1_700_000_000,
  ...overrides
})

const entry = (snapshot: SessionControlSnapshot): SessionControlEntry => ({
  capability: 'supported',
  error: null,
  loading: false,
  pendingAction: null,
  snapshot
})

function renderSection() {
  return render(
    <I18nProvider configClient={null} initialLocale="en">
      <GoalSection />
    </I18nProvider>
  )
}

describe('GoalSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    $activeSessionId.set(SID)
    $selectedStoredSessionId.set(STORED)
    $sessionStates.set({})
    $rightSidebarSectionRequest.set(null)
    $sessionControlBySession.set({ [SID]: entry(sampleSnapshot()) })
    mockConfirm.mockResolvedValue(true)
    mockRequestPromptSend.mockReturnValue(true)
    mockRunSessionControlAction.mockResolvedValue({
      display: null,
      message: null,
      notice: null,
      output: null,
      type: 'exec'
    })
  })

  afterEach(() => {
    cleanup()
    $activeSessionId.set(null)
    $selectedStoredSessionId.set(null)
    $sessionControlBySession.set({})
    $sessionStates.set({})
    clearQueuedPrompts(STORED)
  })

  it('shows the empty state when the chat has no goal', () => {
    $sessionControlBySession.set({ [SID]: entry(sampleSnapshot({ goal: null })) })
    renderSection()
    expect(screen.getByText(/No goal in this chat/)).toBeTruthy()
  })

  it('shows phase, objective, token progress, time and criteria', () => {
    renderSection()
    expect(screen.getByText('Ship the automations panel')).toBeTruthy()
    expect(screen.getByText(/12,345 \/ 100,000 tokens/)).toBeTruthy()
    expect(screen.getByText(/2 min/)).toBeTruthy()
    expect(screen.getByText('Keep the API stable')).toBeTruthy()
    expect(screen.getByText('Active')).toBeTruthy()
  })

  it('pauses an active goal and resumes a paused one', async () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    await waitFor(() => expect(mockRunSessionControlAction).toHaveBeenCalledWith(SID, 'goal.pause', undefined))

    act(() => {
      $sessionControlBySession.set({
        [SID]: entry(sampleSnapshot({ goal: sampleGoal({ phase: 'paused', status: 'paused' }) }))
      })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    await waitFor(() => expect(mockRunSessionControlAction).toHaveBeenCalledWith(SID, 'goal.resume', undefined))
  })

  it('clears the goal only after the confirmation', async () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled())
    await waitFor(() => expect(mockRunSessionControlAction).toHaveBeenCalledWith(SID, 'goal.clear', undefined))
  })

  it('does not clear when the confirmation is refused', async () => {
    mockConfirm.mockResolvedValue(false)
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled())
    expect(mockRunSessionControlAction).not.toHaveBeenCalledWith(SID, 'goal.clear', undefined)
  })

  it('removes a criterion and adds a new one', async () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Remove criterion' }))
    await waitFor(() => expect(mockRunSessionControlAction).toHaveBeenCalledWith(SID, 'subgoal.remove', { index: 1 }))

    fireEvent.click(screen.getByRole('button', { name: 'Criterion' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Cover the empty state' } })
    fireEvent.submit(screen.getByRole('textbox'))
    await waitFor(() =>
      expect(mockRunSessionControlAction).toHaveBeenCalledWith(SID, 'subgoal.add', {
        text: 'Cover the empty state'
      })
    )
  })

  it('resumes a deferred goal immediately', async () => {
    $sessionControlBySession.set({
      [SID]: entry(
        sampleSnapshot({
          goal: sampleGoal({
            wait_barrier: {
              cause: 'subagents',
              deadline_at: 1_700_003_600,
              max_seconds: 1800,
              reason: 'delegation batch',
              remaining_seconds: 600,
              type: 'until',
              until_at: 1_700_003_600
            }
          })
        })
      )
    })
    renderSection()
    expect(screen.getByText(/Waiting on subagents/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Resume now' }))
    await waitFor(() => expect(mockRunSessionControlAction).toHaveBeenCalledWith(SID, 'goal.unwait', undefined))
  })

  it('sends the backend continuation through the owning composer', async () => {
    mockRunSessionControlAction.mockResolvedValue({
      display: '/goal resume',
      message: 'Continue toward the goal',
      notice: null,
      output: null,
      type: 'send'
    })
    $sessionControlBySession.set({ [SID]: entry(sampleSnapshot({ goal: sampleGoal({ phase: 'paused', status: 'paused' }) })) })
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    await waitFor(() =>
      expect(mockRequestPromptSend).toHaveBeenCalledWith(STORED, 'Continue toward the goal', '/goal resume')
    )
  })

  it('queues the continuation instead of sending when the session is busy', async () => {
    $sessionStates.set({ [SID]: { busy: true, storedSessionId: STORED } as never })
    mockRunSessionControlAction.mockResolvedValue({
      display: '/goal resume',
      message: 'Continue toward the goal',
      notice: null,
      output: null,
      type: 'send'
    })
    $sessionControlBySession.set({ [SID]: entry(sampleSnapshot({ goal: sampleGoal({ phase: 'paused', status: 'paused' }) })) })
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    await waitFor(() =>
      expect(getQueuedPrompts(STORED)).toMatchObject([
        { displayText: '/goal resume', text: 'Continue toward the goal' }
      ])
    )
    expect(mockRequestPromptSend).not.toHaveBeenCalled()
  })

  it('opens the card when another surface requests the goal section', () => {
    renderSection()

    const header = screen.getByRole('button', { name: /^Goal/ })
    fireEvent.click(header)
    expect(header.getAttribute('aria-expanded')).toBe('false')

    act(() => {
      $rightSidebarSectionRequest.set({ section: 'goal', token: 1 })
    })

    expect(screen.getByRole('button', { name: /^Goal/ }).getAttribute('aria-expanded')).toBe('true')
    expect($rightSidebarSectionRequest.get()).toBeNull()
  })
})
