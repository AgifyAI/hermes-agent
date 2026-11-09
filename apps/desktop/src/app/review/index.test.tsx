// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HermesReviewFile } from '@/global'
import { I18nProvider } from '@/i18n'
import {
  $reviewFiles,
  $reviewIsRepo,
  $reviewLoading,
  $reviewRevision,
  $reviewScopeCwd,
  $reviewSelectedPath
} from '@/store/review'
import { $currentCwd } from '@/store/session'

import { ReviewView } from './index'

vi.mock('../right-sidebar/review/ship-bar', () => ({ ReviewShipBar: () => null }))
vi.mock('@/components/chat/diff-lines', () => ({
  FileDiffPanel: ({ path }: { path?: string }) => <div data-testid={`diff-${path ?? 'unknown'}`} />
}))

function file(path: string, over: Partial<HermesReviewFile> = {}): HermesReviewFile {
  return { added: 2, path, removed: 1, staged: false, status: 'M', ...over }
}

function renderReview() {
  return render(
    <MemoryRouter>
      <I18nProvider configClient={null} initialLocale="en">
        <ReviewView />
      </I18nProvider>
    </MemoryRouter>
  )
}

describe('ReviewView file cards', () => {
  let diffTextByPath: Record<string, string>

  beforeEach(() => {
    diffTextByPath = {}
    $currentCwd.set('/repo')
    $reviewFiles.set([])
    $reviewIsRepo.set(true)
    $reviewLoading.set(false)
    $reviewRevision.set(0)
    $reviewScopeCwd.set(null)
    $reviewSelectedPath.set(null)
    ;(window as unknown as { hermesDesktop?: unknown }).hermesDesktop = {
      git: {
        review: {
          diff: vi.fn(async (_cwd: string, path: string) => diffTextByPath[path] ?? `@@ -1 +1 @@\n-old\n+${path}`),
          list: vi.fn(async () => ({ files: [file('src/a.ts'), file('src/b.ts', { status: 'A' })] })),
          shipInfo: vi.fn(async () => ({ ghReady: false, pr: null }))
        }
      }
    }
  })

  afterEach(() => {
    cleanup()
    delete (window as unknown as { hermesDesktop?: unknown }).hermesDesktop
  })

  it('opens two Guide cards independently and tracks Reviewed by the real file diff', async () => {
    renderReview()

    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(2))

    const cards = screen.getAllByRole('article')
    const firstFileButton = within(cards[0]).getByRole('button', { name: /a\.ts/ })
    const secondFileButton = within(cards[1]).getByRole('button', { name: /b\.ts/ })

    await waitFor(() => {
      expect(screen.getByTestId('diff-src/a.ts')).toBeTruthy()
      expect(screen.getByTestId('diff-src/b.ts')).toBeTruthy()
    })

    expect(firstFileButton.getAttribute('aria-expanded')).toBe('true')
    expect(secondFileButton.getAttribute('aria-expanded')).toBe('true')

    const firstReviewed = within(cards[0]).getByRole('checkbox', { name: 'Reviewed src/a.ts' }) as HTMLInputElement
    const secondReviewed = within(cards[1]).getByRole('checkbox', { name: 'Reviewed src/b.ts' }) as HTMLInputElement
    fireEvent.click(firstReviewed)
    expect(firstReviewed.checked).toBe(true)
    expect(secondReviewed.checked).toBe(false)

    fireEvent.click(firstFileButton)
    expect(screen.queryByTestId('diff-src/a.ts')).toBeNull()
    expect(screen.getByTestId('diff-src/b.ts')).toBeTruthy()

    act(() => {
      $reviewRevision.set($reviewRevision.get() + 1)
    })
    await waitFor(() => expect(screen.getByTestId('diff-src/b.ts')).toBeTruthy())
    expect(screen.queryByTestId('diff-src/a.ts')).toBeNull()

    act(() => {
      $reviewScopeCwd.set('/other-repo')
    })
    await waitFor(() =>
      expect((screen.getByRole('checkbox', { name: 'Reviewed src/a.ts' }) as HTMLInputElement).checked).toBe(false)
    )

    const otherRepoReviewed = screen.getByRole('checkbox', { name: 'Reviewed src/a.ts' }) as HTMLInputElement
    fireEvent.click(otherRepoReviewed)
    expect(otherRepoReviewed.checked).toBe(true)

    diffTextByPath['src/b.ts'] = '@@ -1 +1 @@\n-old-b\n+new-b'
    act(() => {
      $reviewRevision.set($reviewRevision.get() + 1)
    })
    await waitFor(() =>
      expect((screen.getByRole('checkbox', { name: 'Reviewed src/a.ts' }) as HTMLInputElement).checked).toBe(true)
    )

    diffTextByPath['src/a.ts'] = '@@ -1 +1 @@\n-old-a\n+new-a'
    act(() => {
      $reviewRevision.set($reviewRevision.get() + 1)
    })
    await waitFor(() =>
      expect((screen.getByRole('checkbox', { name: 'Reviewed src/a.ts' }) as HTMLInputElement).checked).toBe(false)
    )
  })

  it('keeps the other page selection when one Review view unmounts', async () => {
    const rendered = render(
      <MemoryRouter>
        <div data-testid="first-review">
          <ReviewView />
        </div>
        <div data-testid="second-review">
          <ReviewView />
        </div>
      </MemoryRouter>
    )

    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(4))
    const secondReview = within(screen.getByTestId('second-review'))
    fireEvent.click(secondReview.getByRole('button', { name: /^Diff$/ }))
    fireEvent.click(within(secondReview.getByRole('complementary')).getByRole('button', { name: /a\.ts/ }))

    await waitFor(() => expect($reviewSelectedPath.get()).toBe('src/a.ts'))

    rendered.rerender(
      <MemoryRouter>
        <div data-testid="second-review">
          <ReviewView />
        </div>
      </MemoryRouter>
    )

    expect($reviewSelectedPath.get()).toBe('src/a.ts')
  })
})
