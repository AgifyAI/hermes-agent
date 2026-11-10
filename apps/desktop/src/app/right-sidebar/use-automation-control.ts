import { useEffect } from 'react'

import { useSessionValue } from '@/app/chat/composer/status-stack/session-control-utils'
import {
  $sessionControlBySession,
  refreshSessionControl,
  type SessionControlEntry,
  type SessionControlSnapshot
} from '@/store/session-control'

/** The automation snapshot (goal, loop, heartbeat) for one runtime session.
 *
 * The status stack seeds this on mount; the right sidebar can be shown for a
 * session whose composer stack is not mounted (HUD, narrow layout, a settings
 * overlay), so the panel seeds it too. Updates still arrive through the shared
 * gateway event stream — nothing here polls.
 */
export function useAutomationControl(sessionId: string | null): {
  entry: SessionControlEntry | null
  snapshot: SessionControlSnapshot | null
} {
  const entry = useSessionValue($sessionControlBySession, sessionId)
  const capability = entry?.capability

  useEffect(() => {
    if (!sessionId || capability === 'supported' || capability === 'unsupported') {
      return
    }

    void refreshSessionControl(sessionId)
  }, [capability, sessionId])

  return { entry: entry ?? null, snapshot: entry?.snapshot ?? null }
}
