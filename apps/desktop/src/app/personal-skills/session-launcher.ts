import { atom } from 'nanostores'

import type { ProfileScope } from '@/api/client'
import type { SkillInfo } from '@/types/hermes'

export interface PersonalSkillSessionRequest {
  /** The source directory as resolved on the gateway that owns this skill. */
  cwd?: string
  profile: ProfileScope
  prompt: string
  skill: SkillInfo
}

export type PersonalSkillSessionLauncher = (request: PersonalSkillSessionRequest) => Promise<void> | void

export interface PersonalSkillSessionLauncherDependencies {
  activeProfile: string
  openNewSessionTile: (
    dir: 'center',
    options: {
      cwd?: string
      listed: false
      profile: string
      route?: { connectionId: string; profile: string }
    }
  ) => Promise<string | undefined>
  setWorkspaceScope: () => void
  stashSessionDraft: (scope: string, text: string) => void
}

export function createPersonalSkillSessionLauncher({
  activeProfile,
  openNewSessionTile,
  setWorkspaceScope,
  stashSessionDraft
}: PersonalSkillSessionLauncherDependencies): PersonalSkillSessionLauncher {
  return async ({ cwd, profile, prompt }) => {
    setWorkspaceScope()

    const profileName = (typeof profile === 'string' ? profile : profile?.profile)?.trim() || activeProfile.trim()

    const route =
      typeof profile === 'object' && profile?.connectionId?.trim()
        ? { connectionId: profile.connectionId.trim(), profile: profileName }
        : undefined

    const storedSessionId = await openNewSessionTile('center', {
      cwd,
      listed: false,
      profile: profileName,
      route
    })

    if (storedSessionId) {
      stashSessionDraft(storedSessionId, prompt)
    }
  }
}

export const $personalSkillSessionLauncher = atom<PersonalSkillSessionLauncher | null>(null)

export function setPersonalSkillSessionLauncher(launcher: PersonalSkillSessionLauncher | null): void {
  $personalSkillSessionLauncher.set(launcher)
}

export function launchPersonalSkillSession(request: PersonalSkillSessionRequest): boolean {
  const launcher = $personalSkillSessionLauncher.get()

  if (!launcher) {
    return false
  }

  void launcher(request)

  return true
}
