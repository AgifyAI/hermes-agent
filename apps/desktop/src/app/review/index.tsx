import './review.css'

import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { FileDiffPanel } from '@/components/chat/diff-lines'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { DiffCount } from '@/components/ui/diff-count'
import { Tip } from '@/components/ui/tooltip'
import type { HermesReviewFile, HermesReviewScope, HermesReviewShipInfo } from '@/global'
import { useI18n } from '@/i18n'
import { displayPath } from '@/lib/display-path'
import { cn } from '@/lib/utils'
import { repoStatusForCwd } from '@/store/coding-status'
import { notifyError } from '@/store/notifications'
import {
  $reviewDiff,
  $reviewDiffLoading,
  $reviewFiles,
  $reviewIsRepo,
  $reviewLoading,
  $reviewRevision,
  $reviewScope,
  $reviewScopeCwd,
  $reviewScopeTarget,
  $reviewSelectedPath,
  $reviewShipInfo,
  clearReviewSelection,
  closeReview,
  fetchReviewFileDiff,
  prepareReviewPage,
  refreshReview,
  selectReviewFile,
  stageReviewFile,
  unstageReviewFile
} from '@/store/review'
import { $currentCwd } from '@/store/session'

import { ReviewShipBar } from '../right-sidebar/review/ship-bar'

import { ReviewHeading } from './review-heading'

type ReviewTab = 'diff' | 'guide' | 'overview'

let mountedReviewViews = 0

const FILE_STATUS: Record<string, { icon: string; tone: string }> = {
  A: { icon: 'diff-added', tone: 'text-(--linear-green)' },
  C: { icon: 'diff-added', tone: 'text-(--linear-green)' },
  D: { icon: 'diff-removed', tone: 'text-(--linear-red)' },
  M: { icon: 'diff-modified', tone: 'text-(--linear-blue)' },
  R: { icon: 'diff-renamed', tone: 'text-(--linear-orange)' },
  U: { icon: 'warning', tone: 'text-(--linear-red)' },
  '?': { icon: 'diff-added', tone: 'text-(--linear-text-quaternary)' }
}

function fileTone(file: HermesReviewFile) {
  return FILE_STATUS[file.status] ?? FILE_STATUS.M
}

function reviewTotals(files: readonly HermesReviewFile[]) {
  return files.reduce(
    (totals, file) => ({ added: totals.added + file.added, removed: totals.removed + file.removed }),
    { added: 0, removed: 0 }
  )
}

function fileStatusLabel(file: HermesReviewFile, labels: Record<string, string>): string {
  if (file.status === '?') {
    return labels.untracked
  }

  if (file.status === 'A') {
    return labels.added
  }

  if (file.status === 'D') {
    return labels.deleted
  }

  if (file.status === 'R') {
    return labels.renamed
  }

  if (file.status === 'C') {
    return labels.copied
  }

  if (file.status === 'U') {
    return labels.unmerged
  }

  return labels.modified
}

function ReviewFileRow({
  file,
  selected,
  onSelect
}: {
  file: HermesReviewFile
  onSelect: () => void
  selected: boolean
}) {
  const tone = fileTone(file)

  return (
    <button
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'group flex min-h-9 w-full items-center gap-2 rounded-[8px] px-2 text-left text-[0.8125rem] transition-colors duration-(--linear-speed-quick)',
        selected
          ? 'bg-(--linear-active-sidebar) text-(--linear-text-primary)'
          : 'text-(--linear-text-secondary) hover:bg-(--linear-hover-row) hover:text-(--linear-text-primary)'
      )}
      data-review-file-row
      onClick={onSelect}
      type="button"
    >
      <Codicon className={cn('shrink-0 text-[0.875rem]!', tone.tone)} name={tone.icon} />
      <span className="min-w-0 flex-1 truncate" title={file.path}>
        {file.path}
      </span>
      <DiffCount added={file.added} className="shrink-0 text-[0.6875rem] leading-4 opacity-80" removed={file.removed} />
    </button>
  )
}

function ReviewScopeTabs() {
  const { t } = useI18n()
  const c = t.statusStack.coding
  const scope = useStore($reviewScope)

  const options = [
    ['uncommitted', c.scopeUncommitted],
    ['branch', c.scopeBranch],
    ['lastTurn', c.scopeLastTurn]
  ] as const

  return (
    <div
      className="flex shrink-0 items-center gap-1 border-b-[0.5px] border-(--linear-border-primary) px-3 py-1.5"
      data-review-scope-tabs
    >
      {options.map(([id, label]) => (
        <Button
          aria-pressed={scope === id}
          key={id}
          onClick={() => {
            $reviewScope.set(id)
            clearReviewSelection()
            void refreshReview({ force: true })
          }}
          size="xs"
          variant={scope === id ? 'secondary' : 'ghost'}
        >
          {label}
        </Button>
      ))}
    </div>
  )
}

function ReviewPatchCard({
  compact,
  diff,
  editable,
  expanded,
  file,
  loading,
  onReviewed,
  onToggle,
  reviewed
}: {
  compact?: boolean
  diff: null | string
  editable: boolean
  expanded: boolean
  file: HermesReviewFile
  loading: boolean
  onReviewed: (reviewed: boolean) => void
  onToggle: () => void
  reviewed: boolean
}) {
  const { t } = useI18n()
  const c = t.statusStack.coding
  const fileName = file.path.split('/').pop() || file.path

  return (
    <article
      className="review-file-card overflow-hidden rounded-(--linear-radius-card) border-[0.5px] border-(--linear-border-panel) bg-(--linear-bg-card) shadow-(--linear-shadow-card)"
      data-expanded={expanded ? 'true' : 'false'}
      data-slot="review-file-card"
    >
      <div className="review-file-card__header flex min-h-9 items-center gap-2 px-3" data-review-card-header>
        <button
          aria-expanded={expanded}
          className="group flex min-w-0 flex-1 items-center gap-2 rounded-[6px] py-1.5 text-left text-[0.8125rem] text-(--linear-text-primary) transition-colors duration-(--linear-speed-quick) hover:text-(--linear-accent)"
          data-review-card-toggle
          onClick={onToggle}
          type="button"
        >
          <Codicon
            className="shrink-0 text-(--linear-text-tertiary) transition-transform duration-(--linear-speed-quick)"
            name={expanded ? 'chevron-down' : 'chevron-right'}
          />
          <Codicon className={cn('shrink-0', fileTone(file).tone)} name={fileTone(file).icon} />
          <span className="review-file-card__filename min-w-0 truncate font-mono" data-review-filename title={file.path}>
            {fileName}
          </span>
          <span
            className="review-file-card__path min-w-0 truncate font-mono text-[0.6875rem] text-(--linear-text-quaternary)"
            data-review-path
          >
            {file.path === fileName ? '' : displayPath(file.path.slice(0, -fileName.length - 1))}
          </span>
        </button>
        <DiffCount added={file.added} removed={file.removed} />
        {editable && (
          <Tip label={file.staged ? c.unstage : c.stage}>
            <Button
              aria-label={file.staged ? c.unstage : c.stage}
              onClick={() =>
                void (file.staged ? unstageReviewFile(file.path) : stageReviewFile(file.path)).catch(error =>
                  notifyError(error, file.staged ? c.unstage : c.stage)
                )
              }
              size="icon-xs"
              variant="ghost"
            >
              <Codicon name={file.staged ? 'remove' : 'add'} size="0.875rem" />
            </Button>
          </Tip>
        )}
        <label
          className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[0.6875rem] text-(--linear-text-tertiary) transition-colors hover:text-(--linear-text-primary)"
          data-review-reviewed
          onClick={event => event.stopPropagation()}
        >
          <input
            aria-label={c.reviewPage.reviewedFile(file.path)}
            checked={reviewed}
            className="size-3 accent-(--linear-accent)"
            onChange={event => onReviewed(event.target.checked)}
            type="checkbox"
          />
          <span>{c.reviewPage.reviewed}</span>
        </label>
      </div>
      {expanded && (
        <div className="review-file-card__body border-t-[0.5px] border-(--linear-border-primary) p-2.5" data-review-card-body>
          {loading ? (
            <div className="grid min-h-24 place-items-center text-xs text-(--linear-text-tertiary)">
              {t.sidebar.loading}
            </div>
          ) : diff ? (
            <FileDiffPanel
              className={cn('mx-0 mb-0', compact ? 'max-h-[16rem]' : 'max-h-[28rem]')}
              diff={diff}
              path={file.path}
                showLineNumbers
              virtualized
            />
          ) : (
            <div className="grid min-h-24 place-items-center text-xs text-(--linear-text-tertiary)">{c.noDiff}</div>
          )}
        </div>
      )}
    </article>
  )
}

function ReviewDiff({
  diff,
  editable,
  expandedPath,
  files,
  loading,
  onReviewed,
  onToggle,
  reviewedPaths,
  scopeLabel
}: {
  diff: null | string
  editable: boolean
  expandedPath: null | string
  files: HermesReviewFile[]
  loading: boolean
  onReviewed: (path: string, reviewed: boolean) => void
  onToggle: (file: HermesReviewFile) => void
  reviewedPaths: ReadonlySet<string>
  scopeLabel: string
}) {
  const { t } = useI18n()
  const c = t.statusStack.coding
  const totals = reviewTotals(files)

  return (
    <div className="review-reading mx-auto flex h-full min-h-0 w-full max-w-[54rem] flex-col gap-5 overflow-y-auto px-6 py-8 lg:px-12">
      <div>
        <p className="review-reading__eyebrow mb-2 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-(--linear-text-tertiary)">
          {c.reviewPage.diffHeading(scopeLabel)}
        </p>
        <h1 className="review-reading__title text-[1.75rem] font-semibold leading-tight tracking-[-0.035em] text-(--linear-text-primary)">
          {files.length > 0 ? c.changed(files.length) : c.noChanges}
        </h1>
        <p className="review-reading__summary mt-3 max-w-[70ch] text-[0.875rem] leading-6 text-(--linear-text-secondary)">
          {files.length > 0 ? c.reviewPage.diffSummary(totals.added, totals.removed) : c.noDiff}
        </p>
      </div>
      <div className="grid gap-3">
        {files.map(file => (
          <ReviewPatchCard
            diff={expandedPath === file.path ? diff : null}
            editable={editable}
            expanded={expandedPath === file.path}
            file={file}
            key={file.path}
            loading={expandedPath === file.path && loading}
            onReviewed={reviewed => onReviewed(file.path, reviewed)}
            onToggle={() => onToggle(file)}
            reviewed={reviewedPaths.has(file.path)}
          />
        ))}
      </div>
    </div>
  )
}

function ReviewOverview({
  files,
  onSelect,
  scopeLabel
}: {
  files: HermesReviewFile[]
  onSelect: (file: HermesReviewFile) => void
  scopeLabel: string
}) {
  const { t } = useI18n()
  const c = t.statusStack.coding
  const totals = reviewTotals(files)

  return (
    <div className="review-reading mx-auto flex w-full max-w-[54rem] flex-col gap-7 px-6 py-10 lg:px-12">
      <div>
        <p className="review-reading__eyebrow mb-2 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-(--linear-text-tertiary)">
          {c.review}
        </p>
        <h1 className="review-reading__title text-[1.75rem] font-semibold leading-tight tracking-[-0.035em] text-(--linear-text-primary)">
          {c.title}
        </h1>
        <p className="review-reading__summary mt-3 max-w-[70ch] text-[0.875rem] leading-6 text-(--linear-text-secondary)">
          {files.length > 0
            ? c.reviewPage.overviewSummary(files.length, scopeLabel, totals.added, totals.removed)
            : c.clean}
        </p>
      </div>
      <section aria-labelledby="review-files-title">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[0.9375rem] font-medium text-(--linear-text-primary)" id="review-files-title">
            {files.length > 0 ? c.changed(files.length) : c.noChanges}
          </h2>
          <span className="text-[0.6875rem] text-(--linear-text-tertiary)">{scopeLabel}</span>
        </div>
        <div className="overflow-hidden rounded-(--linear-radius-card) border-[0.5px] border-(--linear-border-panel) bg-(--linear-bg-card) shadow-(--linear-shadow-card)">
          {files.length > 0 ? (
            files.map(file => (
              <button
                className="flex min-h-11 w-full items-center gap-3 border-b-[0.5px] border-(--linear-border-primary) px-4 text-left text-[0.8125rem] text-(--linear-text-secondary) transition-colors last:border-b-0 hover:bg-(--linear-hover-row) hover:text-(--linear-text-primary)"
                key={file.path}
                onClick={() => onSelect(file)}
                type="button"
              >
                <Codicon className={fileTone(file).tone} name={fileTone(file).icon} />
                <span className="min-w-0 flex-1 truncate" title={file.path}>
                  {file.path}
                </span>
                <span className="hidden text-[0.6875rem] text-(--linear-text-quaternary) sm:inline">
                  {fileStatusLabel(file, c.reviewPage.fileStatus)}
                </span>
                <DiffCount added={file.added} removed={file.removed} />
                <Codicon className="text-(--linear-text-quaternary)" name="chevron-right" />
              </button>
            ))
          ) : (
            <p className="px-4 py-8 text-center text-[0.8125rem] text-(--linear-text-tertiary)">{c.noChanges}</p>
          )}
        </div>
      </section>
    </div>
  )
}

function ReviewGuide({
  editable,
  expandedPaths,
  files,
  guideDiffs,
  guideLoadingPaths,
  onReviewed,
  onToggle,
  reviewedPaths,
  scopeLabel
}: {
  editable: boolean
  expandedPaths: ReadonlySet<string>
  files: HermesReviewFile[]
  guideDiffs: Readonly<Record<string, string>>
  guideLoadingPaths: ReadonlySet<string>
  onReviewed: (path: string, reviewed: boolean) => void
  onToggle: (file: HermesReviewFile) => void
  reviewedPaths: ReadonlySet<string>
  scopeLabel: string
}) {
  const { t } = useI18n()
  const c = t.statusStack.coding
  const totals = reviewTotals(files)

  return (
    <div className="review-reading mx-auto flex w-full max-w-[54rem] flex-col gap-7 px-6 py-10 lg:px-12">
      <div>
        <p className="review-reading__eyebrow mb-2 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-(--linear-text-tertiary)">
          {c.review}
        </p>
        <h1 className="review-reading__title text-[1.75rem] font-semibold leading-tight tracking-[-0.035em] text-(--linear-text-primary)">
          {c.reviewPage.guideTitle}
        </h1>
      </div>
      <section aria-labelledby="review-guide-files">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-[0.9375rem] font-medium text-(--linear-text-primary)" id="review-guide-files">
            {files.length > 0 ? c.changed(files.length) : c.noChanges}
          </h2>
          <span className="text-[0.6875rem] text-(--linear-text-tertiary)">{scopeLabel}</span>
        </div>
        {files.length > 0 ? (
          <div className="grid gap-3">
            {files.map(file => (
              <ReviewPatchCard
                compact
                diff={guideDiffs[file.path] ?? null}
                editable={editable}
                expanded={expandedPaths.has(file.path)}
                file={file}
                key={file.path}
                loading={guideLoadingPaths.has(file.path)}
                onReviewed={reviewed => onReviewed(file.path, reviewed)}
                onToggle={() => onToggle(file)}
                reviewed={reviewedPaths.has(file.path)}
              />
            ))}
          </div>
        ) : (
          <div className="review-empty rounded-(--linear-radius-card) border-[0.5px] border-(--linear-border-panel) bg-(--linear-bg-card) px-4 py-8 text-center text-[0.8125rem] text-(--linear-text-tertiary) shadow-(--linear-shadow-card)">
            {c.noChanges}
          </div>
        )}
        {files.length > 0 && (
          <p className="mt-3 text-[0.75rem] leading-5 text-(--linear-text-secondary)">
            {c.reviewPage.diffSummary(totals.added, totals.removed)}
          </p>
        )}
      </section>
    </div>
  )
}

interface ReviewWorkspaceProps {
  branch: string
  cwd: null | string
  defaultBranch: null | string
  diff: null | string
  diffLoading: boolean
  expandedGuidePaths: ReadonlySet<string>
  expandedPath: null | string
  files: HermesReviewFile[]
  guideDiffs: Readonly<Record<string, string>>
  guideLoadingPaths: ReadonlySet<string>
  isRepo: boolean
  loading: boolean
  onReviewed: (path: string, reviewed: boolean) => void
  onSelectFile: (file: HermesReviewFile) => void
  onTabChange: (tab: ReviewTab) => void
  onToggleFile: (file: HermesReviewFile) => void
  onToggleGuideFile: (file: HermesReviewFile) => void
  reviewedPaths: ReadonlySet<string>
  scope: HermesReviewScope
  scopeLabel: string
  selectedPath: null | string
  shipInfo: HermesReviewShipInfo
  tab: ReviewTab
}

function ReviewWorkspace({
  branch,
  cwd,
  defaultBranch,
  diff,
  diffLoading,
  expandedGuidePaths,
  expandedPath,
  files,
  guideDiffs,
  guideLoadingPaths,
  isRepo,
  loading,
  onReviewed,
  onSelectFile,
  onTabChange,
  onToggleFile,
  onToggleGuideFile,
  reviewedPaths,
  scope,
  scopeLabel,
  selectedPath,
  shipInfo,
  tab
}: ReviewWorkspaceProps) {
  const { t } = useI18n()
  const c = t.statusStack.coding
  const showFileRail = tab === 'diff'

  return (
    <section
      aria-label={c.review}
      className="review-workspace @container flex h-full min-h-0 w-full flex-col overflow-hidden bg-(--linear-bg-window)"
    >
      <ReviewHeading
        actions={
          <div className="flex items-center gap-1">
            <span className="text-[0.6875rem] text-(--linear-text-tertiary)" data-review-count>
              {isRepo ? (loading ? t.sidebar.loading : c.changed(files.length)) : c.notRepo}
            </span>
            <Tip label={t.rightSidebar.refreshTree}>
              <Button
                aria-label={t.rightSidebar.refreshTree}
                onClick={() => void refreshReview({ force: true })}
                size="icon-sm"
                variant="ghost"
              >
                <Codicon name="refresh" spinning={loading} />
              </Button>
            </Tip>
          </div>
        }
        branch={branch}
        cwd={cwd}
        defaultBranch={defaultBranch}
        shipInfo={shipInfo}
      />

      <nav
        aria-label={c.reviewPage.tabsLabel}
        className="review-workspace__tabs flex h-9 shrink-0 items-center gap-1 border-b-[0.5px] border-(--linear-border-primary) bg-(--linear-bg-panel) px-3"
      >
        {(['overview', 'guide', 'diff'] as const).map(view => (
          <Button
            aria-current={tab === view ? 'page' : undefined}
            key={view}
            onClick={() => onTabChange(view)}
            size="xs"
            variant={tab === view ? 'secondary' : 'ghost'}
          >
            {view === 'overview' ? c.reviewPage.overview : view === 'guide' ? c.reviewPage.guide : c.reviewPage.diff}
          </Button>
        ))}
      </nav>

      <div className="review-workspace__body grid min-h-0 flex-1 grid-cols-1 overflow-hidden @[72.5rem]:grid-cols-[minmax(12rem,16rem)_minmax(0,1fr)]">
        <aside
          aria-label={c.changed(files.length)}
          className="review-workspace__file-rail hidden min-h-0 flex-col border-r-[0.5px] border-(--linear-border-panel) bg-(--linear-bg-panel) @[72.5rem]:flex"
        >
          <ReviewScopeTabs />
          <div className="min-h-0 flex-1 overflow-y-auto p-2" data-review-file-list>
            {files.length > 0 ? (
              files.map(file => (
                <ReviewFileRow
                  file={file}
                  key={file.path}
                  onSelect={() => onSelectFile(file)}
                  selected={file.path === selectedPath}
                />
              ))
            ) : (
              <div className="px-2 py-8 text-center text-[0.75rem] text-(--linear-text-tertiary)">
                {loading ? t.sidebar.loading : isRepo ? c.noChanges : c.notRepo}
              </div>
            )}
          </div>
        </aside>

        <main className="review-workspace__content min-h-0 overflow-hidden bg-(--linear-bg-panel)">
          {showFileRail && files.length > 0 && (
            <label className="flex items-center gap-2 border-b-[0.5px] border-(--linear-border-primary) bg-(--linear-bg-panel) px-3 py-2 @[72.5rem]:hidden">
              <span className="sr-only">{c.changed(files.length)}</span>
              <select
                aria-label={c.changed(files.length)}
                className="min-w-0 flex-1 rounded-(--linear-radius-control) border-[0.5px] border-(--linear-border-panel) bg-(--linear-bg-card) px-2 py-1.5 text-[0.75rem] text-(--linear-text-primary) outline-none"
                onChange={event => {
                  const file = files.find(candidate => candidate.path === event.target.value)

                  if (file) {
                    onSelectFile(file)
                  }
                }}
                value={expandedPath ?? selectedPath ?? ''}
              >
                <option disabled value="">
                  {c.reviewPage.selectFile}
                </option>
                {files.map(file => (
                  <option key={file.path} value={file.path}>
                    {file.path}
                  </option>
                ))}
              </select>
            </label>
          )}
          {tab === 'overview' && (
            <div className="h-full overflow-y-auto">
              <ReviewOverview files={files} onSelect={onSelectFile} scopeLabel={scopeLabel} />
            </div>
          )}
          {tab === 'guide' && (
            <div className="h-full overflow-y-auto">
              <ReviewGuide
                editable={scope === 'uncommitted'}
                expandedPaths={expandedGuidePaths}
                files={files}
                guideDiffs={guideDiffs}
                guideLoadingPaths={guideLoadingPaths}
                onReviewed={onReviewed}
                onToggle={onToggleGuideFile}
                reviewedPaths={reviewedPaths}
                scopeLabel={scopeLabel}
              />
            </div>
          )}
          {tab === 'diff' && (
            <ReviewDiff
              diff={diff}
              editable={scope === 'uncommitted'}
              expandedPath={expandedPath}
              files={files}
              loading={diffLoading}
              onReviewed={onReviewed}
              onToggle={onToggleFile}
              reviewedPaths={reviewedPaths}
              scopeLabel={scopeLabel}
            />
          )}
        </main>
      </div>

      <div className="review-ship-bar shrink-0 border-t-[0.5px] border-(--linear-border-panel) bg-(--linear-bg-panel)">
        <div className="mx-auto w-full max-w-[54rem]">
          <ReviewShipBar />
        </div>
      </div>
    </section>
  )
}

export function ReviewView() {
  const { t } = useI18n()
  const c = t.statusStack.coding
  const files = useStore($reviewFiles)
  const loading = useStore($reviewLoading)
  const isRepo = useStore($reviewIsRepo)
  const selectedPath = useStore($reviewSelectedPath)
  const scope = useStore($reviewScope)
  const reviewRevision = useStore($reviewRevision)
  const shipInfo = useStore($reviewShipInfo)
  const scopeTarget = useStore($reviewScopeTarget)
  const diff = useStore($reviewDiff)
  const diffLoading = useStore($reviewDiffLoading)
  const pinnedCwd = useStore($reviewScopeCwd)
  const currentCwd = useStore($currentCwd)
  const cwd = pinnedCwd || currentCwd
  const status = useStore(repoStatusForCwd(cwd))
  const [tab, setTab] = useState<ReviewTab>('guide')
  const [expandedPath, setExpandedPath] = useState<null | string>(null)
  const [expandedGuidePaths, setExpandedGuidePaths] = useState<ReadonlySet<string>>(new Set())
  const [reviewedPaths, setReviewedPaths] = useState<ReadonlySet<string>>(new Set())
  const [reviewedDiffs, setReviewedDiffs] = useState<Readonly<Record<string, string>>>({})
  const [guideInitialLoaded, setGuideInitialLoaded] = useState(false)
  const [guideRefreshRevision, setGuideRefreshRevision] = useState<null | number>(null)

  const [guideDiffState, setGuideDiffState] = useState<{
    contextKey: string
    diffs: Readonly<Record<string, string>>
    loadingPaths: ReadonlySet<string>
  }>({
    contextKey: '',
    diffs: {},
    loadingPaths: new Set()
  })

  const guideRequests = useRef(new Map<string, Promise<string>>())

  const branch = status?.branch?.trim() || c.noBranch
  const scopeLabel = scope === 'branch' ? c.scopeBranch : scope === 'lastTurn' ? c.scopeLastTurn : c.scopeUncommitted
  const reviewContextKey = `${cwd ?? ''}:${scope}`
  const activeGuideDiffState = guideDiffState.contextKey === reviewContextKey ? guideDiffState : null
  const reviewContextKeyRef = useRef(reviewContextKey)
  const guideDiffStateRef = useRef(guideDiffState)
  reviewContextKeyRef.current = reviewContextKey
  guideDiffStateRef.current = guideDiffState

  useEffect(() => {
    prepareReviewPage(pinnedCwd, scopeTarget)
    void refreshReview({ force: true })
  }, [cwd, pinnedCwd, scopeTarget])

  useEffect(() => {
    mountedReviewViews += 1

    return () => {
      mountedReviewViews = Math.max(0, mountedReviewViews - 1)

      if (mountedReviewViews === 0) {
        closeReview()
      }
    }
  }, [])

  useEffect(() => {
    if (selectedPath && files.some(file => file.path === selectedPath)) {
      setExpandedPath(selectedPath)
    }
  }, [files, selectedPath])

  const selectFile = (file: HermesReviewFile) => {
    setTab('diff')
    setExpandedPath(file.path)
    void selectReviewFile(file)
  }

  const toggleFile = (file: HermesReviewFile) => {
    if (expandedPath === file.path) {
      setExpandedPath(null)

      if (selectedPath === file.path) {
        clearReviewSelection()
      }

      return
    }

    setExpandedPath(file.path)
    void selectReviewFile(file)
  }

  const requestGuideDiff = useCallback((file: HermesReviewFile, force = false) => {
    const contextKey = reviewContextKeyRef.current
    const currentGuideDiffState = guideDiffStateRef.current
    const requestKey = `${contextKey}:${file.path}`
    const knownDiff = currentGuideDiffState.contextKey === contextKey ? currentGuideDiffState.diffs[file.path] : undefined
    const inFlight = guideRequests.current.get(requestKey)

    if (inFlight) {
      return inFlight
    }

    if (!force && knownDiff !== undefined) {
      return Promise.resolve(knownDiff)
    }

    const request = fetchReviewFileDiff(file)
    guideRequests.current.set(requestKey, request)
    setGuideDiffState(current => {
      if (current.contextKey !== contextKey) {
        return current
      }

      const loadingPaths = new Set(current.loadingPaths)
      loadingPaths.add(file.path)

      return { ...current, loadingPaths }
    })

    void request.then(diff => {
      if (guideRequests.current.get(requestKey) === request) {
        guideRequests.current.delete(requestKey)
      }

      setGuideDiffState(current => {
        if (current.contextKey !== contextKey) {
          return current
        }

        const loadingPaths = new Set(current.loadingPaths)
        loadingPaths.delete(file.path)

        return { ...current, diffs: { ...current.diffs, [file.path]: diff }, loadingPaths }
      })
    })

    return request
  }, [])

  const toggleGuideFile = (file: HermesReviewFile) => {
    const wasExpanded = expandedGuidePaths.has(file.path)

    setExpandedGuidePaths(current => {
      const next = new Set(current)

      if (next.has(file.path)) {
        next.delete(file.path)
      } else {
        next.add(file.path)
      }

      return next
    })

    if (!wasExpanded) {
      requestGuideDiff(file)
    }
  }

  useEffect(() => {
    if (guideDiffState.contextKey === reviewContextKey) {
      return
    }

    setGuideInitialLoaded(false)
    setGuideRefreshRevision(reviewRevision)
    setExpandedPath(null)
    setExpandedGuidePaths(new Set())
    setReviewedPaths(new Set())
    setReviewedDiffs({})
    setGuideDiffState({ contextKey: reviewContextKey, diffs: {}, loadingPaths: new Set() })
  }, [guideDiffState.contextKey, reviewContextKey, reviewRevision])

  useEffect(() => {
    if (guideInitialLoaded || files.length === 0) {
      return
    }

    setGuideInitialLoaded(true)
    setGuideRefreshRevision(reviewRevision)
    const initialFiles = files.slice(0, 2)
    setExpandedGuidePaths(new Set(initialFiles.map(file => file.path)))

    for (const file of initialFiles) {
      void requestGuideDiff(file)
    }
  }, [files, guideInitialLoaded, requestGuideDiff, reviewRevision])

  useEffect(() => {
    if (!guideInitialLoaded || guideRefreshRevision === reviewRevision) {
      return
    }

    setGuideRefreshRevision(reviewRevision)
    const filesByPath = new Map(files.map(file => [file.path, file]))
    const pathsToRefresh = new Set([...expandedGuidePaths, ...reviewedPaths])
    setExpandedGuidePaths(current => new Set([...current].filter(path => filesByPath.has(path))))

    for (const path of reviewedPaths) {
      if (!filesByPath.has(path)) {
        setReviewedPaths(current => {
          const next = new Set(current)
          next.delete(path)

          return next
        })
        setReviewedDiffs(current => {
          const next = { ...current }
          delete next[path]

          return next
        })
      }
    }

    for (const path of pathsToRefresh) {
      const file = filesByPath.get(path)

      if (!file) {
        continue
      }

      void requestGuideDiff(file, true)?.then(nextDiff => {
        if (reviewedPaths.has(path) && reviewedDiffs[path] !== undefined && reviewedDiffs[path] !== nextDiff) {
          setReviewedPaths(current => {
            const next = new Set(current)
            next.delete(path)

            return next
          })
          setReviewedDiffs(current => {
            const next = { ...current }
            delete next[path]

            return next
          })
        }
      })
    }
  }, [expandedGuidePaths, files, guideInitialLoaded, guideRefreshRevision, requestGuideDiff, reviewRevision, reviewedDiffs, reviewedPaths])

  const setReviewed = (path: string, reviewed: boolean) => {
    if (!reviewed) {
      setReviewedPaths(current => {
        const next = new Set(current)
        next.delete(path)

        return next
      })
      setReviewedDiffs(current => {
        const next = { ...current }
        delete next[path]

        return next
      })

      return
    }

    const file = files.find(candidate => candidate.path === path)

    if (!file) {
      return
    }

    const contextKey = reviewContextKeyRef.current
    const knownDiff = guideDiffStateRef.current.contextKey === contextKey ? guideDiffStateRef.current.diffs[path] : undefined

    const applyReviewed = (baseline: string) => {
      if (reviewContextKeyRef.current !== contextKey) {
        return
      }

      setReviewedPaths(current => new Set(current).add(path))
      setReviewedDiffs(current => ({ ...current, [path]: baseline }))
    }

    if (knownDiff !== undefined) {
      applyReviewed(knownDiff)

      return
    }

    void requestGuideDiff(file)?.then(applyReviewed)
  }

  return (
    <ReviewWorkspace
      branch={branch}
      cwd={cwd}
      defaultBranch={status?.defaultBranch ?? null}
      diff={diff}
      diffLoading={diffLoading}
      expandedGuidePaths={expandedGuidePaths}
      expandedPath={expandedPath}
      files={files}
      guideDiffs={activeGuideDiffState?.diffs ?? {}}
      guideLoadingPaths={activeGuideDiffState?.loadingPaths ?? new Set()}
      isRepo={isRepo}
      loading={loading}
      onReviewed={setReviewed}
      onSelectFile={selectFile}
      onTabChange={setTab}
      onToggleFile={toggleFile}
      onToggleGuideFile={toggleGuideFile}
      reviewedPaths={reviewedPaths}
      scope={scope}
      scopeLabel={scopeLabel}
      selectedPath={selectedPath}
      shipInfo={shipInfo}
      tab={tab}
    />
  )
}
