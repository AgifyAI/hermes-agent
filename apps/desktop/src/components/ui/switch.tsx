import { cva, type VariantProps } from 'class-variance-authority'
import { Switch as SwitchPrimitive } from 'radix-ui'
import * as React from 'react'

import { cn } from '@/lib/utils'

const switchVariants = cva(
  // Linear's switch: a 30×20 pill, accent when on.
  'peer inline-flex shrink-0 items-center rounded-full bg-(--linear-bg-tertiary) p-0.5 transition-colors duration-(--linear-speed-quick) outline-none focus-visible:ring-1 focus-visible:ring-(--linear-focus) disabled:cursor-not-allowed disabled:opacity-60 data-[state=checked]:bg-(--linear-accent)',
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
  'pointer-events-none block rounded-full bg-white shadow-(--linear-shadow-low) ring-0 transition-transform duration-(--linear-speed-quick) data-[state=unchecked]:translate-x-0',
  {
    variants: {
      size: {
        default: 'size-4 data-[state=checked]:translate-x-2.5',
        xs: 'size-3 data-[state=checked]:translate-x-2'
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
