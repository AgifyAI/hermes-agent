import { requestRightSidebarSection } from '@/app/right-sidebar/section-request'
import { Button } from '@/components/ui/button'

export function isPendingMemoryProposal(
  toolName: string,
  isPending: boolean,
  result: Record<string, unknown>
): boolean {
  return !isPending && toolName === 'memory' && result.staged === true && typeof result.pending_id === 'string'
}

export function PendingMemoryReviewButton() {
  return (
    <Button
      aria-label="Review pending memory"
      className="h-5 px-1.5 text-[0.6875rem] text-(--linear-text-tertiary) hover:text-(--linear-text-primary)"
      onClick={event => {
        event.stopPropagation()
        requestRightSidebarSection('memory')
      }}
      size="micro"
      type="button"
      variant="text"
    >
      Review
    </Button>
  )
}
