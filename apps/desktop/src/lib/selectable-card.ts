import { cn } from '@/lib/utils'

export interface SelectableCardState {
  /** Currently selected / active — the strongest emphasis. */
  active?: boolean
  /**
   * Configured / installed / "you have this" — solid surface + border. When
   * false the card renders muted (transparent, dimmed) until hovered, so the
   * eye lands on what you already have. Ignored when `active` is set.
   */
  prominent?: boolean
}

/**
 * Shared emphasis for selectable list cards across settings surfaces (theme
 * picker, pet picker, Marketplace results, provider rows…). Three tiers:
 * active > prominent > muted. Keeps the "installed = solid, not-installed =
 * quiet" pattern consistent everywhere instead of each picker rolling its own.
 *
 * Callers own layout (padding, flex, width); this owns only border + surface.
 */
export function selectableCardClass({ active, prominent }: SelectableCardState): string {
  return cn(
    'rounded-(--linear-radius-card) border transition-colors duration-(--linear-speed-quick) hover:transition-none',
    active
      ? 'border-(--linear-accent) bg-(--linear-bg-card) shadow-(--linear-shadow-card)'
      : prominent
        ? 'border-transparent bg-(--linear-bg-card) shadow-(--linear-shadow-card) hover:bg-(--linear-hover-control)'
        : 'border-transparent bg-transparent text-(--linear-text-tertiary) hover:border-(--linear-border-panel) hover:bg-(--linear-hover-control)'
  )
}
