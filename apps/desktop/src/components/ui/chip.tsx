import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export const selectableClass = (on: boolean) =>
  cn(
    'border-[0.5px] text-(--linear-text-primary) transition-colors duration-(--linear-speed-quick)',
    on
      ? 'border-(--linear-accent) bg-[color-mix(in_srgb,var(--linear-accent)_12%,transparent)]'
      : 'border-(--linear-border-tertiary) bg-(--linear-bg-chip) hover:bg-(--linear-bg-chip-hover)'
  )

export function Chip({
  className,
  icon,
  label,
  on,
  onToggle,
  sub,
  variant = 'card'
}: {
  className?: string
  icon?: ReactNode
  label: string
  on: boolean
  onToggle: () => void
  sub?: string
  variant?: 'card' | 'pill'
}) {
  return (
    <button
      aria-pressed={on}
      className={cn(
        'flex items-center text-left',
        variant === 'pill'
          ? 'max-w-full shrink-0 gap-1.5 rounded-full px-2 py-1 text-xs whitespace-normal wrap-anywhere'
          : 'min-w-0 gap-2.5 rounded-(--linear-radius-control) px-3 py-2.5 text-[0.8125rem]',
        selectableClass(on),
        className
      )}
      onClick={onToggle}
      type="button"
    >
      {icon}
      <span className="min-w-0">
        <span className={variant === 'pill' ? 'block wrap-anywhere' : 'block truncate'}>{label}</span>
        {sub && <span className="block text-xs text-(--linear-text-tertiary)">{sub}</span>}
      </span>
    </button>
  )
}
