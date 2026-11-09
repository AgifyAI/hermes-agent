import { useStore } from '@nanostores/react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { CornerDownLeft, iconSize } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { $queuedPromptsBySession, getQueuedPrompts } from '@/store/composer-queue'
import { $selectedStoredSessionId } from '@/store/session'

import { requestComposerQueueSend } from '../chat/composer/queue-send'

import { SIDEBAR_CARD_CLASS, SidebarSectionContent, SidebarSectionHeader, SidebarSectionToggle } from './section-header'

export function QueueSection() {
  const { t } = useI18n()
  const labels = t.rightSidebar
  const [open, setOpen] = useState(false)
  const sessionId = useStore($selectedStoredSessionId)
  useStore($queuedPromptsBySession)
  const entries = getQueuedPrompts(sessionId)

  return (
    <section className={cn(SIDEBAR_CARD_CLASS, 'shrink-0')} data-slot="queued-prompts-section">
      <SidebarSectionHeader>
        <SidebarSectionToggle onClick={() => setOpen(current => !current)} open={open}>
          {labels.queuedMessagesTitle}
          {entries.length > 0 && (
            <span className="text-[0.6875rem] text-(--linear-text-tertiary)">{entries.length}</span>
          )}
        </SidebarSectionToggle>
      </SidebarSectionHeader>
      <SidebarSectionContent open={open}>
        <div className="max-h-64 overflow-y-auto px-2.5 pb-2">
          {entries.length === 0 ? (
            <p className="text-xs text-(--linear-text-quaternary)">{labels.queuedMessagesEmpty}</p>
          ) : (
            entries.map(entry => (
              <div
                className="flex items-start gap-1 border-t border-(--linear-border-panel) py-1.5 first:border-t-0"
                key={entry.id}
              >
                <p className="min-w-0 flex-1 line-clamp-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-(--linear-text-secondary)">
                  {entry.displayText ?? entry.text}
                </p>
                {!entry.serverStatus && (
                  <Tip label={t.composer.queueSend}>
                    <Button
                      aria-label={t.composer.queueSend}
                      className="size-5 shrink-0 rounded-md text-(--linear-text-tertiary) hover:text-(--linear-text-primary)"
                      onClick={() => requestComposerQueueSend(sessionId ?? '', entry.id)}
                      size="icon-xs"
                      type="button"
                      variant="ghost"
                    >
                      <CornerDownLeft className={iconSize.xs} />
                    </Button>
                  </Tip>
                )}
              </div>
            ))
          )}
        </div>
      </SidebarSectionContent>
    </section>
  )
}
