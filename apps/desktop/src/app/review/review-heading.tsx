import type { ReactNode } from 'react'

import { Codicon } from '@/components/ui/codicon'
import type { HermesReviewShipInfo } from '@/global'
import { cn } from '@/lib/utils'

export interface ReviewHeadingProps {
  /** The branch currently checked out in the repository. */
  branch: null | string
  /** The repository cwd used for this Review surface, not the active tile's cwd. */
  cwd: null | string
  /** The repository's real default branch, used only for old gateways without PR base metadata. */
  defaultBranch?: null | string
  actions?: ReactNode
  shipInfo: HermesReviewShipInfo
}

function clean(value: null | string | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function repositoryName(cwd: null | string): string {
  const value = clean(cwd).replace(/[\\/]+$/, '')

  if (!value) {
    return 'Review'
  }

  return value.split(/[\\/]/).pop() || 'Review'
}

function ReviewBranchLine({
  author,
  base,
  branch,
  head
}: {
  author: string
  base: string
  branch: string
  head: string
}) {
  const displayedHead = head || branch

  if (!author && !base && !displayedHead) {
    return null
  }

  return (
    <div
      className="flex min-w-0 items-center gap-1.5 truncate text-[0.6875rem] leading-4 text-(--linear-text-tertiary)"
      data-review-heading-meta
    >
      {author && (
        <span className="shrink-0 truncate" data-review-heading-author title={author}>
          {author}
        </span>
      )}
      {author && (base || displayedHead) && <span aria-hidden="true">·</span>}
      {base && (
        <span className="shrink-0 truncate" data-review-heading-base title={base}>
          {base}
        </span>
      )}
      {base && displayedHead && <Codicon className="shrink-0 text-[0.625rem]!" name="arrow-left" />}
      {displayedHead && (
        <span className="min-w-0 truncate" data-review-heading-branch title={displayedHead}>
          {displayedHead}
        </span>
      )}
    </div>
  )
}

/**
 * The Review identity is separate from the diff tabs: it names the actual PR
 * when GitHub metadata exists, and otherwise names the repository and current
 * branch without inventing a ticket or author.
 */
export function ReviewHeading({ actions, branch, cwd, defaultBranch, shipInfo }: ReviewHeadingProps) {
  const pr = shipInfo.pr
  const title = clean(pr?.title) || repositoryName(cwd)
  const prNumber = pr?.number && pr.number > 0 ? String(pr.number) : ''
  const author = clean(pr?.author)
  const base = pr ? clean(pr.baseRefName) || clean(defaultBranch) : ''
  const head = pr ? clean(pr.headRefName) : ''
  const currentBranch = clean(branch)

  return (
    <header
      aria-label={title}
      className="review-workspace__header relative flex h-[38px] min-h-[38px] shrink-0 items-center gap-3 border-b-[0.5px] border-(--linear-border-primary) bg-(--linear-bg-panel) px-4"
      data-review-heading
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-(--linear-active-sidebar) text-(--linear-accent)">
        <Codicon name="git-pull-request" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h1
            className={cn(
              'min-w-0 truncate text-[0.9375rem] font-medium leading-5 text-(--linear-text-primary)',
              !pr?.title && 'text-(--linear-text-secondary)'
            )}
            data-review-heading-title
            title={title}
          >
            {title}
          </h1>
          {prNumber && (
            <a
              className="shrink-0 text-[0.6875rem] leading-4 text-(--linear-text-tertiary) transition-colors hover:text-(--linear-text-primary)"
              data-review-heading-pr
              href={pr?.url || undefined}
              onClick={event => {
                if (pr?.url) {
                  event.preventDefault()
                  void window.hermesDesktop?.openExternal?.(pr.url)
                }
              }}
              rel={pr?.url ? 'noreferrer' : undefined}
              target={pr?.url ? '_blank' : undefined}
              title={pr?.url || undefined}
            >
              #{prNumber}
            </a>
          )}
        </div>
        <ReviewBranchLine author={author} base={base} branch={currentBranch} head={head} />
      </div>
      {actions}
    </header>
  )
}
