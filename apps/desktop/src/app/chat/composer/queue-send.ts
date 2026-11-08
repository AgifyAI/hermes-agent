/**
 * Routes a right-sidebar queue action to the one mounted composer that owns
 * the requested session. A queue can be rendered by the main pane and by a
 * keep-alive tile at the same time, so the event is claimed by its first
 * visible owner before the send starts.
 */

export interface ComposerQueueSendDetail {
  entryId: string
  sessionKey: string
  claimed?: boolean
}

const QUEUE_SEND_EVENT = 'hermes:composer-queue-send'

export const requestComposerQueueSend = (sessionKey: string, entryId: string): boolean => {
  const detail: ComposerQueueSendDetail = { entryId, sessionKey }

  if (typeof window === 'undefined') {
    return false
  }

  window.dispatchEvent(new CustomEvent<ComposerQueueSendDetail>(QUEUE_SEND_EVENT, { detail }))

  return detail.claimed === true
}

export const onComposerQueueSendRequest = (handler: (detail: ComposerQueueSendDetail) => void) => {
  if (typeof window === 'undefined') {
    return () => undefined
  }

  const listener = (event: Event) => {
    const detail = (event as CustomEvent<ComposerQueueSendDetail>).detail

    if (detail && !detail.claimed) {
      handler(detail)
    }
  }

  window.addEventListener(QUEUE_SEND_EVENT, listener)

  return () => window.removeEventListener(QUEUE_SEND_EVENT, listener)
}
