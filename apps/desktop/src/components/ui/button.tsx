import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import * as React from 'react'

import { Loader2 } from '@/lib/icons'
import { cn } from '@/lib/utils'

// Text+icon actions underline the label on hover, not the glyph.
const TEXT_ACTION_ICON = '[&_.codicon]:no-underline [&_svg]:no-underline'

// The one boxless text action: 12px/500 like every Linear button, quiet at rest,
// underlined on hover only.
const TEXT_ACTION = `rounded-none text-(--linear-text-tertiary) underline-offset-4 hover:text-(--linear-text-primary) hover:underline ${TEXT_ACTION_ICON}`

// Linear's button family (docs/linear-design-reference.md § Buttons, Icon
// button): every button is a pill, 12px/500, with no border and a 100ms colour
// transition. Heights are fixed per size — 24 (chip, ghost), 28 (primary,
// toolbar, icon), 32 (secondary) — so a row of mixed buttons lines up.
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full text-xs leading-4 font-medium whitespace-nowrap shadow-none transition-[background-color,color,box-shadow,opacity] duration-(--linear-speed-quick) outline-none focus-visible:ring-1 focus-visible:ring-(--linear-focus) disabled:pointer-events-none disabled:cursor-default disabled:opacity-60 aria-invalid:ring-1 aria-invalid:ring-(--linear-red) [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        // "Create issue": accent fill, on-accent ink, the low elevation.
        default:
          'bg-(--linear-accent) text-(--linear-on-accent) shadow-(--linear-shadow-low) hover:bg-(--linear-accent-hover)',
        destructive: 'bg-(--linear-red) text-white shadow-(--linear-shadow-low) hover:brightness-95',
        // Transparent with a hairline ring (shadow, so nothing reflows).
        outline:
          'bg-transparent text-(--linear-text-secondary) shadow-[inset_0_0_0_1px_var(--linear-border-secondary)] hover:bg-(--linear-hover-control) hover:text-(--linear-text-primary)',
        // The default non-primary button: Linear's toolbar button.
        secondary:
          'bg-(--linear-bg-toolbar) text-(--linear-text-secondary) hover:bg-(--linear-bg-toolbar-hover) hover:text-(--linear-text-primary)',
        // A property chip ("Set team"): chip fill, hover deepens it.
        chip: 'bg-(--linear-bg-chip) text-(--linear-text-overlay) hover:bg-(--linear-bg-chip-hover)',
        ghost:
          'text-(--linear-text-secondary) hover:bg-(--linear-hover-control) hover:text-(--linear-text-primary)',
        grip: 'bg-transparent text-(--linear-text-tertiary) hover:text-(--linear-text-secondary) focus-visible:text-(--linear-text-primary)',
        // A control floating free of any surface (fan-menu discs, detached
        // chips): the menu treatment — overlay fill, hairline, menu shadow.
        // Hover only lifts the glyph; a fill change on a lone disc reads as a
        // toggle flipping.
        floating:
          'bg-(--linear-bg-overlay) text-(--linear-text-secondary) shadow-[0_0_0_0.5px_var(--linear-border-overlay),var(--linear-shadow-menu)] hover:text-(--linear-text-primary)',
        link: `rounded-none text-(--linear-accent) underline-offset-4 decoration-current/20 hover:underline ${TEXT_ACTION_ICON}`,
        // Boxless inline-text action (no bg/border), e.g. "Cancel", "Clear".
        text: TEXT_ACTION,
        // The same look, always flush with the text around it ("Change", "Open logs").
        textStrong: TEXT_ACTION
      },
      size: {
        // Primary / toolbar: 28px, 10px sides (8px on the icon side).
        default: 'h-7 px-2.5 has-[>svg]:pl-2',
        // Chip: 24px, 8px sides.
        xs: "h-6 gap-1 px-2 has-[>svg]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        // Ghost: 24px, 12px sides (6px on the icon side).
        sm: 'h-6 px-3 has-[>svg]:pl-1.5',
        // Secondary: 32px, 12px sides.
        lg: 'h-8 px-3 has-[>svg]:pl-2.5',
        touch: 'min-h-11 min-w-11 px-3 py-2',
        // Flush inline text action — no box padding/height. Pair with text/link
        // variants when the button must sit inline in a heading or sentence
        // (replaces ad-hoc `h-auto px-0 py-0` overrides).
        inline: 'h-auto gap-1 p-0 has-[>svg]:px-0',
        // Status-stack headers, table footers — 12px text actions beside a label.
        micro:
          "h-auto gap-0.5 px-1 py-0 text-xs leading-4 font-normal has-[>svg]:px-0.5 [&_svg:not([class*='size-'])]:size-3",
        // Icon buttons: 32 (modal), 28 (default), 24 (small), 14px glyph.
        icon: 'size-8 p-0.5',
        'icon-xs': 'size-6 p-0.5',
        'icon-sm': 'size-7 p-0.5',
        'icon-lg': "size-8 p-0.5 [&_svg:not([class*='size-'])]:size-4",
        grip: 'h-4 w-12 p-0',
        'icon-titlebar':
          'titlebar-icon-button h-(--titlebar-control-height) w-(--titlebar-control-size) [&_svg:not([class*="size-"])]:size-(--titlebar-icon-size)'
      }
    },
    compoundVariants: [
      // textStrong is a boxless link — size variants still inject px-*; strip
      // inline padding so the underline sits flush with the label.
      {
        variant: 'textStrong',
        class: 'px-0 has-[>svg]:px-0'
      }
    ],
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  loading = false,
  children,
  disabled,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /** Working. The label stays in flow but goes invisible and a spinner
     *  sits over it, so the button keeps its exact width and height — a
     *  label swapped for a glyph reflows every sibling on the row. */
    loading?: boolean
  }) {
  const Comp = asChild ? Slot.Root : 'button'

  return (
    <Comp
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size }), loading && 'relative', className)}
      data-size={size}
      data-slot="button"
      data-variant={variant}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <>
          {/* Same flex + gap as the button itself, so the ghost label measures
              exactly what the live one did. The spinner sits in a wrapper so
              it is never a direct-child svg — the size variants' `has-[>svg]`
              would otherwise switch to icon padding and shave the width. */}
          <span aria-hidden className="invisible inline-flex items-center gap-[inherit]">
            {children}
          </span>
          <span aria-hidden className="absolute inset-0 grid place-items-center">
            <Loader2 className="animate-spin" />
          </span>
        </>
      ) : (
        children
      )}
    </Comp>
  )
}

export { Button, buttonVariants }
