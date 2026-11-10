/**
 * Routes a right-sidebar control action (goal resume, gate confirmation, …) to
 * the one mounted composer that owns the session. The backend has already
 * executed the state change and returns the prompt to send; the composer owns
 * the actual submit (busy queueing, admission, transcript ids), so the panel
 * never reimplements it. Same claim protocol as {@link requestComposerQueueSend}:
 * a main pane and a keep-alive tile with the same session send it once.
 */

export interface ComposerPromptSendDetail {
  accepted?: boolean
  claimed?: boolean
  /** Hidden transcript projection, when the backend's dispatch carries one. */
  displayText?: string
  sessionKey: string
  text: string
}

const PROMPT_SEND_EVENT = 'hermes:composer-prompt-send'

export const requestComposerPromptSend = (sessionKey: string, text: string, displayText?: string): boolean => {
  const detail: ComposerPromptSendDetail = { displayText, sessionKey, text }

  if (typeof window === 'undefined') {
    return false
  }

  window.dispatchEvent(new CustomEvent<ComposerPromptSendDetail>(PROMPT_SEND_EVENT, { detail }))

  return detail.claimed === true
}

export const onComposerPromptSendRequest = (handler: (detail: ComposerPromptSendDetail) => void) => {
  if (typeof window === 'undefined') {
    return () => undefined
  }

  const listener = (event: Event) => {
    const detail = (event as CustomEvent<ComposerPromptSendDetail>).detail

    if (detail && !detail.claimed) {
      handler(detail)
    }
  }

  window.addEventListener(PROMPT_SEND_EVENT, listener)

  return () => window.removeEventListener(PROMPT_SEND_EVENT, listener)
}
