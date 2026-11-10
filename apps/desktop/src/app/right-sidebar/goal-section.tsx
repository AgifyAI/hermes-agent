import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useMemo, useState } from 'react'

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
  type SessionControlContractArgs,
  type SessionControlGate,
  type SessionControlGoal,
  type SessionControlWaitBarrier
} from '@/store/session-control'

import { requestComposerPromptSend } from '../chat/composer/prompt-send'

import { ActionButton } from './card-parts'
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

interface GoalDraft {
  boundaries: string
  constraints: string
  outcome: string
  stopWhen: string
  title: string
  verification: string
}

const BLANK_DRAFT: GoalDraft = { boundaries: '', constraints: '', outcome: '', stopWhen: '', title: '', verification: '' }

function draftFromGoal(goal: SessionControlGoal | null): GoalDraft {
  if (!goal) {
    return BLANK_DRAFT
  }

  return {
    boundaries: goal.contract.boundaries,
    constraints: goal.contract.constraints,
    outcome: goal.contract.outcome,
    stopWhen: goal.contract.stop_when,
    title: goal.title,
    verification: goal.contract.verification
  }
}

function contractFromDraft(draft: GoalDraft): SessionControlContractArgs {
  const contract: SessionControlContractArgs = {}
  const pairs: [keyof SessionControlContractArgs, string][] = [
    ['outcome', draft.outcome],
    ['verification', draft.verification],
    ['constraints', draft.constraints],
    ['boundaries', draft.boundaries],
    ['stop_when', draft.stopWhen]
  ]

  for (const [key, raw] of pairs) {
    const value = raw.trim()

    if (value) {
      contract[key] = value
    }
  }

  return contract
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
// health: allow CC -- one card owns the goal state machine (phases, edit/create, gates, wait); splitting it would scatter that state across siblings
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
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<GoalDraft>(BLANK_DRAFT)
  const [formError, setFormError] = useState<string | null>(null)
  const [gateFormOpen, setGateFormOpen] = useState(false)
  const [gateCommand, setGateCommand] = useState('')
  const [gateTimeout, setGateTimeout] = useState('')
  const [gateRetries, setGateRetries] = useState('')
  const [gateError, setGateError] = useState<string | null>(null)
  const [waitFormOpen, setWaitFormOpen] = useState(false)
  const [waitMode, setWaitMode] = useState<'pid' | 'seconds' | 'session'>('seconds')
  const [waitValue, setWaitValue] = useState('600')
  const [waitReason, setWaitReason] = useState('')
  const [waitError, setWaitError] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

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
    setEditing(false)
    setFormError(null)
  }, [runtimeSessionId])

  const act = useCallback(
    async (action: SessionControlAction, args?: SessionControlActionArgs): Promise<boolean> => {
      if (!runtimeSessionId || busy) {
        return false
      }

      setBusy(true)
      setFeedback({})

      try {
        const dispatch = await runSessionControlAction(runtimeSessionId, action, args)

        if (dispatch.type === 'send') {
          if (!dispatch.message) {
            setFeedback({ error: labels.goalContinuationFailed })

            return false
          }

          const queued = queueKickoffIfSessionBusy({
            displayText: dispatch.display ?? undefined,
            sessionId: runtimeSessionId,
            storedSessionId,
            text: dispatch.message
          })

          if (queued === 'busy') {
            setFeedback({ error: labels.goalContinuationFailed })

            return false
          }

          if (queued === 'idle' && storedSessionId) {
            const sent = requestComposerPromptSend(storedSessionId, dispatch.message, dispatch.display ?? undefined)

            if (!sent) {
              setFeedback({ error: labels.goalContinuationFailed })

              return false
            }
          }
        }

        setFeedback({ success: labels.goalActionDone })

        return true
      } catch (error) {
        setFeedback({ error: error instanceof Error ? error.message : labels.goalActionFailed })

        return false
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

  const startEditing = useCallback(() => {
    setDraft(draftFromGoal(goal))
    setFormError(null)
    setFeedback({})
    setEditing(true)
  }, [goal])

  const saveGoal = useCallback(async () => {
    const title = draft.title.trim()

    if (!title) {
      setFormError(labels.goalFormObjectiveRequired)

      return
    }

    const existing = goal !== null && phaseOf(goal) !== 'complete'

    if (existing) {
      const ok = await confirm({
        confirmLabel: labels.goalConfirmRewrite,
        description: labels.goalConfirmRewriteBody,
        title: labels.goalConfirmRewriteTitle
      })

      if (!ok) {
        return
      }
    } else if (goal) {
      const ok = await confirm({
        confirmLabel: labels.goalConfirmNew,
        description: labels.goalConfirmNewBody,
        title: labels.goalConfirmNewTitle
      })

      if (!ok) {
        return
      }
    }

    const contract = contractFromDraft(draft)
    const args = {
      ...(Object.keys(contract).length ? { contract } : {}),
      ...(goal ? { revision: goal.revision } : {}),
      text: title
    }
    const saved = await act(existing ? 'goal.edit' : 'goal.set', args)

    if (saved) {
      setEditing(false)
      setDraft(BLANK_DRAFT)
    }
  }, [act, draft, goal, labels])

  const addGate = useCallback(async () => {
    const command = gateCommand.trim()

    if (!command) {
      setGateError(labels.goalGateCommandRequired)

      return
    }

    const timeout = gateTimeout.trim() ? Number(gateTimeout) : undefined
    const retries = gateRetries.trim() ? Number(gateRetries) : undefined

    if (timeout !== undefined && (!Number.isInteger(timeout) || timeout < 1 || timeout > 3600)) {
      setGateError(labels.goalGateTimeoutInvalid)

      return
    }

    if (retries !== undefined && (!Number.isInteger(retries) || retries < 0 || retries > 10)) {
      setGateError(labels.goalGateRetriesInvalid)

      return
    }

    const ok = await confirm({
      confirmLabel: labels.goalGateConfirm,
      description: labels.goalGateConfirmBody(command),
      title: labels.goalGateConfirmTitle
    })

    if (!ok) {
      return
    }

    const saved = await act('gate.add', {
      command,
      ...(retries !== undefined ? { max_retries: retries } : {}),
      ...(timeout !== undefined ? { timeout_seconds: timeout } : {})
    })

    if (saved) {
      setGateFormOpen(false)
      setGateCommand('')
      setGateTimeout('')
      setGateRetries('')
      setGateError(null)
    }
  }, [act, gateCommand, gateRetries, gateTimeout, labels])

  const removeGate = useCallback(
    async (gate: SessionControlGate, index: number) => {
      const ok = await confirm({
        confirmLabel: labels.goalGateRemoveConfirm,
        description: labels.goalGateRemoveConfirmBody(gate.command),
        destructive: true,
        title: labels.goalGateRemoveConfirmTitle
      })

      if (ok) {
        await act('gate.remove', { index })
      }
    },
    [act, labels]
  )

  const addWait = useCallback(async () => {
    const raw = waitValue.trim()

    if (!raw) {
      setWaitError(labels.goalWaitValueRequired)

      return
    }

    const reason = waitReason.trim()
    let args: SessionControlActionArgs

    if (waitMode === 'seconds') {
      const seconds = Number(raw)

      if (!Number.isInteger(seconds) || seconds < 1) {
        setWaitError(labels.goalWaitSecondsInvalid)

        return
      }

      args = { reason, seconds }
    } else if (waitMode === 'pid') {
      const pid = Number(raw)

      if (!Number.isInteger(pid) || pid < 1) {
        setWaitError(labels.goalWaitPidInvalid)

        return
      }

      args = { pid, reason }
    } else {
      args = { reason, session_id: raw }
    }

    const saved = await act('wait.set', args)

    if (saved) {
      setWaitFormOpen(false)
      setWaitReason('')
      setWaitError(null)
    }
  }, [act, labels, waitMode, waitReason, waitValue])

  const history = goal?.history ?? []

  const historyLabel = useCallback(
    (event: string): string => {
      const key = `historyEvent_${event}`
      const value = (labels as unknown as Record<string, unknown>)[key]

      return typeof value === 'string' ? value : event.replaceAll('_', ' ')
    },
    [labels]
  )

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
          {editing ? (
            <GoalForm
              busy={pending}
              draft={draft}
              error={formError ?? feedback.error ?? null}
              labels={labels}
              onCancel={() => {
                setEditing(false)
                setFormError(null)
                setFeedback({})
              }}
              onChange={setDraft}
              onSave={() => void saveGoal()}
            />
          ) : !goal ? (
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 flex-1 text-xs leading-relaxed text-(--linear-text-quaternary)">
                {labels.goalEmpty}
              </p>
              <ActionButton disabled={pending} label={labels.goalSetGoal} onClick={startEditing}>
                <Codicon name="add" size="0.75rem" />
              </ActionButton>
            </div>
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
              <GatesSection
                gateCommand={gateCommand}
                gateError={gateError}
                gateFormOpen={gateFormOpen}
                gateRetries={gateRetries}
                gates={goal.gates}
                gateTimeout={gateTimeout}
                labels={labels}
                onCommandChange={setGateCommand}
                onRemove={gate => void removeGate(gate.gate, gate.index)}
                onRetriesChange={setGateRetries}
                onSubmit={() => void addGate()}
                onTimeoutChange={setGateTimeout}
                onToggleForm={() => {
                  setGateFormOpen(open => !open)
                  setGateError(null)
                }}
                pending={pending}
              />
              {waitFormOpen && (
                <WaitForm
                  error={waitError}
                  labels={labels}
                  mode={waitMode}
                  onCancel={() => {
                    setWaitFormOpen(false)
                    setWaitError(null)
                  }}
                  onModeChange={mode => {
                    setWaitMode(mode)
                    setWaitValue(mode === 'seconds' ? '600' : '')
                  }}
                  onReasonChange={setWaitReason}
                  onSubmit={() => void addWait()}
                  onValueChange={setWaitValue}
                  pending={pending}
                  reason={waitReason}
                  value={waitValue}
                />
              )}
              {history.length > 0 && (
                <div className="flex min-w-0 flex-col gap-1">
                  <button
                    aria-expanded={historyOpen}
                    className="flex items-center gap-1 self-start text-[0.6875rem] font-medium text-(--linear-text-tertiary) hover:text-(--linear-text-primary)"
                    onClick={() => setHistoryOpen(open => !open)}
                    type="button"
                  >
                    <Codicon name={historyOpen ? 'chevron-down' : 'chevron-right'} size="0.75rem" />
                    {labels.historyTitle(history.length)}
                  </button>
                  {historyOpen && (
                    <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
                      {history.slice(-12).reverse().map((entry, index) => {
                        const time = new Date(entry.at * 1000).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit'
                        })

                        return (
                          <li className="flex min-w-0 items-baseline gap-1 text-[0.625rem]" key={`${entry.at}-${index}`}>
                            <span className="shrink-0 tabular-nums text-(--linear-text-quaternary)">{time}</span>
                            <span className="shrink-0 text-(--linear-text-tertiary)">{historyLabel(entry.event)}</span>
                            {entry.round !== undefined && (
                              <span className="shrink-0 text-(--linear-text-quaternary)">
                                · {labels.historyRound(entry.round)}
                              </span>
                            )}
                            {entry.tokens !== undefined && (
                              <span className="shrink-0 text-(--linear-text-quaternary)">
                                · {labels.historyTokens(entry.tokens)}
                              </span>
                            )}
                            {entry.reason && (
                              <span className="min-w-0 truncate text-(--linear-text-quaternary)">— {entry.reason}</span>
                            )}
                            {entry.command && (
                              <code className="min-w-0 truncate text-(--linear-text-quaternary)">$ {entry.command}</code>
                            )}
                            {entry.exit_code !== undefined && (
                              <span className="shrink-0 text-(--linear-text-quaternary)">exit {entry.exit_code}</span>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-1">
                <ActionButton disabled={pending} label={labels.goalEdit} onClick={startEditing}>
                  <Codicon name="edit" size="0.75rem" />
                </ActionButton>
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
                {phase === 'active' && !waitBarrier && (
                  <ActionButton disabled={pending} label={labels.goalWaitAdd} onClick={() => setWaitFormOpen(true)}>
                    <Codicon name="clock" size="0.75rem" />
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

interface GatesSectionProps {
  gateCommand: string
  gateError: string | null
  gateFormOpen: boolean
  gateRetries: string
  gateTimeout: string
  gates: SessionControlGate[]
  labels: GoalFormProps['labels']
  onCommandChange: (value: string) => void
  onRemove: (gate: { gate: SessionControlGate; index: number }) => void
  onRetriesChange: (value: string) => void
  onSubmit: () => void
  onTimeoutChange: (value: string) => void
  onToggleForm: () => void
  pending: boolean
}

function GatesSection({
  gateCommand,
  gateError,
  gateFormOpen,
  gateRetries,
  gateTimeout,
  gates,
  labels,
  onCommandChange,
  onRemove,
  onRetriesChange,
  onSubmit,
  onTimeoutChange,
  onToggleForm,
  pending
}: GatesSectionProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.6875rem] font-medium text-(--linear-text-tertiary)">{labels.goalGatesTitle}</span>
        <button
          className="text-[0.6875rem] font-medium text-(--linear-text-tertiary) hover:text-(--linear-text-primary)"
          onClick={onToggleForm}
          type="button"
        >
          {labels.goalGateAdd}
        </button>
      </div>
      {gates.length === 0 ? (
        <p className="text-[0.6875rem] text-(--linear-text-quaternary)">{labels.goalGatesEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {gates.map((gate, index) => (
            <li className="group/gate flex items-start gap-1.5" key={`${index}-${gate.command}`}>
              <span
                aria-hidden="true"
                className={cn(
                  'mt-1 inline-block size-1.5 shrink-0 rounded-full',
                  gate.last_exit_code === null
                    ? 'bg-(--linear-text-quaternary)'
                    : gate.last_exit_code === 0
                      ? 'bg-(--linear-green)'
                      : 'bg-(--linear-red)'
                )}
              />
              <div className="min-w-0 flex-1">
                <code className="block break-all text-[0.6875rem] text-(--linear-text-secondary)">
                  $ {gate.command}
                </code>
                <span className="block text-[0.625rem] text-(--linear-text-quaternary)">
                  {labels.goalGateMeta(gate.attempts, gate.max_retries, gate.timeout_seconds)}
                  {gate.last_exit_code !== null ? ` · exit ${gate.last_exit_code}` : ''}
                </span>
              </div>
              <Tip label={labels.goalGateRemove}>
                <button
                  aria-label={labels.goalGateRemove}
                  className="shrink-0 text-(--linear-text-quaternary) opacity-0 transition-opacity hover:text-(--linear-red) focus-visible:opacity-100 group-hover/gate:opacity-100"
                  onClick={() => onRemove({ gate, index: index + 1 })}
                  type="button"
                >
                  <Codicon name="close" size="0.75rem" />
                </button>
              </Tip>
            </li>
          ))}
        </ul>
      )}
      {gateFormOpen && (
        <form
          className="flex flex-col gap-1.5 rounded-md border-[0.5px] border-(--linear-border-panel) p-2"
          onSubmit={event => {
            event.preventDefault()
            onSubmit()
          }}
        >
          <input
            aria-label={labels.goalGateCommand}
            autoFocus
            className="h-7 w-full rounded-md border-[0.5px] border-(--linear-border-panel) bg-(--linear-bg-panel) px-2 font-mono text-[0.6875rem] text-(--linear-text-primary) outline-none focus:border-(--linear-border-secondary)"
            onChange={event => onCommandChange(event.target.value)}
            placeholder={labels.goalGateCommandPlaceholder}
            value={gateCommand}
          />
          <div className="flex items-center gap-1.5">
            <input
              aria-label={labels.goalGateTimeout}
              className="h-6 w-16 rounded-md border-[0.5px] border-(--linear-border-panel) bg-(--linear-bg-panel) px-2 text-[0.6875rem] text-(--linear-text-primary) outline-none focus:border-(--linear-border-secondary)"
              onChange={event => onTimeoutChange(event.target.value)}
              placeholder={labels.goalGateTimeoutPlaceholder}
              value={gateTimeout}
            />
            <input
              aria-label={labels.goalGateRetries}
              className="h-6 w-16 rounded-md border-[0.5px] border-(--linear-border-panel) bg-(--linear-bg-panel) px-2 text-[0.6875rem] text-(--linear-text-primary) outline-none focus:border-(--linear-border-secondary)"
              onChange={event => onRetriesChange(event.target.value)}
              placeholder={labels.goalGateRetriesPlaceholder}
              value={gateRetries}
            />
            <button
              className="ml-auto text-[0.6875rem] font-medium text-(--linear-text-secondary) disabled:opacity-50"
              disabled={pending}
              type="submit"
            >
              {labels.goalGateAddSave}
            </button>
          </div>
          {gateError && <p className="text-[0.6875rem] text-(--linear-red)">{gateError}</p>}
        </form>
      )}
    </div>
  )
}

interface WaitFormProps {
  error: string | null
  labels: GoalFormProps['labels']
  mode: 'pid' | 'seconds' | 'session'
  onCancel: () => void
  onModeChange: (mode: 'pid' | 'seconds' | 'session') => void
  onReasonChange: (value: string) => void
  onSubmit: () => void
  onValueChange: (value: string) => void
  pending: boolean
  reason: string
  value: string
}

function WaitForm({
  error,
  labels,
  mode,
  onCancel,
  onModeChange,
  onReasonChange,
  onSubmit,
  onValueChange,
  pending,
  reason,
  value
}: WaitFormProps) {
  return (
    <form
      className="flex flex-col gap-1.5 rounded-md border-[0.5px] border-(--linear-border-panel) p-2"
      onSubmit={event => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <div className="flex items-center gap-1.5">
        <select
          aria-label={labels.goalWaitMode}
          className="h-6 rounded-md border-[0.5px] border-(--linear-border-panel) bg-(--linear-bg-panel) px-1 text-[0.6875rem] text-(--linear-text-primary)"
          onChange={event => onModeChange(event.target.value as 'pid' | 'seconds' | 'session')}
          value={mode}
        >
          <option value="seconds">{labels.goalWaitModeSeconds}</option>
          <option value="pid">{labels.goalWaitModePid}</option>
          <option value="session">{labels.goalWaitModeSession}</option>
        </select>
        <input
          aria-label={labels.goalWaitValue}
          className="h-6 min-w-0 flex-1 rounded-md border-[0.5px] border-(--linear-border-panel) bg-(--linear-bg-panel) px-2 text-[0.6875rem] text-(--linear-text-primary) outline-none focus:border-(--linear-border-secondary)"
          onChange={event => onValueChange(event.target.value)}
          placeholder={labels.goalWaitValue}
          value={value}
        />
      </div>
      <input
        aria-label={labels.goalWaitReason}
        className="h-6 w-full rounded-md border-[0.5px] border-(--linear-border-panel) bg-(--linear-bg-panel) px-2 text-[0.6875rem] text-(--linear-text-primary) outline-none focus:border-(--linear-border-secondary)"
        onChange={event => onReasonChange(event.target.value)}
        placeholder={labels.goalWaitReasonPlaceholder}
        value={reason}
      />
      {error && <p className="text-[0.6875rem] text-(--linear-red)">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          className="h-6 rounded-md bg-(--linear-accent) px-2 text-[0.6875rem] font-medium text-(--linear-on-accent) disabled:opacity-50"
          disabled={pending}
          type="submit"
        >
          {labels.goalWaitSave}
        </button>
        <button
          className="h-6 rounded-md px-1.5 text-[0.6875rem] font-medium text-(--linear-text-tertiary) hover:text-(--linear-text-primary)"
          onClick={onCancel}
          type="button"
        >
          {labels.goalWaitCancel}
        </button>
      </div>
    </form>
  )
}

interface GoalFormProps {
  busy: boolean
  draft: GoalDraft
  error: string | null
  labels: ReturnType<typeof useI18n>['t']['rightSidebar']
  onCancel: () => void
  onChange: (draft: GoalDraft) => void
  onSave: () => void
}

const CONTRACT_FORM_FIELDS: { key: keyof GoalDraft; label: keyof GoalFormProps['labels'] }[] = [
  { key: 'outcome', label: 'goalFormOutcome' },
  { key: 'verification', label: 'goalFormVerification' },
  { key: 'constraints', label: 'goalFormConstraints' },
  { key: 'boundaries', label: 'goalFormBoundaries' },
  { key: 'stopWhen', label: 'goalFormStopWhen' }
]

function GoalForm({ busy, draft, error, labels, onCancel, onChange, onSave }: GoalFormProps) {
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={event => {
        event.preventDefault()
        onSave()
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-[0.6875rem] font-medium text-(--linear-text-tertiary)">{labels.goalFormObjective}</span>
        <textarea
          aria-label={labels.goalFormObjective}
          className="min-h-20 w-full resize-y rounded-md border-[0.5px] border-(--linear-border-panel) bg-(--linear-bg-panel) px-2 py-1.5 text-xs leading-relaxed text-(--linear-text-primary) outline-none placeholder:text-(--linear-text-quaternary) focus:border-(--linear-border-secondary)"
          onChange={event => onChange({ ...draft, title: event.target.value })}
          placeholder={labels.goalFormObjectivePlaceholder}
          value={draft.title}
        />
      </label>
      <div className="flex flex-col gap-1.5">
        <span className="text-[0.6875rem] font-medium text-(--linear-text-tertiary)">{labels.goalFormContractTitle}</span>
        {CONTRACT_FORM_FIELDS.map(field => (
          <label className="flex flex-col gap-0.5" key={field.key}>
            <span className="text-[0.625rem] text-(--linear-text-quaternary)">{labels[field.label] as string}</span>
            <input
              aria-label={labels[field.label] as string}
              className="h-6 w-full rounded-md border-[0.5px] border-(--linear-border-panel) bg-(--linear-bg-panel) px-2 text-[0.6875rem] text-(--linear-text-primary) outline-none placeholder:text-(--linear-text-quaternary) focus:border-(--linear-border-secondary)"
              onChange={event => onChange({ ...draft, [field.key]: event.target.value })}
              value={draft[field.key]}
            />
          </label>
        ))}
      </div>
      {error && (
        <p className="text-[0.6875rem] leading-relaxed text-(--linear-red)" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          className="h-6 rounded-md bg-(--linear-accent) px-2 text-[0.6875rem] font-medium text-(--linear-on-accent) disabled:opacity-50"
          disabled={busy}
          type="submit"
        >
          {labels.goalFormSave}
        </button>
        <button
          className="h-6 rounded-md px-1.5 text-[0.6875rem] font-medium text-(--linear-text-tertiary) hover:text-(--linear-text-primary)"
          disabled={busy}
          onClick={onCancel}
          type="button"
        >
          {labels.goalFormCancel}
        </button>
      </div>
    </form>
  )
}

/** The Goal card of the Automations panel: state, objective, progress, wait and the
 * controls the backend already exposes (pause/resume/clear/unwait/criteria). */
