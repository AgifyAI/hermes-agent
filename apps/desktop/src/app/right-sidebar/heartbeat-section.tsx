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

// health: allow CC -- one card owns this automation's status, countdown, inline form and confirmations; splitting it would duplicate its state machine and its action wiring
export function HeartbeatSection() {
  const { t } = useI18n()
  const labels = t.rightSidebar
  const ctrl = t.statusStack.control
  const runtimeSessionId = useStore($activeSessionId)
  const { entry } = useAutomationControl(runtimeSessionId)
  const heartbeat = entry?.snapshot?.heartbeat ?? null
  const pending = Boolean(entry?.pendingAction)

  const [editing, setEditing] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [minutes, setMinutes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ error?: string; success?: string }>({})

  const act = useCallback(
    async (action: SessionControlAction, args?: SessionControlActionArgs): Promise<boolean> => {
      if (!runtimeSessionId) {
        setFeedback({ error: labels.goalActionFailed })

        return false
      }

      setFeedback({})

      try {
        await runSessionControlAction(runtimeSessionId, action, args)
        setFeedback({ success: ctrl.actionSucceeded })
        void refreshSessionControl(runtimeSessionId)

        return true
      } catch (err) {
        setFeedback({ error: err instanceof Error ? err.message : ctrl.actionFailed(String(err)) })

        return false
      }
    },
    [ctrl, labels.goalActionFailed, runtimeSessionId]
  )

  const startEditing = useCallback(() => {
    setPrompt(heartbeat?.prompt ?? '')
    setMinutes(heartbeat?.interval_seconds ? String(Math.round(heartbeat.interval_seconds / 60)) : '')
    setError(null)
    setEditing(true)
  }, [heartbeat])

  const save = useCallback(async () => {
    const text = prompt.trim()

    if (!text) {
      setError(labels.heartbeatPromptRequired)

      return
    }

    const minutesValue = minutes.trim()

    if (!minutesValue || !Number.isInteger(Number(minutesValue)) || Number(minutesValue) < 1) {
      setError(labels.heartbeatIntervalInvalid)

      return
    }

    const saved = await act('heartbeat.set', { interval_seconds: Number(minutesValue) * 60, prompt: text })

    if (saved) {
      setEditing(false)
      setError(null)
    }
  }, [act, labels, minutes, prompt])

  const clearHeartbeat = useCallback(async () => {
    const ok = await confirm({
      confirmLabel: ctrl.clearHeartbeat,
      description: ctrl.clearHeartbeatConfirmBody,
      destructive: true,
      title: ctrl.clearHeartbeatConfirmTitle
    })

    if (ok) {
      await act('heartbeat.clear')
    }
  }, [act, ctrl])

  const seconds = heartbeat?.interval_seconds ?? 0
  const intervalLabel =
    seconds >= 3600 && seconds % 3600 === 0
      ? ctrl.heartbeatEveryHours(seconds / 3600)
      : seconds >= 60
        ? ctrl.heartbeatEveryMinutes(seconds / 60)
        : ctrl.heartbeatEverySeconds(seconds)
  const now = useCountdownClock(heartbeat?.status === 'active')
  const nextDueAt = heartbeat ? (heartbeat.last_fired_at || heartbeat.created_at) + heartbeat.interval_seconds : 0
  const nextDueMs = nextDueAt > 1e11 ? nextDueAt : nextDueAt * 1000
  const isDue = heartbeat?.status === 'active' && nextDueMs <= now
  const stateLabel = !heartbeat
    ? labels.heartbeatEmpty
    : heartbeat.status === 'paused'
      ? ctrl.heartbeatPaused
      : ctrl.heartbeatActive
  const dot = !heartbeat
    ? 'bg-(--linear-text-quaternary)'
    : heartbeat.status === 'paused'
      ? 'bg-(--linear-yellow)'
      : isDue
        ? 'bg-(--linear-yellow)'
        : 'bg-(--linear-green)'

  return (
    <SidebarCardShell dot={dot} label={labels.heartbeatTitle} slot="heartbeat-section" stateLabel={heartbeat ? stateLabel : undefined} title={labels.heartbeatTitle}>
      {editing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={event => {
            event.preventDefault()
            void save()
          }}
        >
          <textarea
            aria-label={labels.heartbeatPromptField}
            className="min-h-16 w-full resize-y rounded-md border-[0.5px] border-(--linear-border-panel) bg-(--linear-bg-panel) px-2 py-1.5 text-xs leading-relaxed text-(--linear-text-primary) outline-none placeholder:text-(--linear-text-quaternary) focus:border-(--linear-border-secondary)"
            onChange={event => setPrompt(event.target.value)}
            placeholder={labels.heartbeatPromptPlaceholder}
            value={prompt}
          />
          <label className="flex items-center gap-1 text-[0.6875rem] text-(--linear-text-tertiary)">
            {labels.heartbeatIntervalField}
            <input
              aria-label={labels.heartbeatIntervalField}
              className="h-6 w-14 rounded-md border-[0.5px] border-(--linear-border-panel) bg-(--linear-bg-panel) px-2 text-[0.6875rem] text-(--linear-text-primary) outline-none focus:border-(--linear-border-secondary)"
              onChange={event => setMinutes(event.target.value)}
              placeholder={labels.heartbeatIntervalPlaceholder}
              value={minutes}
            />
          </label>
          {error && <p className="text-[0.6875rem] leading-relaxed text-(--linear-red)">{error}</p>}
          <div className="flex items-center gap-2">
            <button
              className="h-6 rounded-md bg-(--linear-accent) px-2 text-[0.6875rem] font-medium text-(--linear-on-accent) disabled:opacity-50"
              disabled={pending}
              type="submit"
            >
              {labels.heartbeatSave}
            </button>
            <button
              className="h-6 rounded-md px-1.5 text-[0.6875rem] font-medium text-(--linear-text-tertiary) hover:text-(--linear-text-primary)"
              onClick={() => {
                setEditing(false)
                setError(null)
              }}
              type="button"
            >
              {labels.heartbeatCancel}
            </button>
          </div>
        </form>
      ) : !heartbeat ? (
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-(--linear-text-quaternary)">
            {labels.heartbeatEmpty}
          </p>
          <ActionButton disabled={pending} label={labels.heartbeatStart} onClick={startEditing}>
            <Codicon name="add" size="0.75rem" />
          </ActionButton>
        </div>
      ) : (
        <>
          <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-(--linear-text-secondary)">
            {heartbeat.prompt}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-[0.6875rem] text-(--linear-text-tertiary)">
            <span>{intervalLabel}</span>
            {heartbeat.status === 'active' && (
              <span className="text-(--linear-text-quaternary)">
                {isDue ? ctrl.dueWaitingForIdle : ctrl.heartbeatNext(formatCountdown(nextDueAt, now))}
              </span>
            )}
            <span className="text-(--linear-text-quaternary)">{ctrl.heartbeatFiredCount(heartbeat.fire_count)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <ActionButton disabled={pending} label={labels.heartbeatEdit} onClick={startEditing}>
              <Codicon name="edit" size="0.75rem" />
            </ActionButton>
            {heartbeat.status === 'active' ? (
              <ActionButton disabled={pending} label={ctrl.pauseHeartbeat} onClick={() => void act('heartbeat.pause')}>
                <Pause className="size-3" />
              </ActionButton>
            ) : (
              <ActionButton disabled={pending} label={ctrl.resumeHeartbeat} onClick={() => void act('heartbeat.resume')}>
                <Play className="size-3" />
              </ActionButton>
            )}
            <ActionButton destructive disabled={pending} label={labels.heartbeatClear} onClick={() => void clearHeartbeat()}>
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
