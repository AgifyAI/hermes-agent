import { renameSession } from '@/hermes'
import { activeGateway } from '@/store/gateway'
import {
  $activeSessionId,
  $selectedStoredSessionId,
  $sessions,
  sessionMatchesStoredId
} from '@/store/session'
import { ambientRequestFor } from '@/store/session-gone-latch'
import { $sessionStates, $sessionTiles, requestForOwnedSession } from '@/store/session-states'

import type { SessionTitleResponse } from '../../types'

// Rename a session, preferring the gateway's session.title RPC over REST.
//
// A freshly *branched* session (and any brand-new chat) lives only in the
// gateway's in-memory _sessions map keyed by its RUNTIME id — no row is
// persisted to state.db until the first turn. REST PATCH /api/sessions/{id}
// resolves against the stored sessions table, so it 404s ("Session not found")
// on these runtime-only sessions. The session.title RPC resolves the live
// runtime session AND persists the row on demand, so it succeeds where REST
// cannot. This mirrors the /title slash command's fix (use-prompt-actions.ts).
//
// We only take the RPC path for the ACTIVE/selected session: its runtime id is
// known ($activeSessionId) and it lives on the active gateway, so there is no
// profile-routing ambiguity. Every other row (already persisted, possibly on a
// background profile) keeps the REST path, which handles profile scoping and a
// non-empty title is required by the RPC (it rejects clears), so clears stay on
// REST too.
/** Resolve a live runtime id for a stored session id, from any surface that
 *  currently holds one — not just the selected-primary row.
 *
 *  A branched session opens as its own TAB and deliberately does NOT become the
 *  selected primary row, so `$selectedStoredSessionId`/`$activeSessionId` do not
 *  see it. Until its first turn it also has no persisted DB row, so a REST
 *  rename 404s "session not found". But the branch flow binds a runtime and
 *  stores it on the tile (`patchSessionTile(..., { runtimeId })`), and
 *  `$sessionStates` is keyed by runtime id with `storedSessionId` on each state.
 *  Consulting those lets the working `session.title` RPC path fire for a
 *  just-branched draft instead of falling through to a 404. (#70317) */
function resolveRuntimeIdForStored(storedSessionId: string): null | string {
  if (storedSessionId === $selectedStoredSessionId.get()) {
    const active = $activeSessionId.get()

    if (active) {
      return active
    }
  }

  const tileRuntimeId = $sessionTiles.get().find(tile => tile.storedSessionId === storedSessionId)?.runtimeId

  if (tileRuntimeId) {
    return tileRuntimeId
  }

  for (const [runtimeId, state] of Object.entries($sessionStates.get())) {
    if (state.storedSessionId === storedSessionId) {
      return runtimeId
    }
  }

  return null
}

export async function renameSessionPreferringRpc(
  storedSessionId: string,
  title: string,
  profile?: string
): Promise<{ title?: string }> {
  const resolvedProfile =
    (profile ?? '').trim() ||
    $sessions.get().find(s => sessionMatchesStoredId(s, storedSessionId))?.profile ||
    undefined

  const runtimeId = resolveRuntimeIdForStored(storedSessionId)
  const gateway = activeGateway()

  if (title && runtimeId && gateway) {
    try {
      // The runtime lives on its owner's backend; the ambient socket would
      // refuse a secondary profile's session and drop us to REST.
      const result = await requestForOwnedSession<SessionTitleResponse>(
        runtimeId,
        ambientRequestFor(gateway),
        'session.title',
        { session_id: runtimeId, title }
      )

      return { title: result?.title ?? title }
    } catch (err) {
      // Fall through to REST — e.g. the socket is mid-reconnect. REST still
      // works for any session that already has a persisted row. Log so a
      // genuine RPC-side failure (which then surfaces a REST 404 for the
      // runtime id) is at least diagnosable instead of silently swallowed.
      console.warn('session.title RPC rename failed; falling back to REST', err)
    }
  }

  return renameSession(storedSessionId, title, resolvedProfile)
}
