import { useEffect, useReducer, useRef } from 'react'

import { isSubmitEnter } from '@/lib/ime'
import {
  initialQuickComposerState,
  QUICK_TARGET_CURRENT,
  QUICK_TARGET_NEW,
  type QuickComposerEvent,
  quickComposerReducer,
  type QuickComposerState,
  quickEntryResultEvent
} from '@/store/quick-entry'

// Native select popups do not reliably inherit the closed control's colors.
// Paint both sides of the contrast pair on every option so Chromium cannot
// combine a dark-theme foreground with an OS-provided light popup surface.
const QUICK_TARGET_OPTION_STYLE = {
  backgroundColor: 'var(--linear-bg-overlay)',
  color: 'var(--linear-text-overlay)'
}

/**
 * The Quick Entry composer — the whole renderer surface of the global-hotkey
 * mini window. Deliberately one input plus a session-target picker and nothing
 * else: this is a capture surface, not a second chat.
 *
 * All behavior rides `quickComposerReducer` (pure, unit-tested): submit sends
 * the trimmed text + target through the shell and asks to hide; an empty submit
 * does neither so a stray Enter can't make the window vanish; Escape and losing
 * focus dismiss without sending; a dead gateway disables the input entirely
 * (the reducer refuses the send AND the input paints the reconnect hint).
 *
 * The window itself has no gateway connection. Its view of backend truth — is
 * the gateway up, which recent sessions exist — is pushed in by the primary
 * renderer through main (`onState`), and its text goes back the same road to
 * the primary renderer's normal prompt-submit path.
 */
export function QuickEntryApp() {
  const inputRef = useRef<HTMLInputElement>(null)
  const submitIdRef = useRef(0)

  // The reducer returns { send, state }; this wrapper performs the side effect
  // (hand the payload to the shell, ask to hide) and stores the next state, so
  // the decision stays pure and testable while the effects stay in one place.
  const [state, dispatch] = useReducer((current: QuickComposerState, event: QuickComposerEvent) => {
    const { send, state: next } = quickComposerReducer(current, event)
    const api = window.hermesDesktop?.quickEntry

    if (send) {
      const submitId = submitIdRef.current
      void api?.submit(send).then(result => {
        dispatch(quickEntryResultEvent(result, submitId))

        if (!result.ok) {
          requestAnimationFrame(() => inputRef.current?.focus())
        }
      })
    } else if (!next.visible && current.visible) {
      api?.dismiss()
    }

    return next
  }, initialQuickComposerState)

  // Re-summoned by the chord: the shell reuses the window, so reset the draft
  // and take the keyboard back for a fresh capture. Also adopt gateway-state
  // pushes (connection + recent sessions) relayed from the primary renderer.
  useEffect(() => {
    const api = window.hermesDesktop?.quickEntry

    const offShown = api?.onShown(() => {
      dispatch({ type: 'shown' })
      requestAnimationFrame(() => inputRef.current?.focus())
    })

    const offState = api?.onState(payload => {
      dispatch({
        connected: payload?.connected === true,
        sessions: Array.isArray(payload?.sessions) ? payload.sessions : [],
        type: 'state'
      })
    })

    const offLateResult = api?.onLateResult(payload => {
      dispatch({
        message: payload?.result?.message ?? 'Hermes could not deliver the prompt.',
        ok: payload?.result?.ok === true,
        type: 'late-result'
      })
    })

    inputRef.current?.focus()

    return () => {
      offShown?.()
      offState?.()
      offLateResult?.()
    }
  }, [])

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-transparent p-3">
      {/* Linear's new-issue modal, sized to the fixed 640x168 window. The card's
          shadow must stay inside the 12px transparent padding (extent beyond it
          is clipped by the window bounds into a hard edge), so it wears the low
          elevation, not the full dialog shadow. */}
      <div className="flex w-full flex-col gap-3 rounded-(--linear-radius-modal) border-[0.5px] border-(--linear-border-overlay) bg-(--linear-bg-card) px-4 py-3.5 text-(--linear-text-primary) shadow-(--linear-shadow-low)">
        <input
          aria-label="Quick Entry"
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          className="w-full min-w-0 border-none bg-transparent font-[inherit] text-[1.125rem] leading-[1.8rem] font-semibold text-(--linear-text-primary) outline-none placeholder:text-(--linear-text-quaternary) disabled:opacity-60"
          disabled={!state.connected}
          onBlur={event => {
            // Moving focus to the target picker is not leaving the window.
            if (!event.relatedTarget) {
              dispatch({ type: 'blur' })
            }
          }}
          onChange={event => dispatch({ draft: event.target.value, type: 'edit' })}
          onKeyDown={event => {
            if (isSubmitEnter(event) && !event.shiftKey) {
              event.preventDefault()
              dispatch({ submitId: ++submitIdRef.current, type: 'submit' })
            } else if (event.key === 'Escape') {
              event.preventDefault()
              dispatch({ type: 'dismiss' })
            }
          }}
          placeholder={state.connected ? 'Ask Hermes…' : 'Not connected — open Hermes to reconnect'}
          ref={inputRef}
          spellCheck={false}
          value={state.draft}
        />
        <div className="flex items-center gap-2">
          <label
            className="shrink-0 select-none text-xs font-medium text-(--linear-text-tertiary)"
            htmlFor="quick-entry-target"
          >
            Send to
          </label>
          {/* A Linear property chip: 24px pill, hairline, chip fill. */}
          <select
            aria-label="Target session"
            className="h-6 max-w-80 cursor-pointer rounded-full border-[0.5px] border-(--linear-border-tertiary) bg-(--linear-bg-chip) pr-2 pl-1.5 text-xs font-medium text-(--linear-text-chip) outline-none hover:bg-(--linear-bg-chip-hover) focus-visible:ring-1 focus-visible:ring-(--linear-focus) disabled:cursor-default disabled:opacity-60"
            disabled={!state.connected}
            id="quick-entry-target"
            onChange={event => dispatch({ target: event.target.value, type: 'target' })}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                event.preventDefault()
                dispatch({ type: 'dismiss' })
              }
            }}
            value={state.target}
          >
            <option style={QUICK_TARGET_OPTION_STYLE} value={QUICK_TARGET_CURRENT}>
              Current chat
            </option>
            <option style={QUICK_TARGET_OPTION_STYLE} value={QUICK_TARGET_NEW}>
              New session
            </option>
            {state.sessions.map(session => (
              <option key={session.id} style={QUICK_TARGET_OPTION_STYLE} value={session.id}>
                {session.title}
              </option>
            ))}
          </select>
        </div>
        {state.error ? (
          <div className="text-[0.6875rem] text-(--linear-red)" role="alert">
            {state.error}
          </div>
        ) : null}
      </div>
    </div>
  )
}
