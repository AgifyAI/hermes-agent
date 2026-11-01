import type { useSensors } from '@dnd-kit/core'
import type * as React from 'react'

import type { SessionInfo } from '@/hermes'

import type { NewSessionSplitHandler } from '../new-session-drag'

import { ProjectOverviewRow, type SidebarProjectTree } from './projects'
import { ReorderableList, useSortableBindings } from './reorderable-list'

type OverviewRowProps = React.ComponentProps<typeof ProjectOverviewRow>

function SortableProjectOverviewRow(props: OverviewRowProps) {
  return <ProjectOverviewRow {...props} {...useSortableBindings(props.project.id)} />
}

interface ProjectOverviewListProps {
  activeProjectId?: null | string
  dndSensors?: ReturnType<typeof useSensors>
  // The exclusion the previews were built with, plus how many of each
  // project's `sessionCount` it hides.
  hidden?: { isHidden: (session: SessionInfo) => boolean; counts: Record<string, number> }
  onEnterProject?: (id: string) => void
  onNewSession?: (path: null | string) => void
  onNewSessionSplit?: NewSessionSplitHandler
  onReorderProjects?: (ids: string[]) => void
  previews?: Record<string, SessionInfo[]>
  projects: SidebarProjectTree[]
  renderRowsFor: (project: SidebarProjectTree) => OverviewRowProps['renderRows']
}

// The model is already ordered (Home leads; then the default sort groups
// explicit-before-auto, with a manual drag-order winning when present).
// Render in that order and make rows drag-to-reorder when a handler is
// wired — Home stays outside the sortable list, it's a fixture.
export function ProjectOverviewList({
  activeProjectId,
  dndSensors,
  hidden,
  onEnterProject,
  onNewSession,
  onNewSessionSplit,
  onReorderProjects,
  previews,
  projects,
  renderRowsFor
}: ProjectOverviewListProps) {
  const home = projects[0]?.isNoProject ? projects[0] : undefined
  const sortableProjects = home ? projects.slice(1) : projects
  const projectsDraggable = sortableProjects.length > 1 && !!onReorderProjects
  const Row = projectsDraggable ? SortableProjectOverviewRow : ProjectOverviewRow

  const projectRow = (project: SidebarProjectTree, Component: typeof ProjectOverviewRow) => (
    <Component
      activeProjectId={activeProjectId}
      hiddenSessionCount={hidden?.counts[project.id]}
      isSessionHidden={hidden?.isHidden}
      key={project.id}
      onEnter={onEnterProject}
      onNewSession={onNewSession}
      onNewSessionSplit={onNewSessionSplit}
      // Keyed by project ID to match the producer: `overlayLivePreviews`
      // writes `out[node.id]` (workspace-groups.ts). A path key made Home
      // (path: null) and any id/path-divergent project fall back to stale
      // preview rows instead of the live overlay.
      previewSessions={previews?.[project.id]}
      project={project}
      renderRows={renderRowsFor(project)}
    />
  )

  const rows = sortableProjects.map(project => projectRow(project, Row))

  return (
    <>
      {home && projectRow(home, ProjectOverviewRow)}
      {projectsDraggable && onReorderProjects ? (
        <ReorderableList
          ids={sortableProjects.map(project => project.id)}
          onReorder={onReorderProjects}
          sensors={dndSensors}
        >
          {rows}
        </ReorderableList>
      ) : (
        rows
      )}
    </>
  )
}
