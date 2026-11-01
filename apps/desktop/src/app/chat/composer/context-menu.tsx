import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Kbd } from '@/components/ui/kbd'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { Clipboard, FileText, FolderOpen, type IconComponent, ImageIcon, Link, MessageSquareText } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { useComposerAttachmentProviders } from './contrib'
import { GHOST_ICON_BTN } from './controls'
import type { ChatBarState } from './types'

const SNIPPET_KEYS = ['codeReview', 'implementationPlan', 'explainThis']

export function ContextMenu({
  state,
  onInsertText,
  onOpenUrlDialog,
  onPasteClipboardImage,
  onPickFiles,
  onPickFolders,
  onPickImages
}: ContextMenuProps) {
  const { t } = useI18n()
  const c = t.composer
  // Prompt snippets used to be a Radix submenu. That submenu didn't open
  // reliably when the parent menu was positioned at the bottom of the
  // window (composer "+" anchor), so we promoted it to a real Dialog —
  // easier to grow with search / descriptions, and no positioning math.
  const [snippetsOpen, setSnippetsOpen] = useState(false)
  // `composer.attachments` contributions — plugin/core-registered rows that
  // extend this menu through the same registry as every other surface.
  const attachmentProviders = useComposerAttachmentProviders()

  return (
    <>
      <DropdownMenu>
        <Tip label={state.tools.label} placement="control">
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={state.tools.label}
              className={cn(
                GHOST_ICON_BTN,
                'data-[state=open]:bg-(--linear-hover-control) data-[state=open]:text-(--linear-text-primary)'
              )}
              disabled={!state.tools.enabled}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Codicon name="add" size="0.875rem" />
            </Button>
          </DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent align="start" className="w-60" side="top" sideOffset={6}>
          <DropdownMenuLabel>{c.attachLabel}</DropdownMenuLabel>
          <ContextMenuItem disabled={!onPickFiles} icon={FileText} onSelect={onPickFiles}>
            {c.files}
          </ContextMenuItem>
          <ContextMenuItem disabled={!onPickFolders} icon={FolderOpen} onSelect={onPickFolders}>
            {c.folder}
          </ContextMenuItem>
          <ContextMenuItem disabled={!onPickImages} icon={ImageIcon} onSelect={onPickImages}>
            {c.images}
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!onPasteClipboardImage}
            icon={Clipboard}
            onSelect={onPasteClipboardImage ? () => void onPasteClipboardImage() : undefined}
          >
            {c.pasteImage}
          </ContextMenuItem>
          <ContextMenuItem icon={Link} onSelect={onOpenUrlDialog}>
            {c.url}
          </ContextMenuItem>

          <DropdownMenuSeparator />

          <ContextMenuItem icon={MessageSquareText} onSelect={() => setSnippetsOpen(true)}>
            {c.promptSnippets}
          </ContextMenuItem>

          {attachmentProviders.length > 0 && <DropdownMenuSeparator />}
          {attachmentProviders.map(provider => (
            <DropdownMenuItem key={provider.key} onSelect={() => void provider.run({ insertText: onInsertText })}>
              <Codicon name={provider.icon ?? 'plug'} size="0.875rem" />
              <span>{provider.label}</span>
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />

          <div className="px-2 py-1 text-[0.6875rem] text-(--linear-text-hint)">
            {c.tipPre}
            <Kbd size="sm">@</Kbd>
            {c.tipPost}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <PromptSnippetsDialog onInsertText={onInsertText} onOpenChange={setSnippetsOpen} open={snippetsOpen} />
    </>
  )
}

function PromptSnippetsDialog({ onInsertText, onOpenChange, open }: PromptSnippetsDialogProps) {
  const { t } = useI18n()
  const c = t.composer

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{c.snippetsTitle}</DialogTitle>
          <DialogDescription>{c.snippetsDesc}</DialogDescription>
        </DialogHeader>
        <ul className="grid gap-1">
          {SNIPPET_KEYS.map(key => {
            const snippet = c.snippets[key]

            return (
              <li key={key}>
                <button
                  className="group/snippet flex w-full cursor-pointer items-start gap-2.5 rounded-(--linear-radius-control) px-2.5 py-2 text-left transition-colors duration-100 hover:bg-(--linear-hover-row) hover:transition-none focus-visible:bg-(--linear-hover-row) focus-visible:outline-none"
                  onClick={() => {
                    onInsertText(snippet.text)
                    onOpenChange(false)
                  }}
                  type="button"
                >
                  <MessageSquareText className="mt-px size-4 shrink-0 text-(--linear-icon)" />
                  <span className="grid min-w-0 gap-0.5">
                    <span className="text-[0.8125rem] font-medium text-(--linear-text-primary)">{snippet.label}</span>
                    <span className="text-xs text-(--linear-text-tertiary)">{snippet.description}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

export function ContextMenuItem({ children, disabled, icon: Icon, onSelect }: ContextMenuItemProps) {
  return (
    <DropdownMenuItem disabled={disabled} onSelect={onSelect}>
      <Icon />
      <span>{children}</span>
    </DropdownMenuItem>
  )
}

interface ContextMenuItemProps {
  children: string
  disabled?: boolean
  icon: IconComponent
  onSelect?: () => void
}

interface ContextMenuProps {
  onInsertText: (text: string) => void
  onOpenUrlDialog: () => void
  onPasteClipboardImage?: (opts?: { silent?: boolean }) => Promise<boolean> | void
  onPickFiles?: () => void
  onPickFolders?: () => void
  onPickImages?: () => void
  state: ChatBarState
}

interface PromptSnippetsDialogProps {
  onInsertText: (text: string) => void
  onOpenChange: (open: boolean) => void
  open: boolean
}
