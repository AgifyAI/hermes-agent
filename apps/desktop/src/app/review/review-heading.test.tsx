// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { HermesReviewShipInfo } from '@/global'

import { ReviewHeading } from './review-heading'

describe('ReviewHeading', () => {
  it('uses the PR title, number, author, and real base/head branches', () => {
    const shipInfo: HermesReviewShipInfo = {
      ghReady: true,
      pr: {
        author: 'octocat',
        baseRefName: 'main',
        headRefName: 'feature/review-heading',
        number: 42,
        state: 'OPEN',
        title: 'Show the review identity',
        url: 'https://github.com/example/demo/pull/42'
      }
    }

    render(<ReviewHeading branch="feature/review-heading" cwd="/tmp/faux-repo" shipInfo={shipInfo} />)

    expect(screen.getByRole('heading', { name: 'Show the review identity' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '#42' }).getAttribute('href')).toBe(shipInfo.pr?.url)
    expect(screen.getByText('octocat')).toBeTruthy()
  })

  it('falls back to the repository and real branch without inventing PR metadata', () => {
    render(<ReviewHeading branch="worktree/fix" cwd="/tmp/faux-repo/" shipInfo={{ ghReady: false, pr: null }} />)

    expect(screen.getByRole('heading', { name: 'faux-repo' })).toBeTruthy()
    expect(screen.getByText('worktree/fix')).toBeTruthy()
    expect(screen.queryByRole('link', { name: '#17' })).toBeNull()
    expect(screen.queryByText('octocat')).toBeNull()
  })

  it('keeps old gateways readable and uses the local default branch only as a fallback', () => {
    render(
      <ReviewHeading
        branch="feature/old-gateway"
        cwd="C:\\work\\hermes-agent"
        defaultBranch="main"
        shipInfo={{
          ghReady: true,
          pr: { number: 17, state: 'OPEN', url: 'https://example.test/pull/17' }
        }}
      />
    )

    expect(screen.getByRole('heading', { name: 'hermes-agent' })).toBeTruthy()
    expect(screen.getByText('main')).toBeTruthy()
    expect(screen.getByText('feature/old-gateway')).toBeTruthy()
  })
})
