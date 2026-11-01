import * as React from 'react'

import { Codicon, type CodiconProps } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

/**
 * Rounded surface for fenced code (and any equivalent: diffs, raw payloads,
 * etc.) sized for the conversation column. A Linear card: 10px radius, card
 * surface and one panel hairline — no header, no language label, no shadow
 * (code streams, so it never repaints a blur or glow).
 */
function CodeCard({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'group/code relative min-w-0 max-w-full overflow-hidden rounded-(--linear-radius-card) border-[0.5px] border-(--linear-border-panel) bg-(--linear-bg-card) [--expandable-fade-from:var(--linear-bg-card)] text-[length:var(--conversation-tool-font-size)] text-(--linear-text-tertiary)',
        className
      )}
      data-slot="code-card"
      {...props}
    />
  )
}

function CodeCardIcon({ className, ...props }: CodiconProps) {
  return (
    <Codicon
      className={cn('shrink-0 text-[0.875rem] leading-none text-(--linear-icon)', className)}
      data-slot="code-card-icon"
      {...props}
    />
  )
}

function CodeCardBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'font-mono text-[length:calc(0.7rem*var(--conversation-text-scale,1))] leading-relaxed text-(--linear-text-secondary) [&_pre]:m-0 [&_pre]:overflow-x-auto [&_pre]:scrollbar-overlay [&_pre]:bg-transparent! [&_pre]:px-2 [&_pre]:py-1.5 [&_pre]:font-mono [&_pre]:leading-relaxed',
        className
      )}
      data-slot="code-card-body"
      {...props}
    />
  )
}

export { CodeCard, CodeCardBody, CodeCardIcon }
