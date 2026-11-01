import { Tabs as TabsPrimitive } from 'radix-ui'
import * as React from 'react'

import { cn } from '@/lib/utils'

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root className={cn('flex flex-col gap-2', className)} data-slot="tabs" {...props} />
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'inline-flex h-7 items-center justify-center gap-1 text-(--linear-text-tertiary)',
        className
      )}
      data-slot="tabs-list"
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        // Linear's segmented tabs (same as SegmentedControl): 28px pills, 12px/500.
        'inline-flex h-7 items-center justify-center gap-1.5 rounded-full bg-(--linear-segment-rest) px-2.5 text-xs font-medium whitespace-nowrap text-(--linear-text-tertiary) transition-colors duration-(--linear-speed-quick) outline-none hover:text-(--linear-text-primary) focus-visible:ring-1 focus-visible:ring-(--linear-focus) disabled:pointer-events-none disabled:opacity-60 data-[state=active]:bg-(--linear-segment-selected) data-[state=active]:text-(--linear-text-primary) [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0',
        className
      )}
      data-slot="tabs-trigger"
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger }
