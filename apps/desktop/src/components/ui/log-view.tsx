import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

// Shared raw-log viewer: no bg, hairline border, tight padding, small mono.
// One style everywhere we surface logs. Pass a max-h-* via className.
// Selectable by default — logs exist to be read and copied.
export function LogView({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'overflow-auto rounded-(--linear-radius-control) border-[0.5px] border-(--linear-border-secondary) bg-(--linear-bg-secondary) px-2.5 py-1.5 font-mono text-[0.6875rem] leading-[1.5] whitespace-pre-wrap break-words text-(--linear-text-tertiary)',
        className
      )}
      data-selectable-text="true"
      {...props}
    />
  )
}
