import { useStore } from '@nanostores/react'
import type * as React from 'react'
import { useEffect, useRef, useState } from 'react'

import { openSession } from '@/app/open-session'
import {
  closeAllTreeTabs,
  closeOtherTreeTabs,
  closeTreeTabsToRight,
  reloadTreePane,
  treeTabCloseTargets
} from '@/components/pane-shell/tree/store'
import {
  type ActionItemSpec,
  ActionsContextMenu,
  ActionsMenu,
  type MenuKit,
  renderActionItem
} from '@/components/ui/actions-menu'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { CopyButton } from '@/components/ui/copy-button'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { ArchiveOff } from '@/lib/icons'
import { exportSession } from '@/lib/session-export'
import { notifyError } from '@/store/notifications'
import {
  $connection,
  $selectedStoredSessionId,
  $sessions,
  $unreadFinishedSessionIds,
  markSessionRead,
  sessionMatchesStoredId
} from '@/store/session'
import { requestSessionRename } from '@/store/session-rename'
import { $sessionTiles, closeAllOpenSessionTiles } from '@/store/session-states'
import { ackStoredSessionId } from '@/store/session-unread'
import { canOpenSessionInTerminal, canOpenSessionWindow, openSessionInTerminal } from '@/store/windows'

interface SessionActions {
  sessionId: string
  title: string
  pinned?: boolean
  /** Backend-derived read state — drives the Mark as unread/read label. */
  unread?: boolean
  /** The row is already archived (the sidebar's Archived view): the shared
   *  archive verb becomes Unarchive and restores the session (#98813). */
  archived?: boolean
  profile?: string
  onPin?: () => void
  /** Toggle the persisted read-state watermark for this row. */
  onToggleUnread?: () => void
  onBranch?: () => void
  onArchive?: () => void
  onDelete?: () => void
  /** Close this surface (a tile tab) — omitted where nothing closes (sidebar
   *  rows, the main tab). */
  onClose?: () => void
  /** TAB surfaces: the session is already a tab, so "Open in new tab" is
   *  nonsense there — sidebar rows/dropdowns keep it. */
  surface?: 'row' | 'tab'
  /** May this session be renamed? False for a canonical Bot Chat tab: its
   *  exact title is the bot's identity (the backend guard refuses a user
   *  rename and the caption never reads the stored title anyway — #124857),
   *  so the Rename item and dialog are omitted instead of toasting success
   *  over a no-op. Mirrors how onPin/onBranch are gated. */
  renameable?: boolean
  /** The tab's layout-tree pane id (`session-tile:<id>` or `workspace`) — enables
   *  the Close-others / to-the-right / all tab verbs. Tab surfaces only. */
  tabPaneId?: string
  /** The MAIN tab's escape hatch: hide the zone's tab bar (it sticky-shows
   *  once a tab is ever gained; this is the explicit off switch). */
  onHideTabBar?: () => void
}

function useSessionActions({
  sessionId,
  title,
  pinned = false,
  unread = false,
  archived = false,
  profile,
  onPin,
  onToggleUnread,
  onBranch,
  onArchive,
  onDelete,
  onClose,
  onHideTabBar,
  renameable = true,
  surface = 'row',
  tabPaneId
}: SessionActions) {
  const { t } = useI18n()
  const r = t.sidebar.row
  // Rename opens the sidebar's single rename dialog (store-driven, so ⌘R can
  // open the same one). When the menu closes, Radix restores focus to its
  // trigger — for a sidebar row that trigger is the row's own <button>, so
  // focus would land there instead of the dialog input: Space then activates
  // the row and the arrow keys move the list rather than the caret. Suppress
  // that one restore so the dialog keeps focus; every other action leaves the
  // restore alone (it's the correct behavior for them).
  const suppressCloseFocusRef = useRef(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const tiles = useStore($sessionTiles)
  const selectedStoredSessionId = useStore($selectedStoredSessionId)
  const isRemote = useStore($connection)?.mode === 'remote'
  // The row's finished-unread dot is cleared by opening the session (main or
  // tile) — this menu item is the explicit escape hatch for the rest.
  const isUnread = useStore($unreadFinishedSessionIds).includes(sessionId)

  // Already showing as a tab somewhere (a tile, or loaded in main — main IS
  // a tab): offering "Open in new tab" again is noise.
  const alreadyTabbed = sessionId === selectedStoredSessionId || tiles.some(tile => tile.storedSessionId === sessionId)

  const spec = (partial: Omit<ActionItemSpec, 'onSelect'> & { onSelect: () => void }): ActionItemSpec => partial

  // OPEN — where else this session can go. A tab surface IS a tab already,
  // so it only offers the window hop (and its own Close, below).
  const openItems: ActionItemSpec[] = [
    ...(surface === 'row' && !alreadyTabbed
      ? [
          spec({
            disabled: !sessionId,
            icon: 'browser',
            label: r.openInNewTab,
            onSelect: () => {
              triggerHaptic('selection')
              // Stack into the MAIN zone as a tab (center dock; the strip
              // sticky-shows on gain) — the door to the tab bar. Focuses first
              // if the session is already on screen.
              openSession(sessionId, () => undefined, 'tab')
            }
          })
        ]
      : []),
    ...(canOpenSessionWindow()
      ? [
          spec({
            disabled: !sessionId,
            icon: 'link-external',
            label: r.newWindow,
            onSelect: () => {
              triggerHaptic('selection')
              openSession(sessionId, () => undefined, 'window')
            }
          })
        ]
      : []),
    // The user's OWN terminal, not the in-app pane: resumes the session in the
    // TUI. Hidden on a remote connection — the emulator we'd open runs on this
    // machine while the session (and its runtime) lives on the remote host.
    ...(canOpenSessionInTerminal() && !isRemote
      ? [
          spec({
            disabled: !sessionId,
            icon: 'terminal',
            label: r.openInTerminal,
            onSelect: () => {
              triggerHaptic('selection')

              // Read the row lazily: subscribing every row's menu to $sessions
              // would re-render the whole sidebar on each session update.
              const cwd =
                $sessions
                  .get()
                  .find(s => sessionMatchesStoredId(s, sessionId))
                  ?.cwd?.trim() || undefined

              void openSessionInTerminal(sessionId, { cwd, profile })
            }
          })
        ]
      : [])
  ]

  // IDENTITY — name/mark/reference the session. Rename is omitted (not
  // disabled) for a session whose title is not its name — a canonical Bot
  // Chat — so the menu never offers a verb whose result the user cannot see.
  const identityItems: ActionItemSpec[] = [
    ...(renameable
      ? [
          spec({
            disabled: !sessionId,
            icon: 'edit',
            label: r.rename,
            onSelect: () => {
              triggerHaptic('selection')
              // Keep focus off the row trigger so it lands in the dialog input.
              suppressCloseFocusRef.current = true
              requestSessionRename({ profile, sessionId, title })
            }
          })
        ]
      : []),
    spec({
      disabled: !onPin,
      icon: 'pin',
      label: pinned ? r.unpin : r.pin,
      onSelect: () => {
        triggerHaptic('selection')
        onPin?.()
      }
    }),
    // One read-state item, driven by BOTH unread sources: the transient
    // finished-unread dot (isUnread) and the backend watermark (unread).
    // "Mark as read" clears whichever is lit; "Mark as unread" arms the
    // persisted watermark so the dot survives restarts.
    spec({
      disabled: !sessionId || (!onToggleUnread && !isUnread),
      // Closed envelope = unread, open envelope = read (codicon has mail and
      // mail-read, but no mail-unread glyph — verified against the font css).
      icon: unread || isUnread ? 'mail-read' : 'mail',
      label: unread || isUnread ? r.markRead : r.markUnread,
      onSelect: () => {
        triggerHaptic('selection')

        if (unread || isUnread) {
          // Clear the transient family dot immediately (and ack the persisted
          // watermark/marker so a list refresh doesn't repaint it)…
          markSessionRead(sessionId)
          ackStoredSessionId(sessionId)

          // …and retire the persisted watermark when the row carries one.
          if (unread) {
            onToggleUnread?.()
          }
        } else {
          onToggleUnread?.()
        }
      }
    })
  ]

  // WORK — derive/extract from the session.
  const workItems: ActionItemSpec[] = [
    spec({
      disabled: !onBranch,
      // Fork glyph to match the inline message action's GitFork icon
      // (assistant-message.tsx). NB: this codicon font has no `git-fork`
      // glyph (only `git-fork-private`); `repo-forked` is the fork icon.
      icon: 'repo-forked',
      label: r.branchFrom,
      onSelect: () => {
        triggerHaptic('selection')
        onBranch?.()
      }
    }),
    spec({
      disabled: !sessionId,
      icon: 'cloud-download',
      label: r.export,
      onSelect: () => {
        triggerHaptic('selection')
        void exportSession(sessionId, { profile, title })
      }
    })
  ]

  // TAB — verbs that act on the strip (tabs only; a row isn't a tab).
  const closeTargets = surface === 'tab' && tabPaneId ? treeTabCloseTargets(tabPaneId) : null

  const tabItems: ActionItemSpec[] =
    surface === 'tab'
      ? [
          ...(tabPaneId
            ? [
                spec({
                  icon: 'refresh',
                  label: t.zones.reload,
                  onSelect: () => {
                    triggerHaptic('selection')
                    reloadTreePane(tabPaneId)
                  }
                })
              ]
            : []),
          ...(onClose
            ? [
                spec({
                  disabled: false,
                  icon: 'close',
                  label: t.common.close,
                  onSelect: () => {
                    triggerHaptic('selection')
                    onClose()
                  }
                })
              ]
            : []),
          ...(tabPaneId
            ? [
                spec({
                  disabled: !closeTargets?.others,
                  icon: 'close-all',
                  label: t.zones.closeOthers,
                  onSelect: () => {
                    triggerHaptic('selection')
                    closeOtherTreeTabs(tabPaneId)
                  }
                }),
                spec({
                  disabled: !closeTargets?.right,
                  icon: 'arrow-right',
                  label: t.zones.closeToRight,
                  onSelect: () => {
                    triggerHaptic('selection')
                    closeTreeTabsToRight(tabPaneId)
                  }
                }),
                spec({
                  disabled: !closeTargets?.all,
                  icon: 'clear-all',
                  label: t.zones.closeAll,
                  onSelect: () => {
                    triggerHaptic('selection')
                    // Persist-close session tiles before dismissing the
                    // remaining tree panes, or Bot Mode rehydrates them
                    // from the shared tile bucket (#94137).
                    closeAllOpenSessionTiles(tabPaneId)
                    closeAllTreeTabs(tabPaneId)
                  }
                })
              ]
            : [])
        ]
      : []

  // DANGER — put it away / destroy it (delete stays last, destructive-red).
  const dangerItems: ActionItemSpec[] = [
    spec({
      disabled: !onArchive,
      // Already archived (the Archived view): the same verb restores the row
      // instead of re-archiving it (#98813). The wiring dispatches the shared
      // onArchive callback to the restore path based on the row's state. No
      // unarchive codicon exists, so the restore item carries the ArchiveOff
      // glyph the Settings → Archived Chats restore button already uses.
      icon: archived ? undefined : 'archive',
      iconNode: archived ? <ArchiveOff className="size-3.5" /> : undefined,
      label: archived ? r.unarchive : r.archive,
      onSelect: () => {
        triggerHaptic('selection')
        onArchive?.()
      }
    }),
    {
      className: 'text-(--linear-red) focus:text-(--linear-red)',
      disabled: !onDelete,
      icon: 'trash',
      label: t.common.delete,
      onSelect: () => {
        triggerHaptic('warning')

        // Deleting is irreversible (the CLI path asks y/N; the desktop used to
        // fire instantly on click). Gate it behind an explicit confirm — see
        // #61470. The dialog owns the delete call, so every surface that routes
        // through this menu (sidebar rows, tab menus, the chat header) gets the
        // guard for free.
        if (onDelete) {
          setDeleteOpen(true)
        }
      },
      variant: 'destructive'
    }
  ]

  const renderItems = (kit: MenuKit) => (
    <>
      {openItems.map(item => renderActionItem(kit, item))}
      {openItems.length > 0 && <kit.Separator />}
      {identityItems.map(item => renderActionItem(kit, item))}
      <CopyButton
        appearance={kit.copyAppearance}
        disabled={!sessionId}
        errorMessage={r.copyIdFailed}
        iconClassName="size-3.5 text-current"
        key={r.copyId}
        label={r.copyId}
        onCopyError={err => notifyError(err, r.copyIdFailed)}
        text={sessionId}
      />
      <kit.Separator />
      {workItems.map(item => renderActionItem(kit, item))}
      {tabItems.length > 0 && (
        <>
          <kit.Separator />
          {tabItems.map(item => renderActionItem(kit, item))}
        </>
      )}
      <kit.Separator />
      {dangerItems.map(item => renderActionItem(kit, item))}
      {onHideTabBar && (
        <>
          <kit.Separator />
          {renderActionItem(kit, {
            disabled: false,
            icon: 'eye-closed',
            label: r.hideTabBar,
            onSelect: () => {
              triggerHaptic('selection')
              onHideTabBar()
            }
          })}
        </>
      )}
    </>
  )

  // Consumed once per close: when rename was the action that closed the menu,
  // block Radix's focus-restore to the trigger so the dialog input keeps focus.
  const onCloseAutoFocus = (event: Event) => {
    if (suppressCloseFocusRef.current) {
      suppressCloseFocusRef.current = false
      event.preventDefault()
    }
  }

  const deleteDialog = (
    <DeleteSessionDialog
      onConfirm={() => {
        onDelete?.()
      }}
      onOpenChange={setDeleteOpen}
      open={deleteOpen}
      sessionTitle={title}
    />
  )

  return { deleteDialog, onCloseAutoFocus, renderItems }
}

interface DeleteSessionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  sessionTitle: string
}

// Thin wrapper over ConfirmDialog — the single choke point for every session
// delete entry point (sidebar rows, tab menus, the chat header). Deleting a
// session is irreversible and the desktop used to fire it instantly on click
// (#61470); this mirrors the CLI's y/N guard. onConfirm is the fire-and-forget
// delete call; ConfirmDialog owns the busy/done beat and Enter-to-confirm.
function DeleteSessionDialog({ open, onOpenChange, onConfirm, sessionTitle }: DeleteSessionDialogProps) {
  const { t } = useI18n()
  const r = t.sidebar.row

  return (
    <ConfirmDialog
      busyLabel={r.deleting}
      confirmLabel={t.common.delete}
      description={r.deleteDesc(sessionTitle)}
      destructive
      doneLabel={r.deleted}
      onClose={() => onOpenChange(false)}
      onConfirm={onConfirm}
      open={open}
      title={r.deleteTitle}
    />
  )
}

interface SessionActionsMenuProps
  extends SessionActions, Pick<React.ComponentProps<typeof ActionsMenu>, 'align' | 'sideOffset'> {
  children: React.ReactNode
}

export function SessionActionsMenu({ children, align = 'end', sideOffset = 6, ...actions }: SessionActionsMenuProps) {
  const { t } = useI18n()
  const { deleteDialog, onCloseAutoFocus, renderItems } = useSessionActions(actions)

  return (
    <>
      <ActionsMenu
        align={align}
        ariaLabel={t.sidebar.row.sessionActions}
        items={renderItems}
        onCloseAutoFocus={onCloseAutoFocus}
        sideOffset={sideOffset}
      >
        {children}
      </ActionsMenu>
      {deleteDialog}
    </>
  )
}

interface SessionContextMenuProps extends SessionActions {
  children: React.ReactNode
}

export function SessionContextMenu({ children, ...actions }: SessionContextMenuProps) {
  const { t } = useI18n()
  const { deleteDialog, onCloseAutoFocus, renderItems } = useSessionActions(actions)
  const [open, setOpen] = useState(false)

  // A right-click menu is a keyboard target in its own right. Keep the
  // selected session in the main pane untouched, but let A/P act on the row
  // whose menu is open. Archived rows reuse the same callback for restore.
  useEffect(() => {
    if (!open) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return
      }

      const key = event.key.toLowerCase()

      if (key !== 'a' && key !== 'p') {
        return
      }

      const action = key === 'a' ? actions.onArchive : actions.onPin

      if (!action) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      triggerHaptic('selection')
      action()
    }

    document.addEventListener('keydown', onKeyDown, true)

    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [actions.onArchive, actions.onPin, open])

  return (
    <>
      <ActionsContextMenu
        ariaLabel={t.sidebar.row.sessionActions}
        items={renderItems}
        onCloseAutoFocus={onCloseAutoFocus}
        onOpenChange={setOpen}
      >
        {children}
      </ActionsContextMenu>
      {deleteDialog}
    </>
  )
}
