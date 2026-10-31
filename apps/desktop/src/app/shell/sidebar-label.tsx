import type * as React from 'react'

import { cn } from '@/lib/utils'

interface SidebarPanelLabelProps extends React.ComponentProps<'span'> {
  dotClassName?: string
  meta?: React.ReactNode
}

export function SidebarPanelLabel({ children, className, dotClassName, meta, ...props }: SidebarPanelLabelProps) {
  return (
    <span
      className={cn(
        // Linear-style section label: quiet sentence case, neutral gray — the
        // label groups rows, it is not an accent. No tracking, no micro-caps.
        'flex min-w-0 items-center gap-1.5 pl-2 text-xs font-medium tracking-normal text-(--ui-text-tertiary)',
        className
      )}
      {...props}
    >
      {dotClassName ? (
        <span aria-hidden="true" className={cn('inline-block size-1.5 shrink-0 rounded-full', dotClassName)} />
      ) : null}
      <span className="min-w-0 truncate leading-none">{children}</span>
      {meta && <span className="shrink-0 text-[0.6875rem] font-medium text-(--ui-text-quaternary)">{meta}</span>}
    </span>
  )
}
