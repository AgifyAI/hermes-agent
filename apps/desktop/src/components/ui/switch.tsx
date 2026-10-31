import { cva, type VariantProps } from 'class-variance-authority'
import { Switch as SwitchPrimitive } from 'radix-ui'
import * as React from 'react'

import { cn } from '@/lib/utils'

const switchVariants = cva(
  // Linear's switch (measured): a 30×20 pill, grey off, accent on, a 14px thumb
  // inset 3px, no shadow; hover darkens the track, disabled halves the opacity.
  'peer inline-flex shrink-0 items-center rounded-full bg-(--linear-switch-off) p-[0.1875rem] transition-colors duration-(--linear-speed-quick) outline-none hover:bg-(--linear-switch-off-hover) focus-visible:ring-1 focus-visible:ring-(--linear-focus) disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-(--linear-accent) data-[state=checked]:hover:bg-(--linear-accent-hover) disabled:hover:bg-(--linear-switch-off) disabled:data-[state=checked]:hover:bg-(--linear-accent)',
  {
    variants: {
      size: {
        default: 'h-5 w-[1.875rem]',
        xs: 'h-4 w-6'
      }
    },
    defaultVariants: {
      size: 'default'
    }
  }
)

const switchThumbVariants = cva(
  'pointer-events-none block rounded-full bg-(--linear-switch-thumb) ring-0 transition-transform duration-(--linear-speed-quick) data-[state=unchecked]:translate-x-0',
  {
    variants: {
      size: {
        default: 'size-3.5 data-[state=checked]:translate-x-2.5',
        xs: 'size-2.5 data-[state=checked]:translate-x-2'
      }
    },
    defaultVariants: {
      size: 'default'
    }
  }
)

function Switch({
  className,
  size,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & VariantProps<typeof switchVariants>) {
  return (
    <SwitchPrimitive.Root className={cn(switchVariants({ size }), className)} data-slot="switch" {...props}>
      <SwitchPrimitive.Thumb className={switchThumbVariants({ size })} data-slot="switch-thumb" />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
