import { cn } from '@/lib/utils'

// Shared class names for the composer's control row, in a module of their own
// so both the row (`controls.tsx`) and the menus it renders can wear them
// without importing each other in a cycle.

export const ICON_BTN = 'size-(--composer-control-size) shrink-0'

export const GHOST_ICON_BTN = cn(
  ICON_BTN,
  'text-(--linear-text-tertiary) hover:bg-(--linear-hover-control) hover:text-(--linear-text-primary)'
)

// Send/voice-conversation primary: Linear's accent circle. Keeps the pill itself
// neutral and lets the action visually dominate the row.
export const PRIMARY_ICON_BTN = cn(
  'composer-primary-action',
  'size-(--composer-control-primary-size,var(--composer-control-size)) shrink-0 rounded-full p-0',
  'bg-(--linear-accent) text-(--linear-on-accent) hover:bg-(--linear-accent-hover)',
  'disabled:bg-(--linear-bg-input) disabled:text-(--linear-text-hint) disabled:opacity-100'
)

/** A toggle that is currently ON — dictation, spoken replies, the wake word. */
export const ACTIVE_ICON_BTN =
  'bg-(--linear-accent)/10 text-(--linear-accent) hover:bg-(--linear-accent)/15 hover:text-(--linear-accent)'
