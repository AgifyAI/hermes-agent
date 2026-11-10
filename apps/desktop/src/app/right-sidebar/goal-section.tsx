import { useStore } from '@nanostores/react'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'

import { queueKickoffIfSessionBusy } from '@/app/session/hooks/use-prompt-actions/queue-if-busy'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { Pause, Play, Trash2 } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { confirm } from '@/store/confirm'
import { $activeSessionId, $selectedStoredSessionId } from '@/store/session'
import {
  runSessionControlAction,
  type SessionControlAction,
  type SessionControlActionArgs,
  type SessionControlGoal,
  type SessionControlWaitBarrier
} from '@/store/session-control'

import { requestComposerPromptSend } from '../chat/composer/prompt-send'

import {
  SIDEBAR_CARD_CLASS,
  SidebarSectionContent,
  SidebarSectionHeader,
  SidebarSectionToggle
} from './section-header'
import { $rightSidebarSectionRequest } from './section-request'
import { useAutomationControl } from './use-automation-control'

const PHASE_DOT: Record<string, string> = {
  active: 'bg-(--linear-green)',
  blocked: 'bg-(--linear-red)',
  budget_limited: 'bg-(--linear-yellow)',
  complete: 'bg-(--linear-text-quaternary)',
  paused: 'bg-(--linear-yellow)'
}

function phaseOf(goal: SessionControlGoal): string {
  return goal.phase ?? (goal.status === 'done' ? 'complete' : goal.status)
}

function progressLabel(goal: SessionControlGoal, t: ReturnType<typeof useI18n>['t']): string {
  const labels = t.rightSidebar

  if (goal.token_budget && goal.token_budget > 0) {
    return labels.goalProgressTokens((goal.tokens_used ?? 0).toLocaleString(), goal.token_budget.toLocaleString())
  }

  const started = goal.rounds_started ?? goal.turns_used
  const max = goal.max_rounds ?? goal.max_turns

  return max > 0 ? labels.goalProgressRounds(started, max) : labels.goalProgressRounds(started, '∞')
}

function waitLabel(barrier: SessionControlWaitBarrier, t: ReturnType<typeof useI18n>['t']): string {
  const cause = barrier.cause ?? barrier.type
  const remaining = barrier.remaining_seconds

  return remaining === undefined
    ? t.rightSidebar.goalWaitingOn(cause)
    : t.rightSidebar.goalWaitingOnSeconds(cause, remaining)
}

interface Feedback {
  error?: string
  success?: string
}

/** The Goal card of the Automations panel: state, objective, progress, wait and the
 * controls the backend already exposes (pause/resume/clear/unwait/criteria). */
export function GoalSection() {
  const { t } = useI18n()
  const labels = t.rightSidebar
  const runtimeSessionId = useStore($activeSessionId)
  const storedSessionId = useStore($selectedStoredSessionId)
  const { entry, snapshot } = useAutomationControl(runtimeSessionId)
  const goal = snapshot?.goal ?? null
  const request = useStore($rightSidebarSectionRequest)

  const [open, setOpen] = useState(true)
  const [criteriaOpen, setCriteriaOpen] = useState(false)
  const [criterion, setCriterion] = useState('')
  const [feedback, setFeedback] = useState<Feedback>({})
  const [busy, setBusy] = useState(false)

  // "Open the goal card" from elsewhere (indicator, deep link) re-opens it.
  useEffect(() => {
    if (request?.section !== 'goal') {
      return
    }

    setOpen(true)
    $rightSidebarSectionRequest.set(null)
  }, [request])

  useEffect(() => {
    setFeedback({})
    setCriteriaOpen(false)
  }, [runtimeSessionId])

  const act = useCallback(
    async (action: SessionControlAction, args?: SessionControlActionArgs) => {
      if (!runtimeSessionId || busy) {
        return
      }

      setBusy(true)
      setFeedback({})

      try {
        const dispatch = await runSessionControlAction(runtimeSessionId, action, args)

        if (dispatch.type === 'send') {
          if (!dispatch.message) {
            setFeedback({ error: labels.goalContinuationFailed })

            return
          }

          const queued = queueKickoffIfSessionBusy({
            displayText: dispatch.display ?? undefined,
            sessionId: runtimeSessionId,
            storedSessionId,
            text: dispatch.message
          })

          if (queued === 'busy') {
            setFeedback({ error: labels.goalContinuationFailed })

            return
          }

          if (queued === 'idle' && storedSessionId) {
            const sent = requestComposerPromptSend(storedSessionId, dispatch.message, dispatch.display ?? undefined)

            if (!sent) {
              setFeedback({ error: labels.goalContinuationFailed })

              return
            }
          }
        }

        setFeedback({ success: labels.goalActionDone })
      } catch (error) {
        setFeedback({ error: error instanceof Error ? error.message : labels.goalActionFailed })
      } finally {
        setBusy(false)
      }
    },
    [busy, labels, runtimeSessionId, storedSessionId]
  )

  const clearGoal = useCallback(async () => {
    const ok = await confirm({
      confirmLabel: labels.goalClearConfirm,
      description: labels.goalClearConfirmBody,
      destructive: true,
      title: labels.goalClearConfirmTitle
    })

    if (ok) {
      await act('goal.clear')
    }
  }, [act, labels])

  const addCriterion = useCallback(async () => {
    const text = criterion.trim()

    if (!text) {
      return
    }

    await act('subgoal.add', { text })
    setCriterion('')
  }, [act, criterion])

  const phase = goal ? phaseOf(goal) : null
  const pending = Boolean(entry?.pendingAction) || busy
  const waitBarrier = goal?.wait_barrier

  const stateLabel = useMemo(() => {
    switch (phase) {
      case 'active':
        return labels.goalPhaseActive
      case 'blocked':
        return labels.goalPhaseBlocked
      case 'budget_limited':
        return labels.goalPhaseBudgetLimited
      case 'complete':
        return labels.goalPhaseComplete
      default:
        return labels.goalPhasePaused
    }
  }, [labels, phase])

  return (
    <section className={cn(SIDEBAR_CARD_CLASS, 'shrink-0')} data-slot="goal-section">
      <SidebarSectionHeader>
        <SidebarSectionToggle onClick={() => setOpen(current => !current)} open={open}>
          <span className="flex min-w-0 items-center gap-1.5">
            {phase && (
              <span
                aria-hidden="true"
                className={cn('inline-block size-1.5 shrink-0 rounded-full', PHASE_DOT[phase] ?? PHASE_DOT.paused)}
              />
            )}
            <span className="truncate">{labels.goalTitle}</span>
            {phase && (
              <span className="shrink-0 text-[0.6875rem] font-normal text-(--linear-text-quaternary)">{stateLabel}</span>
            )}
          </span>
        </SidebarSectionToggle>
      </SidebarSectionHeader>
      <SidebarSectionContent open={open}>
        <div className="flex flex-col gap-2 px-3 pb-2.5">
          {!goal ? (
            <p className="text-xs leading-relaxed text-(--linear-text-quaternary)">{labels.goalEmpty}</p>
          ) : (
            <>
              <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-(--linear-text-secondary)">
                {goal.title}
              </p>
              <div className="flex items-center gap-2 text-[0.6875rem] text-(--linear-text-tertiary)">
                <span>{progressLabel(goal, t)}</span>
                {goal.time_used_seconds ? (
                  <span className="text-(--linear-text-quaternary)">{labels.goalTime(goal.time_used_seconds)}</span>
                ) : null}
              </div>
              {waitBarrier && (
                <div className="flex items-center justify-between gap-2 rounded-md border-[0.5px] border-(--linear-border-panel) bg-(--linear-bg-panel) px-2 py-1.5">
                  <span className="min-w-0 truncate text-[0.6875rem] text-(--linear-text-tertiary)">
                    {waitLabel(waitBarrier, t)}
                  </span>
                  <button
                    className="shrink-0 text-[0.6875rem] font-medium text-(--linear-text-secondary) hover:text-(--linear-text-primary)"
                    onClick={() => void act('goal.unwait')}
                    type="button"
                  >
                    {labels.goalResumeNow}
                  </button>
                </div>
              )}
              {goal.paused_reason && phase !== 'complete' && (
                <p className="text-[0.6875rem] leading-relaxed text-(--linear-text-tertiary)">
                  {labels.goalReason(goal.paused_reason)}
                </p>
              )}
              {goal.blocked_reason?.message && (
                <p className="text-[0.6875rem] leading-relaxed text-(--linear-red)">{goal.blocked_reason.message}</p>
              )}
              {goal.subgoals.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {goal.subgoals.map((text, index) => (
                    <li className="group/criterion flex items-start gap-1" key={`${index}-${text}`}>
                      <span className="min-w-0 flex-1 break-words text-[0.6875rem] leading-relaxed text-(--linear-text-tertiary)">
                        {text}
                      </span>
                      <Tip label={labels.goalCriterionRemove}>
                        <button
                          aria-label={labels.goalCriterionRemove}
                          className="shrink-0 text-(--linear-text-quaternary) opacity-0 transition-opacity hover:text-(--linear-text-primary) focus-visible:opacity-100 group-hover/criterion:opacity-100"
                          onClick={() => void act('subgoal.remove', { index: index + 1 })}
                          type="button"
                        >
                          <Codicon name="close" size="0.75rem" />
                        </button>
                      </Tip>
                    </li>
                  ))}
                </ul>
              )}
              {criteriaOpen ? (
                <form
                  className="flex items-center gap-1"
                  onSubmit={event => {
                    event.preventDefault()
                    void addCriterion()
                  }}
                >
                  <input
                    aria-label={labels.goalCriterionPlaceholder}
                    autoFocus
                    className="h-7 min-w-0 flex-1 rounded-md border-[0.5px] border-(--linear-border-panel) bg-(--linear-bg-panel) px-2 text-[0.6875rem] text-(--linear-text-primary) outline-none placeholder:text-(--linear-text-quaternary) focus:border-(--linear-border-secondary)"
                    onChange={event => setCriterion(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Escape') {
                        setCriteriaOpen(false)
                        setCriterion('')
                      }
                    }}
                    placeholder={labels.goalCriterionPlaceholder}
                    value={criterion}
                  />
                  <button
                    className="text-[0.6875rem] font-medium text-(--linear-text-secondary) disabled:opacity-50"
                    disabled={!criterion.trim() || pending}
                    type="submit"
                  >
                    {labels.goalCriterionAdd}
                  </button>
                </form>
              ) : null}
              <div className="flex flex-wrap items-center gap-1">
                {phase === 'active' && (
                  <ActionButton disabled={pending} label={labels.goalPause} onClick={() => void act('goal.pause')}>
                    <Pause className="size-3" />
                  </ActionButton>
                )}
                {(phase === 'paused' || phase === 'blocked' || phase === 'budget_limited') && (
                  <ActionButton disabled={pending} label={labels.goalResume} onClick={() => void act('goal.resume')}>
                    <Play className="size-3" />
                  </ActionButton>
                )}
                {phase === 'active' && (
                  <ActionButton disabled={pending} label={labels.goalAddCriterion} onClick={() => setCriteriaOpen(true)}>
                    <Codicon name="add" size="0.75rem" />
                  </ActionButton>
                )}
                <ActionButton destructive disabled={pending} label={labels.goalClear} onClick={() => void clearGoal()}>
                  <Trash2 className="size-3" />
                </ActionButton>
              </div>
              {feedback.error && <p className="text-[0.6875rem] text-(--linear-red)">{feedback.error}</p>}
              {feedback.success && <p className="sr-only">{feedback.success}</p>}
            </>
          )}
        </div>
      </SidebarSectionContent>
    </section>
  )
}

function ActionButton({
  children,
  destructive,
  disabled,
  label,
  onClick
}: {
  children: ReactNode
  destructive?: boolean
  disabled?: boolean
  label: string
  onClick: () => void
}) {
  return (
    <Tip label={label}>
      <button
        aria-label={label}
        className={cn(
          'flex h-6 items-center gap-1 rounded-md px-1.5 text-[0.6875rem] font-medium text-(--linear-text-tertiary) transition-colors hover:bg-(--linear-hover-sidebar-icon) hover:text-(--linear-text-primary) disabled:opacity-50',
          destructive && 'hover:text-(--linear-red)'
        )}
        disabled={disabled}
        onClick={onClick}
        type="button"
      >
        {children}
        <span className="truncate">{label}</span>
      </button>
    </Tip>
  )
}
