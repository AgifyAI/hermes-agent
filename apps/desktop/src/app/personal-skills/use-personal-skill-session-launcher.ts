import { useEffect, useMemo } from 'react'

import { setWorkspaceScope } from '@/components/pane-shell/workspace-scope'
import { stashSessionDraft } from '@/store/composer'

import {
  createPersonalSkillSessionLauncher,
  type PersonalSkillSessionLauncherDependencies,
  setPersonalSkillSessionLauncher
} from './session-launcher'

export function usePersonalSkillSessionLauncher(
  activeProfile: string,
  openNewSessionTile: PersonalSkillSessionLauncherDependencies['openNewSessionTile']
) {
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
