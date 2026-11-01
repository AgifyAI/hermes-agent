import { type CSSProperties, type ReactNode, useEffect } from 'react'

import { TITLEBAR_HEIGHT } from '@/app/shell/titlebar'
import { TitlebarIcon } from '@/app/shell/titlebar-icon'
import { Button } from '@/components/ui/button'
import { translateNow } from '@/i18n'
import { ESCAPE_PRIORITY, isTopEscapeLayer, pushEscapeLayer } from '@/lib/escape-layers'
import { triggerHaptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'

// Linear has no modal pages: a settings or list view replaces the workspace,
// its nav on the window colour beside one inset content panel. Every overlay
// column that holds content wears this surface.
export const OVERLAY_PANEL_SURFACE =
  'overflow-hidden rounded-(--linear-radius-overlay) border-[0.5px] border-(--linear-border-panel) bg-(--linear-bg-panel) shadow-(--linear-shadow-low)'

interface OverlayViewProps {
  children: ReactNode
  onClose: () => void
  closeLabel?: string
  contentClassName?: string
  /** The nav rail carries the way back on wide windows (Linear's "Back to app"),
   *  so the X only shows once the rail collapses. */
  railClose?: boolean
  headerContent?: ReactNode
  rootClassName?: string
  /** Controls rendered on the close button's row, to its left. They ride the
   *  titlebar strip, so keep them titlebar-sized and quiet. */
  titlebarActions?: ReactNode
}

export function OverlayView({
  children,
  onClose,
  closeLabel = translateNow('common.close'),
  contentClassName,
  headerContent,
  railClose = false,
  rootClassName,
  titlebarActions
}: OverlayViewProps) {
  const closeOverlay = () => {
    triggerHaptic('close')
    onClose()
  }

  // Esc dismisses every OverlayView-based overlay. Nested Radix dialogs
  // stop propagation themselves, so opening (e.g.) the model picker inside
  // Settings still closes the picker first instead of the underlying overlay.
  useEffect(() => {
    const releaseLayer = pushEscapeLayer(ESCAPE_PRIORITY.overlay)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !isTopEscapeLayer(ESCAPE_PRIORITY.overlay)) {
        return
      }

      event.preventDefault()
      triggerHaptic('close')
      onClose()
    }

    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      releaseLayer()
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-(--linear-bg-window) pt-(--titlebar-height)"
      // Every OverlayView-based overlay (settings, command-center, agents, cron,
      // profiles, star map, …) covers the chat while the composer stays mounted
      // beneath it. This marker tells `composerFocusBlockedBySurface` to stand
      // the global type-to-focus / soft `/` / Enter down, so keystrokes don't
      // leak into the hidden composer (and the overlay's own bare-key shortcuts,
      // e.g. star map's Space, keep working).
      data-overlay-surface=""
      onClick={event => {
        if (event.target === event.currentTarget) {
          closeOverlay()
        }
      }}
      role="presentation"
      // Window-level chrome: overlays always clear the real titlebar. The
      // contrib shell zeroes --titlebar-height for CONTENT areas (panes sit
      // below its in-flow title bar), and CSS vars inherit through the DOM —
      // so a fixed overlay mounted inside a zone would read 0 and bleed to
      // the edges. Re-pin the real height at the overlay root.
      style={{ '--titlebar-height': `${TITLEBAR_HEIGHT}px` } as CSSProperties}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-(--titlebar-height) [-webkit-app-region:drag]">
        {headerContent && (
          <div className="pointer-events-auto absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 [-webkit-app-region:no-drag]">
            {headerContent}
          </div>
        )}

        <div className="pointer-events-auto absolute right-[var(--titlebar-tools-right,0.75rem)] top-1/2 flex -translate-y-1/2 items-center gap-1.5 [-webkit-app-region:no-drag]">
          {titlebarActions}

          <Button
            aria-label={closeLabel}
            className={cn(railClose && 'min-[47.5rem]:hidden')}
            onClick={closeOverlay}
            size="icon-titlebar"
            variant="ghost"
          >
            <TitlebarIcon name="close" />
          </Button>
        </div>
      </div>

      <div className={cn('relative flex min-h-0 flex-1 flex-col', rootClassName)}>
        {/* The split-layout columns own their surfaces, so the nav rail stays on
            the window colour beside the content panel. */}
        <div className={cn('flex min-h-0 flex-1 flex-col', contentClassName)}>{children}</div>
      </div>
    </div>
  )
}
