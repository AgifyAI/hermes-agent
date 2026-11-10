import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { I18nProvider } from '@/i18n'
import { setFileBrowserOpen } from '@/store/layout'
import type { SessionControlGoal } from '@/store/session-control'

import { $rightSidebarSectionRequest } from '../../../right-sidebar/section-request'

import { GoalPanelIndicator } from './session-control-goal-indicator'

const goal: SessionControlGoal = {
  contract: { boundaries: '', constraints: '', outcome: '', stop_when: '', verification: '' },
  gates: [],
  max_turns: 10,
  phase: 'active',
  status: 'active',
  subgoals: [],
  title: 'Ship the panel',
  turns_used: 1
}

const renderIndicator = () =>
  render(
    <I18nProvider configClient={null} initialLocale="en">
      <GoalPanelIndicator goal={goal} />
    </I18nProvider>
  )

describe('GoalPanelIndicator', () => {
  beforeEach(() => {
    setFileBrowserOpen(false)
    $rightSidebarSectionRequest.set(null)
  })

  afterEach(() => {
    cleanup()
    setFileBrowserOpen(true)
    $rightSidebarSectionRequest.set(null)
  })

  it('shows a discreet row while the right rail is closed and opens the goal card', () => {
    renderIndicator()
    const button = screen.getByRole('button', { name: 'Automations' })
    expect(button.textContent).toContain('Goal')
    expect(button.textContent).toContain('Active')
    fireEvent.click(button)
    expect($rightSidebarSectionRequest.get()?.section).toBe('goal')
  })

  it('stays out of the way while the panel is open', () => {
    setFileBrowserOpen(true)
    renderIndicator()
    expect(screen.queryByRole('button', { name: 'Automations' })).toBeNull()
  })
})
