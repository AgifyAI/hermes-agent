import { describe, expect, it, vi } from 'vitest'

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
  it('routes a remote owner and stashes the prompt under the returned session id', async () => {
    const openNewSessionTile = vi.fn().mockResolvedValue('remote-session-1')
    const setWorkspaceScope = vi.fn()
    const drafts = new Map([['existing-session', 'keep this draft']])

    const launcher = createPersonalSkillSessionLauncher({
      activeProfile: 'default',
      openNewSessionTile,
      setWorkspaceScope,
      stashSessionDraft: (scope, text) => drafts.set(scope, text)
    })

    await launcher({
      profile: { connectionId: 'homelab', profile: 'calvin' },
      prompt: '/follow-up\n\n',
      skill
    })

    expect(setWorkspaceScope).toHaveBeenCalledOnce()
    expect(openNewSessionTile).toHaveBeenCalledWith('center', {
      listed: false,
      profile: 'calvin',
      route: { connectionId: 'homelab', profile: 'calvin' }
    })
    expect(drafts.get('remote-session-1')).toBe('/follow-up\n\n')
    expect(drafts.get('existing-session')).toBe('keep this draft')
  })

  it('keeps two same-named skills on separate profile-owned sessions', async () => {
    const openNewSessionTile = vi
      .fn()
      .mockResolvedValueOnce('calvin-session')
      .mockResolvedValueOnce('default-session')

    const drafts = new Map<string, string>()

    const launcher = createPersonalSkillSessionLauncher({
      activeProfile: 'default',
      openNewSessionTile,
      setWorkspaceScope: vi.fn(),
      stashSessionDraft: (scope, text) => drafts.set(scope, text)
    })

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
    expect([...drafts.keys()]).toEqual(['calvin-session', 'default-session'])
  })
})
