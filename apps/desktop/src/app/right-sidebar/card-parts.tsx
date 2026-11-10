import { type ReactNode, useState } from 'react'

import { cn } from '@/lib/utils'

import { SIDEBAR_CARD_CLASS, SidebarSectionContent, SidebarSectionHeader, SidebarSectionToggle } from './section-header'

export function ActionButton({
  children,
  destructive,
  disabled,
  label,
  onClick
}: {
  children: ReactNode
  destructive?: boolean
  disabled?: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      className={cn(
        'flex h-6 items-center gap-1 rounded-md px-1.5 text-[0.6875rem] font-medium transition-colors disabled:opacity-50',
        destructive
          ? 'text-(--linear-text-tertiary) hover:bg-(--linear-red)/10 hover:text-(--linear-red)'
          : 'text-(--linear-text-secondary) hover:bg-(--linear-hover-sidebar-icon) hover:text-(--linear-text-primary)'
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
      <span className="truncate">{label}</span>
    </button>
  )
}

interface SidebarCardShellProps {
  children: ReactNode
  dot: string
  label: string
  slot: string
  stateLabel?: string
  title: string
}

/** One Automations card: the shared header/toggle chrome plus the persisted open state. */
export function SidebarCardShell({ children, dot, label, slot, stateLabel, title }: SidebarCardShellProps) {
  const [open, setOpen] = useState(true)

  return (
    <section aria-label={label} className={cn(SIDEBAR_CARD_CLASS, 'shrink-0')} data-slot={slot}>
      <SidebarSectionHeader>
        <SidebarSectionToggle onClick={() => setOpen(current => !current)} open={open}>
          <span className="flex min-w-0 items-center gap-1.5">
            <span aria-hidden="true" className={cn('inline-block size-1.5 shrink-0 rounded-full', dot)} />
            <span className="truncate">{title}</span>
            {stateLabel && (
              <span className="shrink-0 text-[0.6875rem] font-normal text-(--linear-text-quaternary)">{stateLabel}</span>
            )}
          </span>
        </SidebarSectionToggle>
      </SidebarSectionHeader>
      <SidebarSectionContent open={open}>
        <div className="flex flex-col gap-2 px-3 pb-2.5">{children}</div>
      </SidebarSectionContent>
    </section>
  )
}
