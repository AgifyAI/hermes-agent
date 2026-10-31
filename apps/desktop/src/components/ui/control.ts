import { cva, type VariantProps } from 'class-variance-authority'

// Single source of truth for non-composer form-control chrome — Input,
// Textarea, and SelectTrigger all consume this. Linear's text input
// (docs/linear-design-reference.md § Text input): 32px, 6px 12px padding, 8px
// radius, hairline border, 13px text. The visual chrome (fill, border tint,
// focus, invalid state) comes from the `desktop-input-chrome` CSS so every
// control shares one exact look.
export const controlVariants = cva(
  'desktop-input-chrome w-full min-w-0 rounded-(--linear-radius-control) border-[0.5px] text-[0.8125rem] leading-5 text-(--linear-text-primary) outline-none placeholder:text-(--linear-text-quaternary) disabled:pointer-events-none disabled:cursor-not-allowed disabled:text-(--linear-text-hint)',
  {
    variants: {
      size: {
        xs: 'min-h-6 px-2 py-0.5 text-xs leading-4',
        sm: 'min-h-7 px-2.5 py-1 text-xs leading-4',
        default: 'min-h-8 px-3 py-1.5',
        lg: 'min-h-9 px-3 py-2 text-sm'
      }
    },
    defaultVariants: {
      size: 'default'
    }
  }
)

export type ControlVariantProps = VariantProps<typeof controlVariants>
