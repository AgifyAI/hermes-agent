import * as React from 'react'

import { cn } from '@/lib/utils'

function TextTabMeta({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn('text-[0.6875rem] font-[450] text-(--linear-text-tertiary) tabular-nums', className)}
      {...props}
    />
  )
}

interface TextTabProps extends React.ComponentProps<'button'> {
  active?: boolean
}

function TextTab({ active = false, children, className, type = 'button', ...props }: TextTabProps) {
  return (
    <button
      className={cn(
        // Linear's segmented tab, same as TabsTrigger: 28px pill, 12px/500.
        'inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap transition-colors duration-(--linear-speed-quick) hover:text-(--linear-text-primary) focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--linear-focus) disabled:pointer-events-none disabled:opacity-60',
        active
          ? 'bg-(--linear-segment-selected) text-(--linear-text-primary)'
          : 'bg-(--linear-segment-rest) text-(--linear-text-tertiary)',
        className
      )}
      data-active={active}
      type={type}
      {...props}
    >
      {children}
    </button>
  )
}

export { TextTab, TextTabMeta }
