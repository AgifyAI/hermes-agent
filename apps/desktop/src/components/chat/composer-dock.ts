import { menuSurfaceClass } from '@/components/ui/menu'
import { cn } from '@/lib/utils'

/**
 * The composer surface and the status/queue stack paint ONE shared
 * `--composer-fill` var. The state ladder (rest / scrolled) lives in styles.css
 * on `[data-slot='composer-root']`, so the layers can never disagree.
 */
export const composerFill = 'bg-(--composer-fill)'

const composerFillTransition = 'transition-[background-color] duration-150 ease-out'

/** Paint for the frequently repainting editable surface. No backdrop filters:
 *  Linear's composer is opaque, and typing must not re-blur the transcript. */
export const composerInputSurface = cn(composerFill, composerFillTransition)
// The `-z-10` paint layer behind the editable surface; hydrated and fallback composers share it.
export const composerInputBacking = cn(
  'pointer-events-none absolute inset-0 -z-10 rounded-[inherit]',
  composerInputSurface
)

const composerDockEdge = (edge: 'bottom' | 'top') =>
  cn('border border-(--ui-stroke-secondary)', edge === 'top' ? 'rounded-t-xl border-b-0' : 'rounded-b-xl border-t-0')

/** Opaque docked card — the status stack / queue. Paints the SAME
 *  `--composer-fill` as the surface, so rest / scrolled / focused / drawer-open
 *  all match the composer by construction.
 *
 * Keep the card non-shrinking inside capped flex scroll containers. Otherwise
 * flexbox compresses the card to the cap and its own overflow-hidden clips
 * later status rows before the outer status stack gets anything to scroll. */
export const composerDockCard = (edge: 'bottom' | 'top' = 'top') =>
  cn('shrink-0', composerDockEdge(edge), composerFill, composerFillTransition)

/** Floating composer panel skin — the `/`·`@`·`?` completion drawer. It is a
 *  Linear menu (`menuSurfaceClass`): opaque overlay surface, overlay hairline,
 *  12px radius, menu shadow. Visual skin only — consumers add their own
 *  size/position/padding. */
export const composerPanelCard = menuSurfaceClass

/**
 * A quiet control floating over composer content — the micro-action pills above
 * the surface, the Open affordance on a hovered link inside it. Full radius,
 * hairline border, the composer's own opaque fill so the text underneath never
 * shows through. Sized against the composer's control height so a pill
 * lines up with the chrome it floats above.
 *
 * Skin and size only; the call site owns position, width caps, and disabled
 * state.
 */
export const composerFloatingPill = cn(
  'inline-flex h-(--composer-control-size) shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5',
  'border-[0.5px] border-(--linear-border-tertiary) bg-(--linear-bg-chip)',
  'text-xs font-medium text-(--linear-text-chip) transition-colors duration-100',
  'hover:bg-(--linear-bg-chip-hover) hover:transition-none'
)

/**
 * Shared grid for the chrome-free floating strips that bracket the composer —
 * the micro-action pills above the surface and the `composer.underside` slot
 * below it.
 *
 * Both are in-flow children of the composer DOCK, siblings of the composer
 * itself rather than children of it. That's deliberate: the pop-out drag
 * region is `absolute inset-0` inside the composer, so anything rendered in
 * there is inside the grab area by construction. Living outside makes that
 * impossible instead of something the gesture has to exclude.
 *
 * One parent and one constant means the two strips share a left edge without
 * anyone matching numbers across files. Vertical spacing stays at the call
 * site; the horizontal inset matches the composer's 5px grab margin so the
 * strips line up with the surface rather than the margin's outer edge.
 */
export const composerFloatingStrip = 'flex flex-wrap items-center gap-1.5'
