import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { ProfileScope } from '@/api/client'
import {
  approvePendingMemoryWrite,
  editPendingMemoryWrite,
  getPendingMemoryWrites,
  type PendingMemoryWrite,
  rejectPendingMemoryWrite
} from '@/api/memory'
import { $rightSidebarSectionRequest } from '@/app/right-sidebar/store'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import {
  $connection,
  $cronSessions,
  $messagingSessions,
  $selectedStoredSessionId,
  $sessions,
  knownSessionOwner
} from '@/store/session'
import { profileScopeForSessionOwner } from '@/store/session-request-router'

interface MemoryOperationView {
  action: string
  oldText?: string
  proposedText?: string
}

interface MemorySectionLabels {
  pendingMemoryOldText?: string
  pendingMemoryProposed?: string
  pendingMemoryRequestFailed?: string
}

function textField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function operationView(operation: Record<string, unknown>): MemoryOperationView {
  const action = typeof operation.action === 'string' ? operation.action : 'memory'
  const matchedEntry = textField(operation.matched_entry)
  const oldText = textField(operation.old_text) ?? (action === 'remove' ? matchedEntry : undefined)
  const proposedText = action === 'remove' ? undefined : textField(operation.content) ?? textField(operation.new_text)

  return { action, oldText, proposedText }
}

function operationViews(record: PendingMemoryWrite): MemoryOperationView[] {
  const payload = record.payload

  if (payload.action === 'batch' && Array.isArray(payload.operations)) {
    return payload.operations
      .filter((operation): operation is Record<string, unknown> => Boolean(operation) && typeof operation === 'object' && !Array.isArray(operation))
      .map(operationView)
  }

  return [operationView(payload)]
}

function proposedText(record: PendingMemoryWrite): string {
  const operation = operationViews(record).find(item => item.proposedText)

  return operation?.proposedText ?? record.summary
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  if (typeof error === 'string' && error.trim()) {
    return error
  }

  return fallback
}

function PendingMemoryRow({ labels, onChanged, record, scope }: { labels: ReturnType<typeof useI18n>['t']['rightSidebar']; onChanged: () => void; record: PendingMemoryWrite; scope?: ProfileScope }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(() => proposedText(record))
  const [draft, setDraft] = useState(() => proposedText(record))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const extraLabels = labels as typeof labels & MemorySectionLabels
  const operations = operationViews(record)
  const editable = record.payload.action !== 'remove' && record.payload.action !== 'batch'

  const run = async (action: () => Promise<unknown>, after?: () => void) => {
    setPending(true)
    setError(null)

    try {
      await action()
      after?.()
      onChanged()
    } catch (cause) {
      setError(errorMessage(cause, extraLabels.pendingMemoryRequestFailed ?? 'Memory request failed'))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="border-t border-(--linear-border-panel) px-2.5 py-2 first:border-t-0">
      {editing ? (
        <textarea
          aria-label={labels.pendingMemoryTextAria}
          className="min-h-16 w-full resize-y rounded-md border border-(--linear-border-tertiary) bg-(--linear-bg-panel) px-2 py-1 text-xs leading-relaxed text-(--linear-text-primary) outline-none focus:border-(--linear-focus)"
          onChange={event => setDraft(event.target.value)}
          value={draft}
        />
      ) : (
        <div className="space-y-1.5 text-xs leading-relaxed">
          {operations.map((operation, index) => (
            <div className="space-y-0.5" key={`${record.id}-${index}`}>
              {operation.oldText && (
                <p className="whitespace-pre-wrap break-words text-(--linear-text-tertiary)">
                  <span className="mr-1 font-medium">{extraLabels.pendingMemoryOldText ?? 'Old'}</span>
                  {operation.oldText}
                </p>
              )}
              {operation.proposedText && (
                <p className="whitespace-pre-wrap break-words text-(--linear-text-secondary)">
                  <span className="mr-1 font-medium">{extraLabels.pendingMemoryProposed ?? 'Proposed'}</span>
                  {operation.proposedText}
                </p>
              )}
            </div>
          ))}
          {!operations.some(operation => operation.oldText || operation.proposedText) && (
            <p className="whitespace-pre-wrap break-words text-(--linear-text-secondary)">{value}</p>
          )}
        </div>
      )}
      {error && <p className="mt-1.5 text-xs text-(--linear-red)" role="alert">{error}</p>}
      <div className="mt-1.5 flex items-center justify-end gap-1">
        {editing ? (
          <>
            <Button
              onClick={() => {
                setDraft(value)
                setEditing(false)
              }}
              size="micro"
              type="button"
              variant="text"
            >
              {labels.pendingMemoryCancel}
            </Button>
            <Button
              disabled={pending}
              onClick={() => void run(
                () => editPendingMemoryWrite(record.id, draft, scope),
                () => {
                  setValue(draft)
                  setEditing(false)
                }
              )}
              size="micro"
              type="button"
              variant="text"
            >
              {labels.pendingMemorySave}
            </Button>
          </>
        ) : (
          editable && (
            <Button
              onClick={() => {
                setDraft(value)
                setError(null)
                setEditing(true)
              }}
              size="micro"
              type="button"
              variant="text"
            >
              {labels.pendingMemoryEdit}
            </Button>
          )
        )}
        <Button disabled={pending} onClick={() => void run(() => rejectPendingMemoryWrite(record.id, scope))} size="micro" type="button" variant="text">
          {labels.pendingMemoryReject}
        </Button>
        <Button disabled={pending} onClick={() => void run(() => approvePendingMemoryWrite(record.id, scope))} size="micro" type="button" variant="text">
          {labels.pendingMemoryApprove}
        </Button>
      </div>
    </div>
  )
}

/** Pending memory writes stay available in the right rail until a decision.
 * The query is lazy so opening an empty rail does not add a boot request. */
export function MemorySection() {
  const { t } = useI18n()
  const labels = t.rightSidebar
  const [open, setOpen] = useState(false)
  const sectionRequest = useStore($rightSidebarSectionRequest)
  const selectedSession = useStore($selectedStoredSessionId)
  const sessions = useStore($sessions)
  const cronSessions = useStore($cronSessions)
  const messagingSessions = useStore($messagingSessions)
  const connection = useStore($connection)
  const owner = knownSessionOwner([...sessions, ...cronSessions, ...messagingSessions], selectedSession)
  const ownerScope = profileScopeForSessionOwner(owner)
  const hasOwnerScope = Boolean(ownerScope)
  const ownerConnectionId = ownerScope && typeof ownerScope === 'object' ? ownerScope.connectionId ?? null : null
  const ownerProfile = ownerScope && typeof ownerScope === 'object' ? ownerScope.profile ?? null : ownerScope ?? null
  const connectionId = connection?.connectionId
  const connectionProfile = connection?.profile

  const requestScope = useMemo<ProfileScope>(() => {
    if (hasOwnerScope) {
      return {
        connectionId: ownerConnectionId ?? connectionId,
        profile: ownerProfile
      }
    }

    return connectionId || connectionProfile
      ? { connectionId, profile: connectionProfile }
      : undefined
  }, [connectionId, connectionProfile, hasOwnerScope, ownerConnectionId, ownerProfile])

  const requestScopeKey = JSON.stringify(requestScope ?? null)
  const [entries, setEntries] = useState<PendingMemoryWrite[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    if (typeof window.hermesDesktop?.api !== 'function') {
      setEntries([])
      setError(null)

      return
    }

    setLoading(true)
    setError(null)
    void getPendingMemoryWrites(requestScope)
      .then(response => setEntries(response.pending))
      .catch(cause => setError(errorMessage(cause, 'Memory requests could not be loaded')))
      .finally(() => setLoading(false))
  }, [requestScope])

  useEffect(() => {
    if (open) {
      refresh()
    }
  }, [open, refresh, selectedSession])

  useEffect(() => {
    if (sectionRequest?.section !== 'memory') {
      return
    }

    setOpen(true)
    $rightSidebarSectionRequest.set(null)
  }, [sectionRequest])

  return (
    <section className="shrink-0 border-b border-(--linear-border-panel)" data-slot="pending-memory-section">
      <div className="group/project-header flex h-7 shrink-0 items-center px-2.5">
        <button
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-medium text-(--linear-text-secondary) hover:text-(--linear-text-primary)"
          onClick={() => setOpen(current => !current)}
          type="button"
        >
          <span aria-hidden className={open ? 'rotate-90 text-[0.65rem]' : 'text-[0.65rem]'}>
            ›
          </span>
          <span>{labels.pendingMemoryTitle}</span>
          {entries.length > 0 && <span className="text-[0.6875rem] text-(--linear-text-tertiary)">{entries.length}</span>}
        </button>
      </div>
      {open && (
        <div className="max-h-64 overflow-y-auto">
          {loading ? (
            <p className="px-2.5 pb-2 text-xs text-(--linear-text-quaternary)">{labels.pendingMemoryLoading}</p>
          ) : error ? (
            <p className="px-2.5 pb-2 text-xs text-(--linear-red)" role="alert">{error}</p>
          ) : entries.length === 0 ? (
            <p className="px-2.5 pb-2 text-xs text-(--linear-text-quaternary)">{labels.pendingMemoryEmpty}</p>
          ) : (
            entries.map(record => (
              <PendingMemoryRow key={record.id} labels={labels} onChanged={refresh} record={record} scope={requestScope} />
            ))
          )}
        </div>
      )}
    </section>
  )
}
