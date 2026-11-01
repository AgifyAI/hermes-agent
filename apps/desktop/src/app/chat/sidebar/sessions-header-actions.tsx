import { useStore } from '@nanostores/react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { exitProjectScope } from '@/store/project-scope'
import { $newProjectDropPlacement, openProjectCreate } from '@/store/projects'
import { $unreadFinishedSessionIds, markAllSessionsRead } from '@/store/session'
import { ackAllSessionsRead } from '@/store/session-unread'

import type { NewSessionSplitHandler } from '../new-session-drag'

import { SidebarSectionAddButton } from './chrome'
import { SidebarFilterMenu } from './filter-menu'
import { ProjectMenu, type SidebarProjectTree, StartWorkButton } from './projects'

// Section-header action icons stay hidden until the whole header row is hovered
// (group/section lives on SidebarSectionHeader), mirroring the artifacts/file
// browser header affordances. focus-visible keeps them keyboard-reachable.
const HEADER_ACTION_BTN =
  'text-(--linear-icon) opacity-0 transition-opacity hover:bg-(--linear-hover-sidebar-icon) hover:text-(--linear-text-primary) group-hover/section:opacity-100 focus-visible:opacity-100'

// The view toggle (overview group toggle / in-project back) is the one control
// that stays visible at all times — it's the stable navigation affordance, not
// a hover-revealed action.
const HEADER_NAV_BTN =
  'text-(--linear-icon) opacity-70 transition-opacity hover:bg-(--linear-hover-sidebar-icon) hover:text-(--linear-text-primary) hover:opacity-100 focus-visible:opacity-100'

interface EnteredProjectActionsProps {
  activeProjectId: null | string
  project: SidebarProjectTree
}

function EnteredProjectActions({ activeProjectId, project }: EnteredProjectActionsProps) {
  const { t } = useI18n()
  const label = t.sidebar.showProjects

  return (
    <div className="group/workspace flex shrink-0 items-center gap-0.5">
      {project.path && <StartWorkButton repoPath={project.path} />}
      {/* Home has no folder and no record to rename, theme, or delete. */}
      {!project.isNoProject && (
        <ProjectMenu
          isActive={project.id === activeProjectId}
          onExitScope={exitProjectScope}
          project={project}
          scoped
        />
      )}
      <div className="grid size-6 place-items-center">
        <Tip label={label}>
          <Button
            aria-label={label}
            className={HEADER_NAV_BTN}
            onClick={event => {
              event.stopPropagation()
              exitProjectScope()
            }}
            size="icon-xs"
            variant="ghost"
          >
            <Codicon name="list-unordered" size="0.75rem" />
          </Button>
        </Tip>
      </div>
    </div>
  )
}

interface SessionsHeaderActionsProps {
  activeProjectId: null | string
  agentsGrouped: boolean
  // Set while a project is entered; its actions replace the add + filter pair.
  enteredProject?: SidebarProjectTree
  onNewSessionInWorkspace: (path: null | string) => void
  onNewSessionSplit: NewSessionSplitHandler
}

export function SessionsHeaderActions({
  activeProjectId,
  agentsGrouped,
  enteredProject,
  onNewSessionInWorkspace,
  onNewSessionSplit
}: SessionsHeaderActionsProps) {
  const { t } = useI18n()
  const s = t.sidebar
  const unreadCount = useStore($unreadFinishedSessionIds).length

  return (
    // One cluster, not a fragment: the header is justify-between,
    // so two children (mark-all + the rest) park the check-all in
    // the middle as a blank 24px hole until hover.
    <div className="flex shrink-0 items-center gap-0.5">
      {unreadCount > 0 && (
        <Tip label={s.markAllRead}>
          <Button
            aria-label={s.markAllRead}
            className={HEADER_ACTION_BTN}
            onClick={event => {
              event.stopPropagation()
              markAllSessionsRead()
              // Ack the persisted layer too, or the next list
              // refresh repaints every dot just dismissed.
              ackAllSessionsRead()
            }}
            size="icon-xs"
            variant="ghost"
          >
            <Codicon name="check-all" size="0.75rem" />
          </Button>
        </Tip>
      )}
      {enteredProject ? (
        <EnteredProjectActions activeProjectId={activeProjectId} project={enteredProject} />
      ) : (
        <>
          {/* The flat-list header "+" is a drag source too — the
              same gesture as the nav's "New session" row: drag
              it onto a chat zone's tab strip / edge / center to
              create the session exactly there. Project-overview
              mode drags its "+" (the "New project" button) with
              the project-drag variant: a drop opens the SAME
              project dialog, and the created project starts at
              the dropped spot. */}
          <SidebarSectionAddButton
            ariaLabel={agentsGrouped ? s.projects.newButton : s.nav['new-session']}
            onNewProjectDrag={
              agentsGrouped
                ? {
                    // Dragging the "New project" + arms WHERE the
                    // project should start; the dialog flow consumes
                    // it on create (see $newProjectDropPlacement).
                    onArm: placement => $newProjectDropPlacement.set(placement)
                  }
                : undefined
            }
            onNewSessionSplit={agentsGrouped ? undefined : onNewSessionSplit}
            onPlainClick={() => {
              if (agentsGrouped) {
                openProjectCreate()
              } else {
                onNewSessionInWorkspace(null)
              }
            }}
          />
          <div className="grid size-6 place-items-center">
            <SidebarFilterMenu className={HEADER_NAV_BTN} />
          </div>
        </>
      )}
    </div>
  )
}
