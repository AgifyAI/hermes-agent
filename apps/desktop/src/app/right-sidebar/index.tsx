import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useState } from 'react'

import { TreeSkeleton } from '@/components/chat/skeletons'
import { ErrorBoundary } from '@/components/error-boundary'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { useDelayedTrue } from '@/hooks/use-delayed-true'
import { useI18n } from '@/i18n'
import { normalizeOrLocalPreviewTarget } from '@/lib/local-preview'
import { cn } from '@/lib/utils'
import { refreshRepoStatus, registerRepoStatusCwd } from '@/store/coding-status'
import { $panesFlipped, $revealInTreeRequest } from '@/store/layout'
import { notifyError } from '@/store/notifications'
import { openPreview } from '@/store/preview'
import { openFolderAsProject } from '@/store/projects'
import { $focusedWorkspaceCwd } from '@/store/session-states'

import { SidebarPanelLabel } from '../shell/sidebar-label'

import { ProjectTree } from './files/tree'
import { useProjectTree } from './files/use-project-tree'
import { GoalSection } from './goal-section'
import { MemorySection } from './memory-section'
import { QueueSection } from './queue-section'
import { ScratchpadSection } from './scratchpad'
import { SIDEBAR_CARD_CLASS, SidebarSectionContent, SidebarSectionHeader, SidebarSectionToggle } from './section-header'

export { SidebarSectionHeader as RightSidebarSectionHeader } from './section-header'

interface RightSidebarPaneProps {
  fitContent?: boolean
  onActivateFile: (path: string) => void
  onActivateFolder: (path: string) => void
}

export function RightSidebarPane({ fitContent = false, onActivateFile, onActivateFolder }: RightSidebarPaneProps) {
  const { t } = useI18n()
  const r = t.rightSidebar
  const [filesOpen, setFilesOpen] = useState(false)
  useEffect(
    () =>
      $revealInTreeRequest.subscribe(path => {
        if (path) {
          setFilesOpen(true)
        }
      }),
    []
  )
  const panesFlipped = useStore($panesFlipped)
  const targetCwd = useStore($focusedWorkspaceCwd)
  const hasWorkspace = Boolean(targetCwd)

  const {
    collapseAll,
    collapseNonce,
    data,
    effectiveCwd,
    loadChildren,
    openState,
    refreshRoot,
    rootError,
    rootLoading,
    setNodeOpen,
    setShowIgnored,
    showIgnored
  } = useProjectTree(hasWorkspace ? targetCwd : '')

  useEffect(() => {
    const activeCwd = effectiveCwd || (hasWorkspace ? targetCwd : '')

    if (!activeCwd) {
      return
    }

    return registerRepoStatusCwd(activeCwd)
  }, [effectiveCwd, hasWorkspace, targetCwd])

  const handleRefresh = useCallback(() => {
    void refreshRoot()
    const activeCwd = effectiveCwd || (hasWorkspace ? targetCwd : '')

    if (activeCwd) {
      void refreshRepoStatus(activeCwd)
    }
  }, [effectiveCwd, hasWorkspace, refreshRoot, targetCwd])

  const cwdName =
    effectiveCwd
      .split(/[\\/]+/)
      .filter(Boolean)
      .pop() ?? effectiveCwd

  const canCollapse = Object.values(openState).some(Boolean)

  const previewFile = async (path: string) => {
    try {
      const preview = await normalizeOrLocalPreviewTarget(path, effectiveCwd || undefined)

      if (!preview) {
        throw new Error(r.couldNotPreview(path))
      }

      openPreview(preview)
    } catch (error) {
      notifyError(error, r.previewUnavailable)
    }
  }

  return (
    <aside
      aria-label={r.aria}
      className={cn(
        'before:pointer-events-none relative flex w-full min-w-0 flex-col gap-2 overflow-y-auto overflow-x-hidden border-(--linear-border-panel) bg-(--linear-bg-panel) px-2 pb-2 pt-(--titlebar-height) text-(--linear-text-tertiary)',
        fitContent ? 'h-auto' : 'h-full',
        panesFlipped ? 'border-r-[0.5px]' : 'border-l-[0.5px]'
      )}
    >
      <section aria-label={r.automationsTitle} className="flex shrink-0 flex-col gap-1.5">
        <SidebarPanelLabel className="pl-2">{r.automationsTitle}</SidebarPanelLabel>
        <GoalSection />
      </section>
      <ScratchpadSection />
      <MemorySection />
      <QueueSection />
      <section className={cn(SIDEBAR_CARD_CLASS, 'flex min-h-0 shrink-0 flex-col', filesOpen && 'h-1/2')}>
        <SidebarSectionHeader>
          <SidebarSectionToggle onClick={() => setFilesOpen(open => !open)} open={filesOpen}>
            {t.sidebar.files}
          </SidebarSectionToggle>
        </SidebarSectionHeader>
        <SidebarSectionContent className={cn('min-h-0', filesOpen && 'flex-1')} open={filesOpen}>
          <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto">
            <FilesystemTab
              canCollapse={canCollapse}
              collapseNonce={collapseNonce}
              cwd={effectiveCwd}
              cwdName={cwdName}
              data={data}
              error={rootError}
              hasWorkspace={hasWorkspace}
              loading={rootLoading}
              onActivateFile={onActivateFile}
              onActivateFolder={onActivateFolder}
              onCollapseAll={collapseAll}
              onLoadChildren={loadChildren}
              onNodeOpenChange={setNodeOpen}
              onPreviewFile={previewFile}
              onRefresh={handleRefresh}
              onToggleShowIgnored={() => setShowIgnored(!showIgnored)}
              openState={openState}
              showIgnored={showIgnored}
            />
          </div>
        </SidebarSectionContent>
      </section>
    </aside>
  )
}

interface FilesystemTabProps extends FileTreeBodyProps {
  canCollapse: boolean
  cwdName: string
  hasWorkspace: boolean
  onCollapseAll: () => void
  onRefresh: () => void
  onToggleShowIgnored: () => void
  showIgnored: boolean
}

// Linear sidebar icon buttons + hover-reveal: header actions stay reachable while moving
// from the project label to the action buttons.
const HEADER_ACTION_CLASS =
  'text-(--linear-text-tertiary) hover:bg-(--linear-hover-sidebar-icon)! hover:text-(--linear-text-primary)! focus-visible:bg-(--linear-hover-sidebar-icon)! focus-visible:text-(--linear-text-primary)!'

const HEADER_ACTION_LABEL_REVEAL = `${HEADER_ACTION_CLASS} pointer-events-none opacity-0 transition-opacity focus-visible:pointer-events-auto focus-visible:opacity-100 group-focus-within/project-header:pointer-events-auto group-focus-within/project-header:opacity-100 group-hover/project-header:pointer-events-auto group-hover/project-header:opacity-100`

function FilesystemTab({
  canCollapse,
  collapseNonce,
  cwd,
  cwdName,
  data,
  error,
  hasWorkspace,
  loading,
  onActivateFile,
  onActivateFolder,
  onCollapseAll,
  onLoadChildren,
  onNodeOpenChange,
  onPreviewFile,
  onRefresh,
  onToggleShowIgnored,
  openState,
  showIgnored
}: FilesystemTabProps) {
  const { t } = useI18n()
  const r = t.rightSidebar

  // No working directory (a bare/detached chat) → no tree, but keep a way back
  // into a folder (#53004): the projects paradigm removed the old folder picker,
  // which stranded global sessions on a dead-end "No project open" pane. The
  // affordance is the project-shaped one — ⌘O's open-folder-as-project flow,
  // which upserts/enters the project and anchors a fresh session at the picked
  // folder — entirely decoupled from $currentCwd.
  if (!hasWorkspace) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
        <SidebarPanelLabel className="pl-0 text-(--linear-text-quaternary)">{r.noProjectOpen}</SidebarPanelLabel>
        <Button onClick={() => void openFolderAsProject()} variant="outline">
          <Codicon name="folder-opened" size="0.875rem" />
          {r.openFolder}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SidebarSectionHeader>
        <div className="flex min-w-0 flex-1">
          <SidebarPanelLabel>{cwdName}</SidebarPanelLabel>
        </div>
        <Tip label={showIgnored ? r.hideIgnored : r.showIgnored}>
          <Button
            aria-label={showIgnored ? r.hideIgnored : r.showIgnored}
            aria-pressed={showIgnored}
            // Stays visible while active: the tree is showing more than the
            // repo does, and that has to be legible without hovering.
            className={showIgnored ? HEADER_ACTION_CLASS : HEADER_ACTION_LABEL_REVEAL}
            onClick={onToggleShowIgnored}
            size="icon-xs"
            variant="ghost"
          >
            <Codicon name={showIgnored ? 'eye' : 'eye-closed'} size="0.875rem" />
          </Button>
        </Tip>
        <Tip label={r.refreshTree}>
          <Button
            aria-label={r.refreshTree}
            className={HEADER_ACTION_LABEL_REVEAL}
            disabled={loading}
            onClick={onRefresh}
            size="icon-xs"
            variant="ghost"
          >
            <Codicon name="refresh" size="0.875rem" spinning={loading} />
          </Button>
        </Tip>
        <Tip label={r.collapseAll}>
          <Button
            aria-label={r.collapseAll}
            className={cn(HEADER_ACTION_CLASS, !canCollapse && 'pointer-events-none opacity-0')}
            disabled={!canCollapse}
            onClick={onCollapseAll}
            size="icon-xs"
            variant="ghost"
          >
            <Codicon name="collapse-all" size="0.875rem" />
          </Button>
        </Tip>
      </SidebarSectionHeader>
      <FileTreeBody
        collapseNonce={collapseNonce}
        cwd={cwd}
        data={data}
        error={error}
        loading={loading}
        onActivateFile={onActivateFile}
        onActivateFolder={onActivateFolder}
        onLoadChildren={onLoadChildren}
        onNodeOpenChange={onNodeOpenChange}
        onPreviewFile={onPreviewFile}
        onRetry={onRefresh}
        openState={openState}
      />
    </div>
  )
}

interface FileTreeBodyProps {
  collapseNonce: number
  cwd: string
  data: ReturnType<typeof useProjectTree>['data']
  error: string | null
  loading: boolean
  onActivateFile: (path: string) => void
  onActivateFolder: (path: string) => void
  onLoadChildren: (id: string) => void | Promise<void>
  onNodeOpenChange: (id: string, open: boolean) => void
  onPreviewFile?: (path: string) => void
  /** Force-reload the root. The hook also auto-retries while errored, so this
   *  is the impatient-user path. */
  onRetry?: () => void
  openState: ReturnType<typeof useProjectTree>['openState']
}

function FileTreeBody({
  collapseNonce,
  cwd,
  data,
  error,
  loading,
  onActivateFile,
  onActivateFolder,
  onLoadChildren,
  onNodeOpenChange,
  onPreviewFile,
  onRetry,
  openState
}: FileTreeBodyProps) {
  const { t } = useI18n()
  const r = t.rightSidebar
  // Stay blank for a beat, then skeleton — so a fast project switch doesn't
  // flash a jarring loading state.
  const showSkeleton = useDelayedTrue(loading && data.length === 0)

  if (!cwd) {
    return <EmptyState body={r.noProjectBody} title={r.noProjectTitle} />
  }

  if (error) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
        <EmptyState body={r.unreadableBody(error)} title={r.unreadableTitle} />
        {onRetry && (
          <Button onClick={onRetry} size="inline" type="button" variant="text">
            {r.tryAgain}
          </Button>
        )}
      </div>
    )
  }

  if (loading && data.length === 0) {
    return showSkeleton ? <FileTreeLoadingState /> : <div className="min-h-0 flex-1" />
  }

  if (data.length === 0) {
    return <EmptyState body={r.emptyBody} title={r.emptyTitle} />
  }

  return (
    <ErrorBoundary
      fallback={({ reset }) => (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <EmptyState body={r.treeErrorBody} title={r.treeErrorTitle} />
          <Button onClick={reset} size="inline" type="button" variant="text">
            {r.tryAgain}
          </Button>
        </div>
      )}
      key={cwd}
      label="file-tree"
    >
      <ProjectTree
        collapseNonce={collapseNonce}
        cwd={cwd}
        data={data}
        onActivateFile={onActivateFile}
        onActivateFolder={onActivateFolder}
        onLoadChildren={onLoadChildren}
        onNodeOpenChange={onNodeOpenChange}
        onPreviewFile={onPreviewFile}
        openState={openState}
      />
    </ErrorBoundary>
  )
}

function FileTreeLoadingState() {
  const { t } = useI18n()

  return (
    <div aria-label={t.rightSidebar.loadingTree} className="min-h-0 flex-1" role="status">
      <TreeSkeleton />
    </div>
  )
}

// Terse pane empty state ("No files" / "No diffs"): the panel label itself —
// same uppercase/tracking + dither dot — just muted instead of theme-primary,
// centered. Shared by the file tree and review panes so both read identically.
export function PaneEmptyState({ label }: { label: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-4">
      <SidebarPanelLabel className="pl-0 text-(--linear-text-quaternary)">{label}</SidebarPanelLabel>
    </div>
  )
}

// Richer empty/error state (title + body) for the file tree's read failures.
export function EmptyState({ body, title }: { body: string; title?: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-4 text-center">
      {title && <div className="text-[0.8125rem] font-medium text-(--linear-text-secondary)">{title}</div>}
      <div className="text-xs leading-relaxed text-(--linear-text-tertiary)">{body}</div>
    </div>
  )
}
