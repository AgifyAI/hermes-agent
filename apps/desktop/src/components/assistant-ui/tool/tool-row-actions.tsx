import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'
import { dismissToolRow } from '@/store/tool-dismiss'

export function DismissToolButton({ disclosureId, label, open }: { disclosureId: string; label: string; open: boolean }) {
  return (
    <Button
      aria-label={label}
      className={cn(
        'size-5 rounded-md text-(--linear-text-tertiary) transition-opacity hover:text-(--linear-text-primary) hover:opacity-100',
        open ? 'opacity-80' : 'opacity-0 group-hover/disclosure-row:opacity-80 group-focus-within/disclosure-row:opacity-80'
      )}
      onClick={event => {
        event.stopPropagation()
        dismissToolRow(disclosureId)
      }}
      size="icon-xs"
      type="button"
      variant="ghost"
    >
      <Codicon name="close" size="0.75rem" />
    </Button>
  )
}
