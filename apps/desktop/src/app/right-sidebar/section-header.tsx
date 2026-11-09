import type { ComponentProps } from 'react'

import { LinearDisclosure } from '@/components/ui/linear-disclosure'
import { cn } from '@/lib/utils'

/** The surface used by the project-side sections. Keep the elevation in one
 * place so Files, Memories, Queue and Scratchpad read as one family. */
export const SIDEBAR_CARD_CLASS =
  'overflow-hidden rounded-(--linear-radius-card) border-[0.5px] border-(--linear-border-panel) bg-(--linear-bg-card) shadow-(--linear-shadow-card) transition-[border-color] duration-(--linear-speed-quick) hover:border-(--linear-border-secondary) hover:transition-none'

/** Linear's disclosure glyph. */
export const SidebarDisclosure = LinearDisclosure

export function SidebarSectionHeader({ children, className, ...props }: ComponentProps<'div'>) {
  return (
    <div className={cn('group/project-header flex h-9 shrink-0 items-center px-3', className)} {...props}>
      {children}
    </div>
  )
}

export function SidebarSectionToggle({
  children,
  className,
  open,
  ...props
}: ComponentProps<'button'> & { open: boolean }) {
  return (
    <button
      {...props}
      aria-expanded={open}
      className={cn(
        '-mx-3 flex h-full min-w-0 flex-1 items-center gap-[5px] rounded-(--linear-radius-control) px-3 pt-0.5 text-left text-[0.8125rem] font-medium text-(--linear-text-tertiary) focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-(--linear-focus)',
        className
      )}
      type="button"
    >
      <span className="min-w-0 truncate">{children}</span>
      <SidebarDisclosure open={open} />
    </button>
  )
}

/** Height animation for sections whose content is already safe to keep mounted.
 * Keeping the DOM alive prevents a terminal/tree-like child from losing its
 * local state while the section is briefly closed. */
export function SidebarSectionContent({ children, className, open }: ComponentProps<'div'> & { open: boolean }) {
  return (
    <div
      aria-hidden={!open}
      className={cn(
        'grid min-h-0 transition-[grid-template-rows] duration-[150ms] ease-[ease] motion-reduce:transition-none',
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        className
      )}
      inert={!open}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}
