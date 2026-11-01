import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '@/lib/utils'

const alertVariants = cva(
  'relative grid w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 rounded-(--linear-radius-card) border-[0.5px] bg-(--linear-bg-card) px-4 py-3 text-[0.8125rem] text-(--linear-text-primary) [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'border-(--linear-border-primary)',
        destructive:
          'border-(--linear-red)/35 bg-[color-mix(in_srgb,var(--linear-bg-card)_96%,var(--linear-red)_4%)] [&>svg]:text-(--linear-red)',
        warning:
          'border-(--linear-orange)/30 bg-[color-mix(in_srgb,var(--linear-bg-card)_96%,var(--linear-orange)_4%)] [&>svg]:text-(--linear-orange)',
        success:
          'border-(--linear-green)/25 bg-[color-mix(in_srgb,var(--linear-bg-card)_97%,var(--linear-green)_3%)] [&>svg]:text-(--linear-green)'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
)

function Alert({ className, variant, ...props }: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div className={cn(alertVariants({ variant }), className)} data-slot="alert" role="alert" {...props} />
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight text-foreground', className)}
      data-slot="alert-title"
      {...props}
    />
  )
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'col-start-2 grid justify-items-start gap-1 text-(--linear-text-tertiary) [&_p]:leading-relaxed',
        className
      )}
      data-slot="alert-description"
      {...props}
    />
  )
}

export { Alert, AlertDescription, AlertTitle }
