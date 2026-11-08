import { useEffect, useMemo } from 'react'

import { setWorkspaceScope } from '@/components/pane-shell/workspace-scope'
import { stashSessionDraft } from '@/store/composer'

import { createPersonalSkillSessionLauncher, setPersonalSkillSessionLauncher } from './session-launcher'

interface OpenNewSessionTile {
  (
    dir: 'center',
    options: {
      listed: false
      profile: string
      route?: { connectionId: string; profile: string }
    }
  ): Promise<string | undefined>
}

export function usePersonalSkillSessionLauncher(activeProfile: string, openNewSessionTile: OpenNewSessionTile) {
  const launcher = useMemo(
    () =>
      createPersonalSkillSessionLauncher({
        activeProfile,
        openNewSessionTile,
        setWorkspaceScope: () => setWorkspaceScope('sessions'),
        stashSessionDraft: (scope, prompt) => stashSessionDraft(scope, prompt, [])
      }),
    [activeProfile, openNewSessionTile]
  )

  useEffect(() => {
    setPersonalSkillSessionLauncher(launcher)

    return () => setPersonalSkillSessionLauncher(null)
  }, [launcher])

  return launcher
}
