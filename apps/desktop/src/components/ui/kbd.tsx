import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

import { comboTokens } from '@/lib/keybinds/combo'
import { cn } from '@/lib/utils'

const COMPACT_KEY = /^[\p{L}\p{N}⌘⌥⇧⌃↵⇥⌫↑↓←→@/?]$/u

// Linear's key cap (docs/linear-design-reference.md § Command palette): 17px,
// 2px padding, 4px radius, a hairline and no fill, 11px Inter with the
// cv08 + zero figures, in the hint colour.
const kbdSurface = ['border-(--linear-border-kbd)', 'bg-transparent', 'text-(--linear-text-hint)']

const kbdVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-(--linear-radius-kbd) border-[0.5px] [font-family:var(--dt-font-kbd)] font-normal leading-none [font-feature-settings:'cv08','zero'] select-none",
  {
    variants: {
      variant: {
        default: kbdSurface,
        ghost: [...kbdSurface, 'text-(--linear-text-quaternary)'],
        capturing: [
          'border-(--linear-accent)',
          'bg-[color-mix(in_srgb,var(--linear-accent)_10%,transparent)]',
          'text-(--linear-accent)'
        ],
        // On a filled surface (the primary button): ink follows the host.
        inverted: [
          'border-[color-mix(in_srgb,currentColor_22%,transparent)]',
          'bg-[color-mix(in_srgb,currentColor_12%,transparent)]',
          'text-[color-mix(in_srgb,currentColor_88%,transparent)]'
        ]
      },
      size: {
        sm: 'text-[0.625rem]',
        md: 'text-[0.6875rem]'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'md'
    }
  }
)

function kbdShapeClass(label: string, size: 'sm' | 'md' | null | undefined): string {
  const compact = COMPACT_KEY.test(label)

  if (size === 'sm') {
    return compact ? 'size-4 px-0' : 'h-4 min-w-4 px-0.5'
  }

  return compact ? 'size-[1.0625rem] px-0' : 'h-[1.0625rem] min-w-[1.0625rem] px-0.5'
}

interface KbdProps extends React.ComponentProps<'kbd'>, VariantProps<typeof kbdVariants> {}

function Kbd({ children, className, size, variant, ...props }: KbdProps) {
  const label = typeof children === 'string' ? children : ''

  return (
    <kbd
      className={cn(kbdVariants({ size, variant }), kbdShapeClass(label, size), className)}
      data-slot="kbd"
      {...props}
    >
      {children}
    </kbd>
  )
}

interface KbdGroupProps extends Omit<React.ComponentProps<'span'>, 'children'>, VariantProps<typeof kbdVariants> {
  keys: string[]
}

function KbdGroup({ className, keys, size, variant, ...props }: KbdGroupProps) {
  return (
    <span
      aria-label={keys.join(' ')}
      className={cn('inline-flex shrink-0 items-center gap-1', className)}
      data-slot="kbd-group"
      {...props}
    >
      {keys.map((key, index) => (
        <Kbd key={`${key}-${index}`} size={size} variant={variant}>
          {key}
        </Kbd>
      ))}
    </span>
  )
}

interface KbdComboProps extends Omit<KbdGroupProps, 'keys'> {
  combo: string
}

function KbdCombo({ combo, ...props }: KbdComboProps) {
  return <KbdGroup keys={comboTokens(combo)} {...props} />
}

export { Kbd, KbdCombo, KbdGroup, kbdVariants }
