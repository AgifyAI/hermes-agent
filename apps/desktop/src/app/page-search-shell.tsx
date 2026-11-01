import type { ReactNode } from 'react'

import { SearchField } from '@/components/ui/search-field'
import { ResponsiveTabs } from '@/components/ui/tab-dropdown'
import { cn } from '@/lib/utils'

// Tabs are data, not nodes: the shell owns their presentation so every page
// gets the same behavior — a centered TextTab row on wide viewports that
// collapses into a dropdown when the header can't fit both search and tabs.
export interface PageShellTab {
  id: string
  label: string
  /** Count badge. `null` = still loading (renders a skeleton); `undefined` = no badge. */
  meta?: string | number | null
}

interface PageSearchShellProps extends React.ComponentProps<'section'> {
  children: ReactNode
  tabs?: PageShellTab[]
  activeTab?: string
  onTabChange?: (id: string) => void
  /** Secondary filters shown full-width on their own row below (expands). */
  filters?: ReactNode
  /** Header search; a shell that hides it (or whose tabs own their search) omits these. */
  onSearchChange?: (value: string) => void
  searchPlaceholder?: string
  /** Data-derived rotating placeholder nudges (see SearchField.hints). */
  searchHints?: string[]
  searchValue?: string
  /** Hide the search field when there's nothing to search (empty dataset). */
  searchHidden?: boolean
  /** Right-aligned control in the header's trailing cell (e.g. a refresh button)
   *  so mouse users get a visible affordance for the refresh hotkey. */
  searchTrailingAction?: ReactNode
}

function ShellTabs({
  tabs,
  activeTab,
  onTabChange
}: {
  tabs: PageShellTab[]
  activeTab?: string
  onTabChange?: (id: string) => void
}) {
  return (
    <ResponsiveTabs
      onChange={id => onTabChange?.(id)}
      tabs={tabs}
      value={activeTab ?? tabs[0]?.id ?? ''}
      wideClassName="justify-center"
    />
  )
}

export function PageSearchShell({
  children,
  className,
  tabs,
  activeTab,
  onTabChange,
  filters,
  onSearchChange,
  searchPlaceholder,
  searchHints,
  searchValue,
  searchHidden = false,
  searchTrailingAction,
  ...props
}: PageSearchShellProps) {
  const hasTabs = (tabs?.length ?? 0) > 0
  const hasHeader = hasTabs || !searchHidden || Boolean(filters)

  return (
    <section
      {...props}
      className={cn('flex h-full min-w-0 flex-col overflow-hidden bg-(--linear-bg-panel)', className)}
    >
      {/*
        Header lives in the page body, below the window chrome (the shell floats
        traffic lights over the top titlebar-height strip, which the `pt` clears
        and leaves draggable). Search left, tabs centered on the page via the
        1fr/auto/1fr grid; the trailing 1fr keeps the center honest.
      */}
      {/*
        IMPORTANT: do NOT put `-webkit-app-region: drag` on this header. It spans
        full width over the band where the floating titlebar icon clusters live,
        and an overlapping OS drag region eats their clicks at the compositor
        level (pointer-events / no-drag carve-outs across separate stacking
        contexts don't reliably fix it on macOS). The shell already supplies a
        draggable titlebar strip that is `calc()`'d around the icon clusters
        (see app-shell.tsx), so window dragging still works here.
      */}
      <div
        className={cn(
          'shrink-0 pt-(--titlebar-height)',
          // One hairline under the whole header (Linear's header rule).
          hasHeader && 'border-b-[0.5px] border-(--linear-border-primary)'
        )}
      >
        {(hasTabs || !searchHidden) && (
          // Linear's page header: 44px, 8px left / 12px right, hairline below.
          <div className="grid h-11 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 pr-3 pl-2">
            <div className="flex min-w-0 items-center justify-start">
              {!searchHidden && onSearchChange && (
                <SearchField
                  containerClassName="w-64 max-w-[45vw]"
                  hints={searchHints}
                  onChange={onSearchChange}
                  placeholder={searchPlaceholder ?? ''}
                  value={searchValue ?? ''}
                  variant="box"
                />
              )}
            </div>
            {hasTabs ? (
              <div className="flex min-w-0 items-center justify-center" data-tour="page-tabs">
                <ShellTabs activeTab={activeTab} onTabChange={onTabChange} tabs={tabs!} />
              </div>
            ) : (
              <span />
            )}
            <div className="flex min-w-0 items-center justify-end gap-1.5">
              {searchTrailingAction}
            </div>
          </div>
        )}
        {filters ? <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pr-3 pb-2 pl-2">{filters}</div> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden bg-(--linear-bg-panel)">{children}</div>
    </section>
  )
}
