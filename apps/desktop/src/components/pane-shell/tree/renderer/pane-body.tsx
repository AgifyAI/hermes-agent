import { type ReactNode, useCallback, useRef, useState } from 'react'

import { useResizeObserver } from '@/hooks/use-resize-observer'
import { cn } from '@/lib/utils'

interface PaneBodyProps {
  /** Wraps the body's own element (the zone's right-click menu) WITHOUT an
   *  extra layout box: the wrapper receives the div itself, so asChild-style
   *  triggers attach to it directly. */
  wrap?: (body: ReactNode) => ReactNode
  hidden: boolean
  /** Let a single static pane contribute its natural height to a packed rail. */
  fitContent?: boolean
  /** Linear's content panel: the body becomes the inset card (radius 12,
   *  hairline, low shadow, 8px off the right and bottom) on the window surface.
   *  Off for navigation columns, which sit flush on the window like Linear's
   *  sidebar. */
  panel?: boolean
  children: ReactNode
}

/** Collapse the zone, not its guests. Retaining the last visible viewport lets
 * background browser input use the same page coordinates while the restore
 * rail occupies only a sliver of the layout. Never detach/reparent a webview. */
export function PaneBody({ wrap, hidden, fitContent = false, panel = false, children }: PaneBodyProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ width: number; height: number }>()

  // Rides the app's ONE shared observer (see use-resize-observer.ts); the
  // hidden body is a fixed box, so only visible measurements are remembered.
  const remember = useCallback(
    (entries: readonly ResizeObserverEntry[]) => {
      const rect = entries[0]?.contentRect

      if (!hidden && rect && rect.width > 0 && rect.height > 0) {
        setSize(previous =>
          previous?.width === rect.width && previous.height === rect.height
            ? previous
            : { width: rect.width, height: rect.height }
        )
      }
    },
    [hidden]
  )

  useResizeObserver(remember, ref)

  const body = (
    <div
      className={cn(
        'relative min-h-0 min-w-0 overflow-hidden',
        fitContent ? 'flex-none' : 'flex-1',
        panel &&
          cn(
            'mr-2 rounded-(--linear-radius-overlay) border-[0.5px] border-(--linear-border-panel) bg-(--linear-bg-panel) shadow-(--linear-shadow-low)',
            !fitContent && 'mb-2'
          )
      )}
      ref={ref}
      style={hidden ? { position: 'absolute', visibility: 'hidden', pointerEvents: 'none', ...size } : undefined}
    >
      {children}
    </div>
  )

  // The wrap must not add a layout box: `relative min-h-0 flex-1` rides the
  // body itself so the zone's flex column geometry is unchanged.
  return wrap ? wrap(body) : body
}
