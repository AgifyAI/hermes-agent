import { describe, expect, it, vi } from 'vitest'

import { clearSessionDraft, stashSessionDraft, takeSessionDraft } from '@/store/composer'
import type { SkillInfo } from '@/types/hermes'

import { createPersonalSkillSessionLauncher } from './session-launcher'

const skill: SkillInfo = {
  category: 'general',
  description: 'A private skill',
  enabled: true,
  name: 'follow-up',
  provenance: 'agent'
}

describe('createPersonalSkillSessionLauncher', () => {
  it('opens the source repository on its owning gateway and puts the prompt in that new chat', async () => {
    const openNewSessionTile = vi.fn()
    const setWorkspaceScope = vi.fn()
    const existingSessionId = 'personal-skills-existing-session'
    const createdSessionId = 'personal-skills-remote-session-1'

    clearSessionDraft(existingSessionId)
    clearSessionDraft(createdSessionId)
    stashSessionDraft(existingSessionId, 'keep this draft', [])

    const launcher = createPersonalSkillSessionLauncher({
      activeProfile: 'default',
      openNewSessionTile,
      setWorkspaceScope,
      stashSessionDraft: (scope, text) => stashSessionDraft(scope, text, [])
    })

    try {
      openNewSessionTile.mockResolvedValue(createdSessionId)
      await launcher({
        cwd: '/srv/demo/skill-sources',
        profile: { connectionId: 'homelab', profile: 'calvin' },
        prompt: '/follow-up\n\n',
        skill
      })

      expect(setWorkspaceScope).toHaveBeenCalledOnce()
      expect(openNewSessionTile).toHaveBeenCalledWith('center', {
        cwd: '/srv/demo/skill-sources',
        listed: false,
        profile: 'calvin',
        route: { connectionId: 'homelab', profile: 'calvin' }
      })
      expect(takeSessionDraft(createdSessionId).text).toBe('/follow-up\n\n')
      expect(takeSessionDraft(existingSessionId).text).toBe('keep this draft')
    } finally {
      clearSessionDraft(existingSessionId)
      clearSessionDraft(createdSessionId)
    }
  })

  it('keeps two same-named skills on separate profile-owned sessions', async () => {
    const calvinSessionId = 'personal-skills-calvin-session'
    const defaultSessionId = 'personal-skills-default-session'
    const openNewSessionTile = vi.fn().mockResolvedValueOnce(calvinSessionId).mockResolvedValueOnce(defaultSessionId)

    clearSessionDraft(calvinSessionId)
    clearSessionDraft(defaultSessionId)

    const launcher = createPersonalSkillSessionLauncher({
      activeProfile: 'default',
      openNewSessionTile,
      setWorkspaceScope: vi.fn(),
      stashSessionDraft: (scope, text) => stashSessionDraft(scope, text, [])
    })

    try {
      await launcher({ profile: 'calvin', prompt: '/follow-up\n\n', skill })
      await launcher({ profile: 'default', prompt: '/follow-up\n\n', skill })

      expect(openNewSessionTile).toHaveBeenNthCalledWith(1, 'center', {
        listed: false,
        profile: 'calvin',
        route: undefined
      })
      expect(openNewSessionTile).toHaveBeenNthCalledWith(2, 'center', {
        listed: false,
        profile: 'default',
        route: undefined
      })
      expect(takeSessionDraft(calvinSessionId).text).toBe('/follow-up\n\n')
      expect(takeSessionDraft(defaultSessionId).text).toBe('/follow-up\n\n')
    } finally {
      clearSessionDraft(calvinSessionId)
      clearSessionDraft(defaultSessionId)
    }
  })
})
