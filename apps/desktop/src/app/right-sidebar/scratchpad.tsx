import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { type ProfileScope } from '@/api/client'
import { getSession, setSessionScratchpadRemote } from '@/api/sessions'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import {
  $connection,
  $cronSessions,
  $messagingSessions,
  $selectedStoredSessionId,
  $sessions,
  applySessionScratchpad,
  knownSessionOwner
} from '@/store/session'
import { profileScopeForSessionOwner } from '@/store/session-request-router'

export interface ScratchpadLabels {
  title?: string
  placeholder?: string
  emptySession?: string
  saving?: string
  error?: string
}

interface SessionScratchpadProps {
  /** Stored session id. A null id means the current view is a new draft. */
  sessionId: null | string
  /** Optional profile owner. Omit to use the active gateway scope. */
  profile?: ProfileScope
  labels?: ScratchpadLabels
  className?: string
}

/** Writes for one conversation are serialized even when the sidebar remounts
 * or the user changes chats while a delayed save is still in flight. */
const writeQueues = new Map<string, Promise<void>>()

function scopeKey(scope?: ProfileScope): string {
  if (!scope) {
    return ''
  }

  if (typeof scope === 'string') {
    return `profile:${scope}`
  }

  return `connection:${scope.connectionId ?? ''}:profile:${scope.profile ?? ''}`
}

function enqueueWrite(id: string, content: string, owner?: ProfileScope): Promise<void> {
  const key = `${scopeKey(owner)}:${id}`
  const previous = writeQueues.get(key) ?? Promise.resolve()

  const write = previous
    .catch(() => undefined)
    .then(async () => {
      await setSessionScratchpadRemote(id, content || null, owner)
      applySessionScratchpad(id, content || null)
    })

  writeQueues.set(key, write)

  const release = () => {
    if (writeQueues.get(key) === write) {
      writeQueues.delete(key)
    }
  }

  void write.then(release, release)

  return write
}

/** The right-sidebar mounting seam. It resolves the selected session from all
 * sidebar slices so cron and messaging chats receive the same note editor. */
export function ScratchpadSection() {
  const sessionId = useStore($selectedStoredSessionId)
  const sessions = useStore($sessions)
  const cronSessions = useStore($cronSessions)
  const messagingSessions = useStore($messagingSessions)
  const connection = useStore($connection)
  const owner = knownSessionOwner([...sessions, ...cronSessions, ...messagingSessions], sessionId)

  return (
    <SessionScratchpad
      profile={profileScopeForSessionOwner(owner) ?? connection?.profile}
      sessionId={sessionId}
    />
  )
}

/** A private, session-scoped note editor.
 *
 * The note is persisted through the session metadata endpoint and never added
 * to a prompt or transcript. A read only establishes the baseline. Only text
 * that the user actually changed is ever sent back. */
export function SessionScratchpad({ className, labels, profile, sessionId }: SessionScratchpadProps) {
  const { t } = useI18n()
  const sidebar = t.rightSidebar

  const copy = {
    title: sidebar.scratchpadTitle,
    placeholder: sidebar.scratchpadPlaceholder,
    emptySession: sidebar.scratchpadEmptySession,
    saving: sidebar.scratchpadSaving,
    error: sidebar.scratchpadError,
    ...labels
  }

  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const valueRef = useRef('')
  const dirtyRef = useRef(false)
  const generationRef = useRef(0)

  const targetRef = useRef<{ id: null | string; profile?: ProfileScope; generation: number }>({
    id: sessionId,
    profile,
    generation: 0
  })

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const writeTokenRef = useRef(0)
  const profileIsObject = profile !== null && typeof profile === 'object'
  const profileConnectionId = profileIsObject ? profile.connectionId : undefined
  const profileName = profileIsObject ? profile.profile : profile

  // The parent derives an object owner on every render. Keep the last object
  // while its connection/profile values are unchanged, so a sidebar refresh
  // cannot restart a read or change the write target by identity alone.
  const stableProfile = useMemo<ProfileScope | undefined>(() => {
    if (!profileIsObject) {
      return profileName
    }

    return { connectionId: profileConnectionId, profile: profileName }
  }, [profileConnectionId, profileIsObject, profileName])

  const persist = useCallback(async (
    target: { id: string; profile?: ProfileScope; generation: number },
    content: string
  ) => {
    const token = ++writeTokenRef.current
    setSaving(true)
    setFailed(false)

    try {
      await enqueueWrite(target.id, content, target.profile)

      if (target.generation === generationRef.current && token === writeTokenRef.current) {
        setSaving(false)
      }
    } catch {
      if (target.generation === generationRef.current && token === writeTokenRef.current) {
        setSaving(false)
        setFailed(true)
      }
    }
  }, [])

  const flushDraft = useCallback(() => {
    const target = targetRef.current

    if (!target.id || !dirtyRef.current) {
      return
    }

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }

    const content = valueRef.current
    dirtyRef.current = false
    void persist({ id: target.id, profile: target.profile, generation: target.generation }, content)
  }, [persist])

  // eslint-disable-next-line no-restricted-syntax -- this effect owns the latest selected session target
  useEffect(() => {
    // React runs the previous effect cleanup before this body. That cleanup
    // flushes the previous target while targetRef still names it.
    flushDraft()
    const generation = generationRef.current + 1
    generationRef.current = generation
    targetRef.current = { id: sessionId, profile: stableProfile, generation }
    valueRef.current = ''
    dirtyRef.current = false
    setValue('')
    setFailed(false)

    if (!sessionId || typeof window.hermesDesktop?.api !== 'function') {
      setLoading(false)

      return
    }

    let current = true
    setLoading(true)
    void getSession(sessionId, stableProfile)
      .then(session => {
        if (!current || generation !== generationRef.current || dirtyRef.current) {
          return
        }

        const next = session.scratchpad ?? ''
        valueRef.current = next
        setValue(next)
      })
      .catch(() => {
        if (current && generation === generationRef.current) {
          setFailed(true)
        }
      })
      .finally(() => {
        if (current && generation === generationRef.current) {
          setLoading(false)
        }
      })

    return () => {
      current = false
      // A timer belongs to the target captured by this effect. Flush its latest
      // value before the next session replaces the target ref.
      flushDraft()
    }
  }, [flushDraft, sessionId, stableProfile])

  const scheduleSave = (next: string) => {
    const target = targetRef.current

    if (!target.id) {
      return
    }

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
    }

    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null

      if (!dirtyRef.current || targetRef.current.generation !== target.generation) {
        return
      }

      dirtyRef.current = false
      void persist({ id: target.id!, profile: target.profile, generation: target.generation }, next)
    }, 350)
  }

  const onChange = (next: string) => {
    valueRef.current = next
    dirtyRef.current = true
    setValue(next)
    scheduleSave(next)
  }

  return (
    <section className={cn('flex min-h-0 flex-col border-t border-(--linear-border-panel)', className)}>
      <div className="flex h-7 shrink-0 items-center px-2.5 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-(--linear-text-tertiary)">
        {copy.title}
        {saving && <span className="ml-auto normal-case tracking-normal text-[0.625rem]">{copy.saving}</span>}
      </div>
      {!sessionId ? (
        <p className="px-2.5 pb-2 text-xs text-(--linear-text-quaternary)">{copy.emptySession}</p>
      ) : (
        <textarea
          aria-label={copy.title}
          className="min-h-24 flex-1 resize-y border-0 bg-transparent px-2.5 pb-3 text-[0.8125rem] leading-5 text-(--linear-text-primary) outline-none placeholder:text-(--linear-text-quaternary)"
          disabled={loading}
          onBlur={flushDraft}
          onChange={event => onChange(event.target.value)}
          placeholder={copy.placeholder}
          value={value}
        />
      )}
      {failed && <p className="px-2.5 pb-2 text-xs text-(--linear-red)">{copy.error}</p>}
    </section>
  )
}

