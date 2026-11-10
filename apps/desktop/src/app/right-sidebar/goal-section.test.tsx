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
  revision: 1,
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

  it('opens an edit form prefilled with the objective and contract', () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const objective = screen.getByRole('textbox', { name: 'Objective' }) as HTMLTextAreaElement
    expect(objective.value).toBe('Ship the automations panel')
    expect((screen.getByRole('textbox', { name: 'Verification' }) as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
  })

  it('rewrites an active goal only after confirming, keeping the revision', async () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Objective' }), {
      target: { value: 'Ship the panel and the contract editor' }
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Verification' }), {
      target: { value: 'npm run test:ui passes' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled())
    await waitFor(() =>
      expect(mockRunSessionControlAction).toHaveBeenCalledWith(SID, 'goal.edit', {
        contract: { verification: 'npm run test:ui passes' },
        revision: 1,
        text: 'Ship the panel and the contract editor'
      })
    )
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).toBeNull())
  })

  it('does not rewrite when the confirmation is refused', async () => {
    mockConfirm.mockResolvedValue(false)
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled())
    expect(mockRunSessionControlAction).not.toHaveBeenCalledWith(SID, 'goal.edit', expect.anything())
  })

  it('creates a goal from the empty state without a destructive confirmation', async () => {
    $sessionControlBySession.set({ [SID]: entry(sampleSnapshot({ goal: null })) })
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Set a goal' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Objective' }), {
      target: { value: 'A brand new objective' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(mockRunSessionControlAction).toHaveBeenCalledWith(SID, 'goal.set', {
        text: 'A brand new objective'
      })
    )
    expect(mockConfirm).not.toHaveBeenCalled()
  })

  it('starts a new goal from a complete one after confirming', async () => {
    $sessionControlBySession.set({
      [SID]: entry(sampleSnapshot({ goal: sampleGoal({ phase: 'complete', status: 'done' }) }))
    })
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Objective' }), { target: { value: 'Next objective' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled())
    await waitFor(() =>
      expect(mockRunSessionControlAction).toHaveBeenCalledWith(SID, 'goal.set', {
        revision: 1,
        text: 'Next objective'
      })
    )
  })

  it('shows an inline error and keeps the form when saving fails', async () => {
    mockRunSessionControlAction.mockRejectedValue(new Error('the goal changed since this form was loaded'))
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('changed since this form was loaded')
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
  })

  it('validates an empty objective before calling the backend', async () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Objective' }), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Write an objective')
    expect(mockRunSessionControlAction).not.toHaveBeenCalledWith(SID, 'goal.edit', expect.anything())
  })

  it('cancels an edit without calling the backend', async () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.getByText('Ship the automations panel')).toBeTruthy()
    expect(mockRunSessionControlAction).not.toHaveBeenCalled()
  })

  it('shows the round history when opened and keeps it compact', async () => {
    $sessionControlBySession.set({
      [SID]: entry(
        sampleSnapshot({
          goal: sampleGoal({
            history: [
              { at: 1_700_000_000, event: 'goal_set' },
              { at: 1_700_000_060, event: 'round_admitted', round: 2 },
              { at: 1_700_000_120, event: 'gate_failed', command: 'npm run lint', exit_code: 1, reason: 'lint failed' },
              { at: 1_700_000_180, event: 'tokens_used', tokens: 1200, total: 4200 }
            ]
          })
        })
      )
    })
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: /History \(4\)/ }))
    expect(await screen.findByText('Goal set')).toBeTruthy()
    expect(screen.getByText('Round started')).toBeTruthy()
    expect(screen.getByText('Gate failed')).toBeTruthy()
    expect(screen.getByText('$ npm run lint')).toBeTruthy()
    expect(screen.getByText(/— lint failed/)).toBeTruthy()
    expect(screen.getByText(/1,200 tokens/)).toBeTruthy()
  })

  it('lists quality gates with their status and controls', () => {
    $sessionControlBySession.set({
      [SID]: entry(
        sampleSnapshot({
          goal: sampleGoal({
            gates: [
              { attempts: 1, command: 'npm run test:ui', last_exit_code: 0, max_retries: 3, timeout_seconds: 300 },
              { attempts: 2, command: 'npm run lint', last_exit_code: 1, max_retries: 2, timeout_seconds: 60 }
            ]
          })
        })
      )
    })
    renderSection()
    expect(screen.getByText('$ npm run test:ui')).toBeTruthy()
    expect(screen.getByText('$ npm run lint')).toBeTruthy()
    expect(screen.getByText(/1\/3 attempts · 300s/)).toBeTruthy()
    expect(screen.getByText(/2\/2 attempts · 60s · exit 1/)).toBeTruthy()
  })

  it('adds a gate only after a confirmation that shows the exact command', async () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Add gate' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Gate command' }), {
      target: { value: 'npm run test:ui' }
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Timeout (s)' }), { target: { value: '120' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Retries' }), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }))

    await waitFor(() => expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
      description: expect.stringContaining('$ npm run test:ui')
    })))
    await waitFor(() =>
      expect(mockRunSessionControlAction).toHaveBeenCalledWith(SID, 'gate.add', {
        command: 'npm run test:ui',
        max_retries: 2,
        timeout_seconds: 120
      })
    )
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Gate command' })).toBeNull())
  })

  it('does not add a gate when the confirmation is refused', async () => {
    mockConfirm.mockResolvedValue(false)
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Add gate' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Gate command' }), { target: { value: 'true' } })
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }))
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled())
    expect(mockRunSessionControlAction).not.toHaveBeenCalledWith(SID, 'gate.add', expect.anything())
  })

  it('validates a gate command, timeout and retries inline', async () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Add gate' }))
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }))
    expect(await screen.findByText('Write the command this gate must run.')).toBeTruthy()

    fireEvent.change(screen.getByRole('textbox', { name: 'Gate command' }), { target: { value: 'true' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Timeout (s)' }), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }))
    expect(await screen.findByText(/Timeout must be/)).toBeTruthy()
    expect(mockConfirm).not.toHaveBeenCalled()
  })

  it('removes a gate only after a confirmation showing its command', async () => {
    $sessionControlBySession.set({
      [SID]: entry(
        sampleSnapshot({
          goal: sampleGoal({
            gates: [
              { attempts: 0, command: 'npm run lint', last_exit_code: null, max_retries: 3, timeout_seconds: 300 }
            ]
          })
        })
      )
    })
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Remove gate' }))
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
      description: expect.stringContaining('$ npm run lint')
    })))
    await waitFor(() => expect(mockRunSessionControlAction).toHaveBeenCalledWith(SID, 'gate.remove', { index: 1 }))
  })

  it('sets a bounded wait from the card', async () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Wait' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Value' }), { target: { value: '600' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Reason' }), { target: { value: 'rate limited' } })
    fireEvent.click(screen.getByRole('button', { name: /^Start wait$/ }))
    await waitFor(() =>
      expect(mockRunSessionControlAction).toHaveBeenCalledWith(SID, 'wait.set', {
        reason: 'rate limited',
        seconds: 600
      })
    )
  })

  it('validates a wait value inline', async () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Wait' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Value' }), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: /^Start wait$/ }))
    expect(await screen.findByText(/Duration must be/)).toBeTruthy()
    expect(mockRunSessionControlAction).not.toHaveBeenCalledWith(SID, 'wait.set', expect.anything())
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
