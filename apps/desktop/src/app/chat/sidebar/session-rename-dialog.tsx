import { useStore } from '@nanostores/react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { KbdGroup } from '@/components/ui/kbd'
import { useI18n } from '@/i18n'
import { isSubmitEnter } from '@/lib/ime'
import { notify, notifyError } from '@/store/notifications'
import { applyRenamedSessionTitle } from '@/store/projects'
import { applySessionTitle } from '@/store/session'
import { $sessionRenameTarget, closeSessionRename, type SessionRenameTarget } from '@/store/session-rename'

import { renameSessionPreferringRpc } from './rename-session'

/**
 * One rename dialog for the whole sidebar. Both the row menu and ⌘R publish a
 * target into `$sessionRenameTarget`; this host renders the modal for it, so
 * there is a single submit path and a single visual treatment.
 */
export function SessionRenameDialog() {
  const target = useStore($sessionRenameTarget)

  if (!target) {
    return null
  }

  // Keyed so switching targets (menu on row B while ⌘R named row A) starts with
  // the new title rather than the previous edit.
  return <RenameSessionDialog key={`${target.sessionId}\u0000${target.title}`} target={target} />
}

function RenameSessionDialog({ target }: { target: SessionRenameTarget }) {
  const { t } = useI18n()
  const r = t.sidebar.row
  const [value, setValue] = useState(target.title)
  const [submitting, setSubmitting] = useState(false)

  // The dialog-owned ref rather than `autoFocus`: Radix focuses the first
  // focusable node, and selecting the existing name is the edit everyone makes.
  const inputRef = (node: HTMLInputElement | null) => {
    if (node && document.activeElement !== node) {
      node.focus({ preventScroll: true })
      node.select()
    }
  }

  const close = () => {
    if (!submitting) {
      closeSessionRename()
    }
  }

  const submit = async () => {
    const next = value.trim()

    if (submitting) {
      return
    }

    if (next === target.title.trim()) {
      closeSessionRename()

      return
    }

    setSubmitting(true)

    try {
      const result = await renameSessionPreferringRpc(target.sessionId, next, target.profile)
      const finalTitle = result.title || next || ''
      // One write, every list: patch the main store AND the project surfaces.
      applySessionTitle(target.sessionId, finalTitle || null)
      applyRenamedSessionTitle(target.sessionId, finalTitle || null)
      notify({ durationMs: 2_000, kind: 'success', message: r.renamed })
      closeSessionRename()
    } catch (err) {
      notifyError(err, r.renameFailed)
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      onOpenChange={open => {
        if (!open) {
          close()
        }
      }}
      open
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{r.renameTitle}</DialogTitle>
          <DialogDescription>{r.renameDesc}</DialogDescription>
        </DialogHeader>
        <Input
          aria-label={r.rename}
          className="h-9 text-sm"
          disabled={submitting}
          onChange={event => setValue(event.target.value)}
          onKeyDown={event => {
            if (isSubmitEnter(event)) {
              event.preventDefault()
              void submit()
            }
          }}
          placeholder={r.untitledPlaceholder}
          ref={inputRef}
          value={value}
        />
        <DialogFooter className="items-center justify-between gap-2">
          <span className="hidden items-center gap-1 text-[0.6875rem] text-(--ui-text-quaternary) sm:flex">
            <KbdGroup keys={['enter']} size="sm" />
            <span>{t.common.save}</span>
            <span aria-hidden="true">·</span>
            <KbdGroup keys={['escape']} size="sm" />
            <span>{t.common.cancel}</span>
          </span>
          <span className="flex items-center gap-2">
            <Button disabled={submitting} onClick={close} size="sm" type="button" variant="ghost">
              {t.common.cancel}
            </Button>
            <Button disabled={submitting} onClick={() => void submit()} size="sm" type="button">
              {t.common.save}
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
