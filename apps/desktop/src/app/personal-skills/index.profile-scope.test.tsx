// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $activeGatewayProfile, $showAllProfiles } from '@/store/profile'
import type { ProfileInfo, SkillInfo } from '@/types/hermes'

import { PersonalSkillsPage, type PersonalSkillsPageProps } from './index'

interface ApiRequest {
  path: string
  profile?: null | string
}

interface SkillContentFixture {
  content: string
  name: string
  path: string
}

const profiles = ['Brent', 'other', 'empty']

const skill = (name: string, description: string): SkillInfo => ({
  category: 'personal',
  description,
  enabled: true,
  name,
  provenance: 'agent'
})

const skillsByProfile: Record<string, SkillInfo[]> = {
  Brent: [skill('shared-skill', 'Brent description'), skill('brent-only', 'Only Brent')],
  empty: [],
  other: [skill('shared-skill', 'Other description'), skill('other-only', 'Only other')]
}

const documentsByOwner: Record<string, string> = {
  'Brent:shared-skill': '---\nname: shared-skill\ndescription: Brent description\n---\n\nBrent instructions',
  'other:shared-skill': '---\nname: shared-skill\ndescription: Other description\n---\n\nOther instructions'
}

const profileInfo = (name: string): ProfileInfo => ({
  has_env: false,
  is_default: name === 'Brent',
  model: null,
  name,
  path: `/profiles/${name}`,
  provider: null,
  skill_count: skillsByProfile[name]?.length ?? 0
})

let api: ReturnType<typeof vi.fn>

function skillRequests(): ApiRequest[] {
  return api.mock.calls.map(([request]) => request as ApiRequest).filter(request => request.path === '/api/skills')
}

function contentRequests(): ApiRequest[] {
  return api.mock.calls
    .map(([request]) => request as ApiRequest)
    .filter(request => request.path.startsWith('/api/skills/content'))
}

function renderSkillsPage(onOpenSession?: PersonalSkillsPageProps['onOpenSession']): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(
    <MemoryRouter>
      <I18nProvider configClient={null} initialLocale="en">
        <QueryClientProvider client={client}>
          <PersonalSkillsPage onOpenSession={onOpenSession} />
        </QueryClientProvider>
      </I18nProvider>
    </MemoryRouter>
  )

  return client
}

beforeEach(() => {
  api = vi.fn(async (request: ApiRequest): Promise<unknown> => {
    if (request.path === '/api/profiles') {
      return { profiles: profiles.map(profileInfo) }
    }

    if (request.path === '/api/skills') {
      const owner = request.profile ?? ''

      if (!(owner in skillsByProfile)) {
        throw new Error(`Unexpected skills owner: ${owner || '<ambient>'}`)
      }

      return skillsByProfile[owner]
    }

    if (request.path.startsWith('/api/skills/content')) {
      const name = new URLSearchParams(request.path.split('?')[1] ?? '').get('name') ?? ''
      const owner = request.profile ?? ''
      const content = documentsByOwner[`${owner}:${name}`]

      if (!content) {
        throw new Error(`Unexpected content owner: ${owner || '<ambient>'}/${name}`)
      }

      return { content, name, path: `/profiles/${owner}/skills/${name}/SKILL.md` }
    }

    throw new Error(`Unexpected Skills request: ${request.path}`)
  })

  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: { api }
  })

  act(() => {
    $showAllProfiles.set(false)
    $activeGatewayProfile.set('Brent')
  })
})

afterEach(() => {
  cleanup()
  act(() => {
    $showAllProfiles.set(false)
    $activeGatewayProfile.set('default')
  })
  vi.restoreAllMocks()
})

describe('PersonalSkillsPage profile scope', () => {
  it.each([true, false])('opens the owning file in a chat when a repository is available: %s', async hasSource => {
    const installedPath = '/profiles/Brent/skills/shared-skill/SKILL.md'
    const sourcePath = '/repo/profiles/Brent/skills/shared-skill/SKILL.md'
    const base = api.getMockImplementation() as ((request: ApiRequest) => Promise<unknown>)
    api.mockImplementation(async (request: ApiRequest) => {
      const data = await base(request) as SkillContentFixture

      if (!request.path.startsWith('/api/skills/content')) {return data}

      return {
        ...data,
        location: {
          runtime: { cwd: '/workspace', path: installedPath },
          source: hasSource ? { cwd: '/repo', exists: true, path: sourcePath } : { exists: false }
        },
        source_content: hasSource ? data.content : null
      }
    })
    const open = vi.fn()
    renderSkillsPage(open)
    await screen.findByText('Brent instructions')
    fireEvent.click(screen.getByRole('button', { name: 'Open chat' }))

    expect(open).toHaveBeenCalledWith(expect.objectContaining({
      cwd: hasSource ? '/repo' : '/workspace',
      prompt: expect.stringContaining(hasSource ? sourcePath : installedPath)
    }))
    expect(open.mock.calls[0][0].prompt.startsWith('/shared-skill')).toBe(false)
  })

  it('keeps list and detail requests on Brent, another profile, all profiles, then an empty profile', async () => {
    renderSkillsPage()

    await screen.findByText('brent-only')
    expect(screen.getByText('Brent instructions')).toBeTruthy()
    expect(skillRequests().length).toBeGreaterThan(0)
    expect(skillRequests().every(request => request.profile === 'Brent')).toBe(true)
    expect(contentRequests().map(request => request.profile)).toEqual(['Brent'])

    const beforeOther = skillRequests().length
    act(() => $activeGatewayProfile.set('other'))

    await waitFor(() => expect(screen.getByText('other-only')).toBeTruthy())
    await waitFor(() => expect(screen.getByText('Other instructions')).toBeTruthy())
    expect(screen.queryByText('brent-only')).toBeNull()
    expect(
      skillRequests()
        .slice(beforeOther)
        .every(request => request.profile === 'other')
    ).toBe(true)
    expect(contentRequests().at(-1)?.profile).toBe('other')

    const beforeAll = skillRequests().length
    act(() => $showAllProfiles.set(true))

    await waitFor(() => {
      expect(screen.getByText('brent-only')).toBeTruthy()
      expect(screen.getByText('other-only')).toBeTruthy()
    })

    const allProfileRequests = skillRequests()
      .slice(beforeAll)
      .map(request => request.profile)

    expect(allProfileRequests).toEqual(expect.arrayContaining(['Brent', 'empty']))
    expect(allProfileRequests.every(profile => profiles.includes(profile ?? ''))).toBe(true)
    expect(screen.getAllByText('Brent', { exact: true })).toHaveLength(2)
    expect(screen.getAllByText('other', { exact: true })).toHaveLength(2)
    expect(screen.getByText('Other instructions')).toBeTruthy()

    const beforeEmpty = skillRequests().length
    act(() => {
      $showAllProfiles.set(false)
      $activeGatewayProfile.set('empty')
    })

    await waitFor(() => expect(screen.getAllByText('No personal skills installed.')).toHaveLength(2))
    expect(screen.queryByText('brent-only')).toBeNull()
    expect(screen.queryByText('other-only')).toBeNull()
    expect(
      skillRequests()
        .slice(beforeEmpty)
        .every(request => request.profile === 'empty')
    ).toBe(true)
    expect(contentRequests().at(-1)?.profile).toBe('other')
  })
})
