import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as GoalsModule from '@/store/goals'
import type * as SessionControlModule from '@/store/session-control'

const { mockRefreshSessionControl, mockRunSessionControlAction, mockRefreshSessionGoal } = vi.hoisted(() => ({
  mockRefreshSessionControl: vi.fn(),
  mockRunSessionControlAction: vi.fn(),
  mockRefreshSessionGoal: vi.fn()
}))

vi.mock('@/store/session-control', async importOriginal => {
  const actual = await importOriginal<typeof SessionControlModule>()

  return {
    ...actual,
    refreshSessionControl: mockRefreshSessionControl,
    runSessionControlAction: mockRunSessionControlAction
  }
})

vi.mock('@/store/goals', async importOriginal => {
  const actual = await importOriginal<typeof GoalsModule>()

  return {
    ...actual,
    refreshSessionGoal: mockRefreshSessionGoal
  }
})

import { I18nProvider } from '@/i18n'
import { clearQueuedPrompts } from '@/store/composer-queue'
import { $goalsBySession } from '@/store/goals'
import {
  $sessionControlBySession,
  type SessionControlEntry,
  type SessionControlGoal,
  type SessionControlSnapshot
} from '@/store/session-control'
import { $sessionStates } from '@/store/session-states'
import { $todosBySession } from '@/store/todos'

import { ComposerStatusStack } from './index'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

const SID = 'sess-ctrl-1'

const sampleGoal = (overrides?: Partial<SessionControlGoal>): SessionControlGoal => ({
  contract: {
    boundaries: 'test boundaries',
    constraints: 'test constraints',
    outcome: 'test outcome',
    stop_when: 'test stop condition',
    verification: 'test verification'
  },
  gates: [
    {
      attempts: 1,
      command: 'npm test',
      last_exit_code: 0,
      max_retries: 3,
      timeout_seconds: 30
    }
  ],
  max_turns: 20,
  status: 'active',
  subgoals: ['First criterion', 'Second criterion'],
  title: 'Execute complete work order',
  turns_used: 3,
  ...overrides
})

const sampleSnapshot = (overrides?: Partial<SessionControlSnapshot>): SessionControlSnapshot => ({
  goal: sampleGoal(),
  heartbeat: null,
  loop: null,
  revision: 'rev-goal-1',
  updated_at: 1700000000,
  ...overrides
})

const mockEntry = (overrides?: Partial<SessionControlEntry>): SessionControlEntry => ({
  capability: 'supported',
  error: null,
  loading: false,
  pendingAction: null,
  snapshot: sampleSnapshot(),
  ...overrides
})

function renderStack(sessionId: null | string = SID, props: Record<string, unknown> = {}) {
  return render(
    <MemoryRouter>
      <I18nProvider configClient={null} initialLocale="en">
        <ComposerStatusStack queue={null} sessionId={sessionId} {...props} />
      </I18nProvider>
    </MemoryRouter>
  )
}

describe('ComposerStatusStack session-control UI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    $goalsBySession.set({})
    $sessionControlBySession.set({})
    $todosBySession.set({})
    mockRefreshSessionControl.mockResolvedValue(undefined)
    mockRefreshSessionGoal.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    $goalsBySession.set({})
    $sessionControlBySession.set({})
    $todosBySession.set({})
    $sessionStates.set({})
    clearQueuedPrompts('stored-1')
  })

  // 1. initial structured hydration on mount; old-gateway/legacy goal remains until supported
  // 1. initial structured hydration on mount; old-gateway/legacy goal remains until supported
  it('calls refreshSessionControl on mount and keeps legacy goal while capability is unknown/unsupported', () => {
    $goalsBySession.set({
      [SID]: { status: 'active', title: 'Legacy Goal Title', updatedAt: Date.now() }
    })
    $sessionControlBySession.set({
      [SID]: { capability: 'unknown', error: null, loading: false, pendingAction: null, snapshot: null }
    })

    renderStack()

    expect(mockRefreshSessionControl).toHaveBeenCalledWith(SID)
    expect(mockRefreshSessionGoal).not.toHaveBeenCalled()
    // Legacy goal remains available while capability is unknown.
    fireEvent.click(screen.getByRole('button', { name: /Goal active/ }))
    expect(screen.getByText('Legacy Goal Title')).toBeTruthy()
  })

  // 2. the goal left the composer: its card lives in the Automations panel.
  it('no longer renders the structured goal card in the composer', () => {
    $sessionControlBySession.set({
      [SID]: mockEntry({
        capability: 'supported',
        snapshot: sampleSnapshot({ goal: sampleGoal({ title: 'Structured Goal Title' }) })
      })
    })

    renderStack()

    expect(screen.queryByText('Structured Goal Title')).toBeNull()
    expect(screen.queryByRole('button', { name: /goal actions/i })).toBeNull()
  })
})
