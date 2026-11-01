import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import type * as React from 'react'

import { cn } from '@/lib/utils'

// Small status/metadata tag. App radius (not a full pill); tones map to the
// shared accent/muted/destructive surfaces so badges read consistently.
const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1 rounded-full font-medium whitespace-nowrap [&_svg]:pointer-events-none',
  {
    variants: {
      variant: {
        default: 'bg-[color-mix(in_srgb,var(--linear-accent)_12%,transparent)] text-(--linear-accent)',
        muted: 'bg-(--linear-segment-selected) text-(--linear-text-tertiary)',
        success: 'bg-[color-mix(in_srgb,var(--linear-green)_14%,transparent)] text-(--linear-green)',
        warn: 'bg-[color-mix(in_srgb,var(--linear-orange)_14%,transparent)] text-(--linear-orange)',
        destructive: 'bg-[color-mix(in_srgb,var(--linear-red)_12%,transparent)] text-(--linear-red)',
        outline: 'border-[0.5px] border-(--linear-border-tertiary) text-(--linear-text-tertiary)',
        // Solid fill — icon-corner counts (titlebar unread, etc.).
        solid: 'bg-(--linear-accent) text-(--linear-on-accent)'
      },
      size: {
        // `leading-none` follows the font size here: tailwind-merge drops a line
        // height set before a font size, and the pill then inherits its parent's.
        default: 'px-1.5 py-0.5 text-[0.6875rem] leading-none font-[450] [&_svg]:size-3',
        xs: 'px-1 py-px text-[0.6875rem] leading-none [&_svg]:size-2.5',
        overlay: 'h-2 min-w-2 justify-center rounded-[2px] px-px text-[7px] leading-none font-semibold tabular-nums'
      }
    },
    defaultVariants: { variant: 'default', size: 'default' }
  }
)

export interface BadgeProps extends React.ComponentProps<'span'>, VariantProps<typeof badgeVariants> {
  asChild?: boolean
}

export function Badge({ asChild = false, className, size, variant, ...props }: BadgeProps) {
  const Comp = asChild ? Slot.Root : 'span'

  return <Comp className={cn(badgeVariants({ size, variant }), className)} data-slot="badge" {...props} />
}

export { badgeVariants }
