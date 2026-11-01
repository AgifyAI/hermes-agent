/**
 * Inline transcript widgets — the few tool results that render as a panel the
 * user reads or acts on (a clarify question, an artifact card) rather than as
 * a scaffold line.
 *
 * They share one shell so they cannot drift apart: a Linear card (10px radius,
 * card surface, one panel hairline), the same shape as fenced code. No shadow —
 * the transcript scrolls and streams under it.
 *
 * The fill stays `--ui-widget-surface-background` by name: the HUD's ink rule in
 * styles.css matches widgets on that class. Rows inside take the control wash,
 * because Linear's row hover is the card's own colour in dark mode.
 */
export const WIDGET_SHELL_CLASS =
  'rounded-(--linear-radius-card) border-[0.5px] border-(--linear-border-panel) bg-(--ui-widget-surface-background) px-3.5 py-3 [--ui-row-hover-background:var(--linear-hover-control)]'
