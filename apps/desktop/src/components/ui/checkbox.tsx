import { Checkbox as CheckboxPrimitive } from 'radix-ui'
import * as React from 'react'

import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

const BOX =
  'group peer size-4 shrink-0 rounded-(--linear-radius-kbd) border-[0.5px] border-(--linear-border-input) bg-(--linear-bg-input) outline-none transition-colors duration-(--linear-speed-quick) data-[state=checked]:border-(--linear-accent) data-[state=checked]:bg-(--linear-accent) data-[state=checked]:text-(--linear-on-accent) data-[state=indeterminate]:border-(--linear-accent) data-[state=indeterminate]:bg-(--linear-accent) data-[state=indeterminate]:text-(--linear-on-accent)'

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        BOX,
        'focus-visible:ring-1 focus-visible:ring-(--linear-focus) disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-(--linear-red)',
        className
      )}
      data-slot="checkbox"
      {...props}
    >
      <CheckboxPrimitive.Indicator
        className="flex items-center justify-center text-current"
        data-slot="checkbox-indicator"
      >
        {/* codicon.css sets `display: inline-block` at higher specificity than a bare
            `hidden`, so both glyphs paint at once without the important modifier. */}
        <Codicon className="hidden! group-data-[state=checked]:block!" name="check" size="0.875rem" />
        <Codicon className="hidden! group-data-[state=indeterminate]:block!" name="dash" size="0.875rem" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

/** The Checkbox look without a control, for rows that are themselves the toggle
 *  (a real Checkbox is a button and can't nest inside one). */
function CheckboxMark({ checked, className }: { checked: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(BOX, 'grid place-items-center', className)}
      data-slot="checkbox-mark"
      data-state={checked ? 'checked' : 'unchecked'}
    >
      {checked && <Codicon name="check" size="0.875rem" />}
    </span>
  )
}

export { Checkbox, CheckboxMark }
