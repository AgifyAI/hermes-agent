import * as React from 'react'

import { cn } from '@/lib/utils'

function TextTabMeta({ className, ...props }: React.ComponentProps<'span'>) {
  return <span className={cn('text-[0.72em] font-normal text-(--linear-text-tertiary)', className)} {...props} />
}

interface TextTabProps extends React.ComponentProps<'button'> {
  active?: boolean
}

function TextTab({ active = false, children, className, type = 'button', ...props }: TextTabProps) {
  return (
    <button
      className={cn(
        'group/text-tab inline-flex h-7 items-center gap-1 bg-transparent px-1 text-[length:var(--conversation-caption-font-size)] font-medium text-(--linear-text-tertiary) transition-colors duration-(--linear-speed-quick) hover:bg-transparent hover:text-(--linear-text-primary) focus-visible:text-(--linear-text-primary) focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--linear-focus) disabled:pointer-events-none disabled:opacity-60',
        active && 'text-(--linear-text-primary)',
        className
      )}
      data-active={active}
      type={type}
      {...props}
    >
      {React.Children.map(children, child =>
        React.isValidElement(child) && child.type === TextTabMeta ? (
          child
        ) : (
          <span
            className={cn(
              'underline-offset-4 decoration-current/25',
              active ? 'underline' : 'group-hover/text-tab:underline'
            )}
          >
            {child}
          </span>
        )
      )}
    </button>
  )
}

export { TextTab, TextTabMeta }
