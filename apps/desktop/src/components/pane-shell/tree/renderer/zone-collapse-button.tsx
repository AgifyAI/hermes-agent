import { Codicon } from '@/components/ui/codicon'
import { LinearDisclosure } from '@/components/ui/linear-disclosure'
import { cn } from '@/lib/utils'

interface ZoneCollapseButtonProps {
  inline?: boolean
  label: string
  minimized: boolean
  onClick: () => void
  terminal: boolean
}

/** The zone header's collapse affordance. Terminal keeps the Linear disclosure
 * glyph; other zones retain the existing Codicon affordance. */
export function ZoneCollapseButton({ inline = false, label, minimized, onClick, terminal }: ZoneCollapseButtonProps) {
  return (
    <button
      aria-expanded={!minimized}
      aria-label={label}
      className={cn(
        'grid shrink-0 place-items-center self-center [-webkit-app-region:no-drag] rounded-md text-(--linear-text-tertiary) transition-colors duration-(--linear-speed-quick) hover:bg-(--linear-hover-control) hover:text-(--linear-text-primary)',
        inline ? 'mx-0 size-4' : 'mx-1 size-5',
        terminal ? 'opacity-100' : 'opacity-0 transition-opacity focus-visible:opacity-100 group-hover/pane-header:opacity-100'
      )}
      onClick={onClick}
      onPointerDown={event => event.stopPropagation()}
      type="button"
    >
      {terminal ? (
        <LinearDisclosure open={!minimized} />
      ) : (
        <Codicon name={minimized ? 'chevron-up' : 'chevron-down'} size="0.75rem" />
      )}
    </button>
  )
}
