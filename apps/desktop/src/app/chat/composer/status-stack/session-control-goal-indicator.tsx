import { useStore } from '@nanostores/react'

import { requestRightSidebarSection } from '@/app/right-sidebar/section-request'
import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { $rightSideOpen } from '@/store/layout'
import type { SessionControlGoal } from '@/store/session-control'

const PHASE_DOT: Record<string, string> = {
  active: 'bg-(--linear-green)',
  blocked: 'bg-(--linear-red)',
  budget_limited: 'bg-(--linear-yellow)',
  complete: 'bg-(--linear-text-quaternary)',
  paused: 'bg-(--linear-yellow)'
}

/** Discreet entry point while the right rail is closed: the goal lives in the
 * Automations panel, this row only says it is there and opens that panel. */
export function GoalPanelIndicator({ goal }: { goal: SessionControlGoal }) {
  const { t } = useI18n()
  const labels = t.rightSidebar
  const rightSideOpen = useStore($rightSideOpen)

  if (rightSideOpen) {
    return null
  }

  const phase = goal.phase ?? (goal.status === 'done' ? 'complete' : goal.status)
  const stateLabel =
    phase === 'active'
      ? labels.goalPhaseActive
      : phase === 'blocked'
        ? labels.goalPhaseBlocked
        : phase === 'budget_limited'
          ? labels.goalPhaseBudgetLimited
          : phase === 'complete'
            ? labels.goalPhaseComplete
            : labels.goalPhasePaused

  const rounds = goal.rounds_started ?? goal.turns_used
  const hasBudget = typeof goal.token_budget === 'number' && goal.token_budget > 0

  return (
    <button
      aria-label={labels.goalOpenPanel}
      className="group/goal-indicator flex w-full items-center gap-2 border-b-[0.5px] border-(--linear-border-panel) px-3 py-1.5 text-left text-xs text-(--linear-text-tertiary) transition-colors hover:bg-(--linear-hover-sidebar-icon) hover:text-(--linear-text-primary)"
      onClick={() => requestRightSidebarSection('goal')}
      type="button"
    >
      <span aria-hidden="true" className={cn('inline-block size-1.5 shrink-0 rounded-full', PHASE_DOT[phase])} />
      <span className="min-w-0 flex-1 truncate">
        {labels.goalTitle} · {stateLabel}
        <span className="text-(--linear-text-quaternary)">
          {' · '}
          {labels.goalIndicatorRounds(rounds)}
          {hasBudget
            ? ` · ${labels.goalIndicatorTokens(goal.tokens_used ?? 0, goal.token_budget as number)}`
            : ''}
        </span>
      </span>
      <span className="shrink-0 text-[0.6875rem] text-(--linear-text-quaternary) group-hover/goal-indicator:text-(--linear-text-secondary)">
        {labels.goalOpenPanel}
      </span>
      <Codicon name="chevron-right" size="0.75rem" />
    </button>
  )
}
