import { useStore } from '@nanostores/react'
import { useState } from 'react'

import { useStoreSelector } from '@/lib/use-session-slice'
import { $collapsedStatusDrawers, setStatusDrawerCollapsed, statusDrawerKey } from '@/store/composer-status-drawer'
import { $activeConnectionId } from '@/store/connections'
import { $activeGatewayProfile, normalizeProfileKey } from '@/store/profile'
import { isSessionOwnerRoute } from '@/store/session-request-router'
import { knownOwnerForSession } from '@/store/session-states'

import { useComposerScope } from '../scope'

export function useStatusDrawer(sessionKey: string | null) {
  const scope = useComposerScope()
  const activeProfile = useStore($activeGatewayProfile)
  const activeConnection = useStore($activeConnectionId)
  const owner = knownOwnerForSession(sessionKey)
  const route = isSessionOwnerRoute(owner) ? owner : null

  const profile = normalizeProfileKey(
    route?.profile ?? (typeof owner === 'string' ? owner : (scope.profile ?? activeProfile))
  )

  const targetProfile = normalizeProfileKey(route?.targetProfile ?? profile)
  const connectionId = route ? (route.connectionId ?? null) : owner ? null : (scope.connectionId ?? activeConnection)
  const ownerKey = JSON.stringify([connectionId, profile, targetProfile])
  const key = sessionKey ? statusDrawerKey({ connectionId, profile, targetProfile, sessionId: sessionKey }) : null
  const saved = useStoreSelector($collapsedStatusDrawers, keys => key !== null && keys.includes(key))
  const draftKey = key ?? ownerKey
  // New conversations and conversations without an explicit choice start
  // folded. Keep the mounted conversation's manual choice local so opening
  // still works immediately, while the existing store continues to remember
  // deliberate collapses.
  const [draft, setDraft] = useState({ key: draftKey, collapsed: true })

  // Unsaved drafts have no durable preference. Never carry their choice into
  // a stored conversation selected from the sidebar or a subsequent new chat.
  if (draft.key !== draftKey) {
    setDraft({ key: draftKey, collapsed: true })
  }

  const collapsed = saved || draft.collapsed

  return {
    collapsed,
    toggle: () => {
      const next = !collapsed
      setDraft({ key: draftKey, collapsed: next })

      if (key) {
        setStatusDrawerCollapsed(key, next)
      }
    }
  }
}
