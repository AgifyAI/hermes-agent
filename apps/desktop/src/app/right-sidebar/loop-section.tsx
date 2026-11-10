import { useStore } from '@nanostores/react'
import { useCallback, useState } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { Pause, Play, Trash2 } from '@/lib/icons'
import { confirm } from '@/store/confirm'
import { $activeSessionId } from '@/store/session'
import {
  refreshSessionControl,
  runSessionControlAction,
  type SessionControlAction,
  type SessionControlActionArgs
} from '@/store/session-control'

import { formatCountdown, useCountdownClock } from './automations-countdown'
import { ActionButton, SidebarCardShell } from './card-parts'
import { useAutomationControl } from './use-automation-control'

function formatInterval(seconds: number, t: ReturnType<typeof useI18n>['t']): string {
  const ctrl = t.statusStack.control
  const minutes = Math.round(seconds / 60)

  if (seconds >= 3600 && seconds % 3600 === 0) {
    return ctrl.loopEveryHours(seconds / 3600)
  }

  if (seconds >= 60) {
    return ctrl.loopEveryMinutes(minutes)
  }

  return ctrl.loopEverySeconds(seconds)
}

// health: allow CC -- one card owns this automation's status, countdown, inline form and confirmations; splitting it would duplicate its state machine and its action wiring
export function LoopSection() {
  const { t } = useI18n()
  const labels = t.rightSidebar
  const ctrl = t.statusStack.control
  const runtimeSessionId = useStore($activeSessionId)
  const { entry } = useAutomationControl(runtimeSessionId)
  const loop = entry?.snapshot?.loop ?? null
  const pending = Boolean(entry?.pendingAction)

  const [editing, setEditing] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [minutes, setMinutes] = useState('')
  const [runs, setRuns] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ error?: string; success?: string }>({})

  const startEditing = useCallback(() => {
    setPrompt(loop?.prompt ?? '')
    setMinutes(loop?.interval_seconds ? String(Math.round(loop.interval_seconds / 60)) : '')
    setRuns(loop?.times ? String(loop.times) : '')
    setError(null)
    setFeedback({})
    setEditing(true)
  }, [loop])

  const act = useCallback(
    async (action: SessionControlAction, args?: SessionControlActionArgs): Promise<boolean> => {
      if (!runtimeSessionId) {
        setFeedback({ error: labels.goalActionFailed })

        return false
      }

      setFeedback({})

      try {
        const dispatch = await runSessionControlAction(runtimeSessionId, action, args)
        setFeedback({ success: dispatch.display ?? ctrl.actionSucceeded })
        void refreshSessionControl(runtimeSessionId)

        return true
      } catch (err) {
        setFeedback({ error: err instanceof Error ? err.message : ctrl.actionFailed(String(err)) })

        return false
      }
    },
    [ctrl, labels.goalActionFailed, runtimeSessionId]
  )

  const save = useCallback(async () => {
    const text = prompt.trim()

    if (!text) {
      setError(labels.loopPromptRequired)

      return
    }

    const minutesValue = minutes.trim()
    const runsValue = runs.trim()
    const intervalSeconds = minutesValue ? Number(minutesValue) * 60 : undefined
    const times = runsValue ? Number(runsValue) : 0

    if (minutesValue && (!Number.isInteger(Number(minutesValue)) || Number(minutesValue) < 1)) {
      setError(labels.loopIntervalInvalid)

      return
    }

    if (runsValue && (!Number.isInteger(times) || times < 1)) {
      setError(labels.loopTimesInvalid)

      return
    }

    const saved = await act('loop.set', {
      prompt: text,
      ...(intervalSeconds !== undefined ? { interval_seconds: intervalSeconds } : {}),
      ...(times ? { times } : {})
    })

    if (saved) {
      setEditing(false)
      setError(null)
    }
  }, [act, labels, minutes, prompt, runs])

  const stopLoop = useCallback(async () => {
    const ok = await confirm({
      confirmLabel: ctrl.stopLoop,
      description: ctrl.stopLoopConfirmBody,
      destructive: true,
      title: ctrl.stopLoopConfirmTitle
    })

    if (ok) {
      await act('loop.stop')
    }
  }, [act, ctrl])

  const counting = Boolean(loop && loop.status === 'active' && !loop.deferred_by_goal && !loop.awaiting_response)
  const now = useCountdownClock(counting)
  const stateLabel = !loop
    ? labels.loopEmpty
    : loop.deferred_by_goal
      ? ctrl.loopDeferred
      : loop.status === 'paused'
        ? ctrl.loopPaused
        : loop.status === 'done'
          ? ctrl.loopFinished
          : ctrl.loopActive
  const nextLabel =
    loop && counting && loop.next_due_at > 0
      ? loop.next_due_at * 1000 <= now
        ? ctrl.dueWaitingForIdle
        : ctrl.loopNext(formatCountdown(loop.next_due_at, now))
      : null
  const dot = !loop
    ? 'bg-(--linear-text-quaternary)'
    : loop.deferred_by_goal
      ? 'bg-(--linear-yellow)'
      : loop.status === 'paused' || loop.status === 'done'
        ? 'bg-(--linear-yellow)'
        : 'bg-(--linear-green)'

  return (
    <SidebarCardShell dot={dot} label={labels.loopTitle} slot="loop-section" stateLabel={loop ? stateLabel : undefined} title={labels.loopTitle}>
      {editing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={event => {
            event.preventDefault()
            void save()
          }}
        >
          <textarea
            aria-label={labels.loopPromptField}
            className="min-h-16 w-full resize-y rounded-md border-[0.5px] border-(--linear-border-panel) bg-(--linear-bg-panel) px-2 py-1.5 text-xs leading-relaxed text-(--linear-text-primary) outline-none placeholder:text-(--linear-text-quaternary) focus:border-(--linear-border-secondary)"
            onChange={event => setPrompt(event.target.value)}
            placeholder={labels.loopPromptPlaceholder}
            value={prompt}
          />
          <div className="flex items-center gap-1.5">
            <label className="flex min-w-0 flex-1 items-center gap-1 text-[0.6875rem] text-(--linear-text-tertiary)">
              {labels.loopIntervalField}
              <input
                aria-label={labels.loopIntervalField}
                className="h-6 w-14 rounded-md border-[0.5px] border-(--linear-border-panel) bg-(--linear-bg-panel) px-2 text-[0.6875rem] text-(--linear-text-primary) outline-none focus:border-(--linear-border-secondary)"
                onChange={event => setMinutes(event.target.value)}
                placeholder={labels.loopIntervalPlaceholder}
                value={minutes}
              />
            </label>
            <label className="flex min-w-0 flex-1 items-center gap-1 text-[0.6875rem] text-(--linear-text-tertiary)">
              {labels.loopTimesField}
              <input
                aria-label={labels.loopTimesField}
                className="h-6 w-12 rounded-md border-[0.5px] border-(--linear-border-panel) bg-(--linear-bg-panel) px-2 text-[0.6875rem] text-(--linear-text-primary) outline-none focus:border-(--linear-border-secondary)"
                onChange={event => setRuns(event.target.value)}
                placeholder={labels.loopTimesPlaceholder}
                value={runs}
              />
            </label>
          </div>
          {error && <p className="text-[0.6875rem] leading-relaxed text-(--linear-red)">{error}</p>}
          <div className="flex items-center gap-2">
            <button
              className="h-6 rounded-md bg-(--linear-accent) px-2 text-[0.6875rem] font-medium text-(--linear-on-accent) disabled:opacity-50"
              disabled={pending}
              type="submit"
            >
              {labels.loopSave}
            </button>
            <button
              className="h-6 rounded-md px-1.5 text-[0.6875rem] font-medium text-(--linear-text-tertiary) hover:text-(--linear-text-primary)"
              onClick={() => {
                setEditing(false)
                setError(null)
              }}
              type="button"
            >
              {labels.loopCancel}
            </button>
          </div>
        </form>
      ) : !loop ? (
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-(--linear-text-quaternary)">{labels.loopEmpty}</p>
          <ActionButton disabled={pending} label={labels.loopStart} onClick={startEditing}>
            <Codicon name="add" size="0.75rem" />
          </ActionButton>
        </div>
      ) : (
        <>
          <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-(--linear-text-secondary)">{loop.prompt}</p>
          <div className="flex flex-wrap items-center gap-2 text-[0.6875rem] text-(--linear-text-tertiary)">
            <span>{loop.mode === 'self_paced' ? ctrl.loopSelfPaced : formatInterval(loop.interval_seconds, t)}</span>
            <span className="text-(--linear-text-quaternary)">
              {loop.times > 0 ? ctrl.loopRunCount(loop.ticks_fired, loop.times) : ctrl.loopRuns(loop.ticks_fired)}
            </span>
            {nextLabel && <span className="text-(--linear-text-quaternary)">{nextLabel}</span>}
          </div>
          {loop.deferred_by_goal && <p className="text-[0.6875rem] text-(--linear-yellow)">{ctrl.loopDeferredNotice}</p>}
          {loop.last_stop_reason && loop.status === 'done' && (
            <p className="text-[0.6875rem] text-(--linear-text-quaternary)">{loop.last_stop_reason}</p>
          )}
          <div className="flex flex-wrap items-center gap-1">
            <ActionButton disabled={pending} label={labels.loopEdit} onClick={startEditing}>
              <Codicon name="edit" size="0.75rem" />
            </ActionButton>
            {loop.status === 'active' ? (
              <ActionButton disabled={pending} label={ctrl.pauseLoop} onClick={() => void act('loop.pause')}>
                <Pause className="size-3" />
              </ActionButton>
            ) : (
              <ActionButton disabled={pending} label={ctrl.resumeLoop} onClick={() => void act('loop.resume')}>
                <Play className="size-3" />
              </ActionButton>
            )}
            <ActionButton destructive disabled={pending} label={labels.loopStopAction} onClick={() => void stopLoop()}>
              <Trash2 className="size-3" />
            </ActionButton>
          </div>
        </>
      )}
      {feedback.error && (
        <p className="text-[0.6875rem] leading-relaxed text-(--linear-red)" role="alert">
          {feedback.error}
        </p>
      )}
      {feedback.success && !feedback.error && <span className="sr-only">{feedback.success}</span>}
    </SidebarCardShell>
  )
}
