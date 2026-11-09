// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $activeGatewayProfile, $showAllProfiles } from '@/store/profile'
import type { SkillInfo } from '@/types/hermes'

import { PersonalSkillsPage } from './index'

interface ApiRequest {
  body?: Record<string, unknown>
  method?: string
  path: string
  profile?: null | string
}

const installed = '---\nname: review\ndescription: Installed description\n---\n\nInstalled instructions'
const source = '---\nname: review\ndescription: Source description\n---\n\nSource instructions'
const sourceWithoutDescription = '---\nname: review\n---\n\nSource instructions'

const skill: SkillInfo = {
  category: 'writing',
  description: 'Source description',
  enabled: true,
  name: 'review',
  provenance: 'agent'
}

const otherSkill: SkillInfo = {
  category: 'productivity',
  description: 'Planning description',
  enabled: true,
  name: 'planning',
  provenance: 'agent'
}

const otherInstalled = '---\nname: planning\ndescription: Installed planning description\n---\n\nInstalled planning instructions'
const otherSource = '---\nname: planning\ndescription: Source planning description\n---\n\nSource planning instructions'

const location = {
  installation: {
    path: '/home/hermes/.hermes/skills/review/SKILL.md',
    runtime_editable: true,
    runtime_version: 'runtime-v1',
    source_path: '/repo/profiles/Brent/skills/review/SKILL.md',
    source_version: 'source-v1',
    status: 'different'
  },
  machine: 'gateway',
  repo: { name: 'hermes' },
  runtime: { editable: true, path: '/home/hermes/.hermes/skills/review/SKILL.md' },
  source: {
    cwd: '/repo',
    editable: true,
    exists: true,
    known: true,
    path: '/repo/profiles/Brent/skills/review/SKILL.md',
    repo: { name: 'hermes' }
  }
}

let api: ReturnType<typeof vi.fn>
let missingDescription: boolean
let syncResponse: 'conflict' | 'success'
let sourceVersionResponse: string

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(
    <MemoryRouter>
      <I18nProvider configClient={null} initialLocale="en">
        <QueryClientProvider client={client}>
          <PersonalSkillsPage />
        </QueryClientProvider>
      </I18nProvider>
    </MemoryRouter>
  )

  return client
}

function syncRequests(): ApiRequest[] {
  return api.mock.calls
    .map(([request]) => request as ApiRequest)
    .filter(request => request.path === '/api/skills/source')
}

function contentRequests(): ApiRequest[] {
  return api.mock.calls
    .map(([request]) => request as ApiRequest)
    .filter(request => request.path.startsWith('/api/skills/content'))
}

function contentName(request: ApiRequest): string {
  return new URL(`http://hermes.local${request.path}`).searchParams.get('name') ?? skill.name
}

beforeEach(() => {
  missingDescription = false
  syncResponse = 'success'
  sourceVersionResponse = 'source-v1'
  api = vi.fn(async (request: ApiRequest): Promise<unknown> => {
    console.log('roundtrip api', request.path)
    if (request.path === '/api/profiles') {
      return { profiles: [{ has_env: false, is_default: true, model: null, name: 'Brent', path: '/profiles/Brent', provider: null, skill_count: 1 }] }
    }

    if (request.path === '/api/skills') {
      return [missingDescription ? { ...skill, description: '' } : skill, otherSkill]
    }

    if (request.path.startsWith('/api/skills/content')) {
      const name = contentName(request)
      const isOther = name === otherSkill.name

      const currentLocation = isOther
        ? {
            ...location,
            installation: {
              ...location.installation,
              path: '/home/hermes/.hermes/skills/planning/SKILL.md',
              source_path: '/repo/profiles/Brent/skills/planning/SKILL.md',
              source_version: 'planning-source-v1'
            },
            source: {
              ...location.source,
              path: '/repo/profiles/Brent/skills/planning/SKILL.md'
            },
            runtime: { ...location.runtime, path: '/home/hermes/.hermes/skills/planning/SKILL.md' }
          }
        : {
            ...location,
            installation: { ...location.installation, source_version: sourceVersionResponse }
          }

      return {
        content: isOther ? otherInstalled : installed,
        location: currentLocation,
        name,
        path: currentLocation.installation.path,
        source_content: isOther ? otherSource : missingDescription ? sourceWithoutDescription : source
      }
    }

    if (request.path === '/api/skills/source') {
      if (syncResponse === 'conflict') {
        throw Object.assign(new Error('409: The skill changed since it was loaded.'), { statusCode: 409 })
      }

      return {
        direction: request.body?.direction,
        location: { ...location, installation: { ...location.installation, status: 'identical' } },
        name: skill.name,
        success: true,
        version: 'source-v2'
      }
    }

    throw new Error(`Unexpected Skills request: ${request.path}`)
  })

  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: { api } })
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

describe('PersonalSkillsPage source/runtime comparison', () => {
  it('shows both versions and copies the selected source into the installed file', async () => {
    renderPage()

    await screen.findByRole('textbox', { name: 'Skill instructions' })
    expect(screen.getByText('Compare versions')).toBeTruthy()
    expect(screen.getByText('Compare versions').closest('details')?.hasAttribute('open')).toBe(false)
    expect(Boolean(screen.getByRole('button', { name: 'Save' }).compareDocumentPosition(screen.getByText('Compare versions')) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
    fireEvent.click(screen.getByText('Compare versions'))
    expect((screen.getByRole('button', { name: 'Keep source' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'Keep installed' }) as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Keep source' }))

    await waitFor(() => expect(syncRequests()).toHaveLength(1))
    expect(syncRequests()[0].body).toMatchObject({
      direction: 'source_to_installed',
      expected_runtime_version: 'runtime-v1',
      expected_source_version: 'source-v1',
      name: 'review'
    })
  })

  it('copies the installed version back to the source with both observed versions', async () => {
    renderPage()

    await screen.findByRole('textbox', { name: 'Skill instructions' })
    fireEvent.click(screen.getByText('Compare versions'))
    fireEvent.click(screen.getByRole('button', { name: 'Keep installed' }))

    await waitFor(() => expect(syncRequests()).toHaveLength(1))
    expect(syncRequests()[0].body).toMatchObject({
      direction: 'installed_to_source',
      expected_runtime_version: 'runtime-v1',
      expected_source_version: 'source-v1'
    })
  })

  it('keeps an unsaved source draft when copying the installed version', async () => {
    renderPage()

    const editor = await screen.findByRole('textbox', { name: 'Skill instructions' })
    editor.textContent = 'Draft that must survive sync'
    fireEvent.input(editor)
    fireEvent.click(screen.getByText('Compare versions'))
    fireEvent.click(screen.getByRole('button', { name: 'Keep installed' }))

    await waitFor(() => expect(syncRequests()).toHaveLength(1))
    expect(editor.textContent).toContain('Draft that must survive sync')
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('does not leak source drafts into the installed tab and restores them on return', async () => {
    renderPage()

    const bodyEditor = await screen.findByRole('textbox', { name: 'Skill instructions' })
    const nameEditor = screen.getByRole('textbox', { name: 'Name' })
    const descriptionEditor = screen.getByRole('textbox', { name: 'Description' })
    nameEditor.textContent = 'Source draft title'
    descriptionEditor.textContent = 'Source draft description'
    bodyEditor.textContent = 'Source draft instructions'
    fireEvent.input(nameEditor)
    fireEvent.input(descriptionEditor)
    fireEvent.input(bodyEditor)

    fireEvent.click(screen.getByRole('button', { name: 'Installed' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Installed' }).getAttribute('aria-pressed')).toBe('true'))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Skill instructions' }).textContent).toContain('Installed instructions'))
    expect(screen.getByRole('textbox', { name: 'Name' }).textContent).toBe('review')
    expect(screen.getByRole('textbox', { name: 'Description' }).textContent).toBe('Installed description')
    expect(screen.getByRole('textbox', { name: 'Skill instructions' }).textContent).toContain('Installed instructions')
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Source' }))

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Skill instructions' }).textContent).toContain('Source draft instructions'))
    expect(screen.getByRole('textbox', { name: 'Name' }).textContent).toBe('Source draft title')
    expect(screen.getByRole('textbox', { name: 'Description' }).textContent).toBe('Source draft description')
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('keeps empty text fields visual-only, pastes one line, and disables Save for an empty title', async () => {
    missingDescription = true
    renderPage()

    const descriptionEditor = await screen.findByRole('textbox', { name: 'Description' })
    expect(descriptionEditor.textContent).toBe('')
    expect(descriptionEditor.getAttribute('data-placeholder')).toBe('No description.')

    fireEvent.paste(descriptionEditor, {
      clipboardData: { getData: () => 'First line\nSecond line' }
    })

    await waitFor(() => expect(descriptionEditor.textContent).toBe('First line\nSecond line'))
    fireEvent.keyDown(descriptionEditor, { key: 'Enter', isComposing: false })
    expect(descriptionEditor.textContent).toBe('First line\nSecond line')

    const nameEditor = screen.getByRole('textbox', { name: 'Name' })
    fireEvent.paste(nameEditor, {
      clipboardData: { getData: () => 'First line\nSecond line' }
    })
    expect(nameEditor.textContent).toBe('First line Second line')
    nameEditor.textContent = ''
    fireEvent.input(nameEditor)
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps the edited source draft visible when Save receives a 409 conflict', async () => {
    syncResponse = 'conflict'
    renderPage()

    const editor = await screen.findByRole('textbox', { name: 'Skill instructions' })
    editor.textContent = 'Draft that must stay visible'
    fireEvent.input(editor)

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(syncRequests()).toHaveLength(1))
    expect(syncRequests()[0].body).toMatchObject({
      direction: 'edit_source',
      expected_source_version: 'source-v1',
      name: 'review'
    })
    expect(editor.textContent).toContain('Draft that must stay visible')
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('uses the source revision observed when typing even if content refreshes', async () => {
    const client = renderPage()
    const editor = await screen.findByRole('textbox', { name: 'Skill instructions' })
    editor.textContent = 'Draft from the first revision'
    fireEvent.input(editor)

    const requestsBeforeRefresh = contentRequests().length
    sourceVersionResponse = 'source-v2'
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['personal-skill-content'] })
    })
    await waitFor(() => expect(contentRequests().length).toBeGreaterThan(requestsBeforeRefresh))

    syncResponse = 'conflict'
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(syncRequests()).toHaveLength(1))
    expect(syncRequests()[0].body).toMatchObject({ expected_source_version: 'source-v1' })
    expect(editor.textContent).toContain('Draft from the first revision')
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('keeps a draft attached to its skill while visiting another skill', async () => {
    console.log('roundtrip start')
    renderPage()

    const editor = await screen.findByRole('textbox', { name: 'Skill instructions' })
    console.log('roundtrip initial loaded')
    const nameEditor = screen.getByRole('textbox', { name: 'Name' })
    nameEditor.textContent = 'Review draft title'
    editor.textContent = 'Review draft instructions'
    fireEvent.input(nameEditor)
    fireEvent.input(editor)

    expect(screen.getByRole('button', { name: /Review draft title/ })).toBeTruthy()
    expect(screen.getAllByText('Review draft title').length).toBeGreaterThan(0)
    console.log('roundtrip draft set')

    fireEvent.click(screen.getByRole('button', { name: 'planning' }))
    console.log('roundtrip clicked planning')
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Skill instructions' }).textContent).toContain('Source planning instructions'))
    console.log('roundtrip planning loaded')
    expect(screen.getByRole('textbox', { name: 'Name' }).textContent).toBe('planning')

    fireEvent.click(screen.getByRole('button', { name: 'Review draft title' }))
    console.log('roundtrip clicked review')
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Skill instructions' }).textContent).toContain('Review draft instructions'))
    console.log('roundtrip review loaded')
    expect(screen.getByRole('textbox', { name: 'Name' }).textContent).toBe('Review draft title')
    expect(screen.getAllByText('Review draft title').length).toBeGreaterThan(0)
  })
})
