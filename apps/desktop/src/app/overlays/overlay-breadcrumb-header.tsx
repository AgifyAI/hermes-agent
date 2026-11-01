import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { ChevronRight } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { PAGE_INSET_X } from '../layout-constants'

import type { OverlayNavGroup, OverlayNavLink } from './overlay-split-layout'

interface OverlayBreadcrumbHeaderProps {
  child?: OverlayNavLink
  /** A child's own sub-page (third nav level). */
  grandchild?: OverlayNavLink
  group: OverlayNavGroup
  rootLabel: string
  trailing?: ReactNode
}

export function OverlayBreadcrumbHeader({
  child,
  grandchild,
  group,
  rootLabel,
  trailing
}: OverlayBreadcrumbHeaderProps) {
  return (
    <div className={cn('mb-3 flex shrink-0 items-start justify-between gap-3', PAGE_INSET_X)}>
      {/* Linear's header breadcrumb: 13px/500, ancestors tertiary, the
          current page primary, 14px chevrons in the quaternary ink. */}
      <nav
        aria-label={group.label}
        className="flex min-h-7 min-w-0 items-center gap-1.5 text-[0.8125rem] font-medium text-(--linear-text-tertiary)"
      >
        <span className="shrink-0">{rootLabel}</span>
        <ChevronRight aria-hidden className="size-3.5 shrink-0 text-(--linear-text-quaternary)" />
        {child ? (
          <>
            <Button className="text-[0.8125rem]" onClick={group.onSelect} size="inline" variant="text">
              {group.label}
            </Button>
            <ChevronRight aria-hidden className="size-3.5 shrink-0 text-(--linear-text-quaternary)" />
            {grandchild ? (
              <>
                <Button
                  className="min-w-0 truncate text-[0.8125rem]"
                  onClick={child.onSelect}
                  size="inline"
                  variant="text"
                >
                  {child.label}
                </Button>
                <ChevronRight aria-hidden className="size-3.5 shrink-0 text-(--linear-text-quaternary)" />
                <span aria-current="page" className="truncate text-(--linear-text-primary)">
                  {grandchild.label}
                </span>
              </>
            ) : (
              <span aria-current="page" className="truncate text-(--linear-text-primary)">
                {child.label}
              </span>
            )}
          </>
        ) : (
          <span aria-current="page" className="truncate text-(--linear-text-primary)">
            {group.label}
          </span>
        )}
      </nav>
      {trailing && <div className="flex shrink-0 items-center">{trailing}</div>}
    </div>
  )
}
