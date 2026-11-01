import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { SETTINGS_ROUTE } from '@/app/routes'
import { SETTING_IDS } from '@/app/settings/settings-manifest'
import { settingsSearchTargetQuery } from '@/app/settings/settings-search'
import { BrandMark } from '@/components/brand-mark'
import { SyncStatusCard } from '@/components/sync-status-card'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  preventCloseButtonAutoFocus
} from '@/components/ui/dialog'
import { ErrorIcon, ErrorState } from '@/components/ui/error-state'
import { Loader } from '@/components/ui/loader'
import { Progress } from '@/components/ui/progress'
import { UpdateStatusCard, VersionHero } from '@/components/update-status'
import { VersionDetails } from '@/components/version-details'
import type {
  DesktopUpdateCommit,
  DesktopUpdateStage,
  DesktopUpdateStatus,
  DesktopVersionInfo,
  UpdaterMechanismClient
} from '@/global'
import { useI18n } from '@/i18n'
import { writeClipboardText } from '@/lib/clipboard'
import { buildCommitChangelog, type CommitGroup, formatFullChangelogText } from '@/lib/commit-changelog'
import { AlertCircle, Check, Copy, ExternalLink, Terminal } from '@/lib/icons'
import { resolveUpdateCopy, rollbackRelease, type UpdateTarget } from '@/lib/update-copy'
import { fetchUpdateNoteItems, updateNotesSource, updateNotesUrl, updateReleaseTag } from '@/lib/update-notes'
import { cn } from '@/lib/utils'
import {
  $backendUpdateApply,
  $backendUpdateChecking,
  $backendUpdateStatus,
  $desktopVersion,
  $updateApply,
  $updateChecking,
  $updateOverlayOpen,
  $updateOverlayTarget,
  $updateStatus,
  applyBackendUpdate,
  applyUpdates,
  checkBackendUpdates,
  checkUpdates,
  dismissDiscontinuedNotice,
  resetUpdateApplyState,
  setUpdateOverlayOpen,
  sourceUpdateChannel,
  type UpdateApplyState
} from '@/store/updates'

import { DiscontinuedNotice } from './retirement-view'

function totalItems(groups: readonly CommitGroup[]) {
  return groups.reduce((sum, g) => sum + g.items.length, 0)
}

/** Release notes (stable) or the latest merged PRs (main); undefined while loading. */
function useUpdateNotes(status: DesktopUpdateStatus | null, updateAvailable: boolean) {
  const enabled = Boolean(status?.supported && !status.error && updateAvailable)
  const source = status && enabled ? updateNotesSource(status) : null
  const [items, setItems] = useState<{ for: DesktopUpdateStatus; items: string[] } | null>(null)

  useEffect(() => {
    const notesSource = status && enabled ? updateNotesSource(status) : null

    if (!status || !notesSource) {
      return
    }

    let live = true

    void fetchUpdateNoteItems(notesSource, status).then(next => live && setItems({ for: status, items: next }))

    return () => {
      live = false
    }
  }, [enabled, status])

  return {
    items: items?.for === status ? items.items : undefined,
    kind: source?.kind,
    url: source && status ? updateNotesUrl(source, status) : null
  }
}

type UpdateNotesView = ReturnType<typeof useUpdateNotes>

/** The dialog's change list: fetched notes when they exist, else the commit changelog; plus the onward link. */
function UpdateChangeList({
  commitGroups,
  copyText,
  notes: fetched,
  rollback
}: {
  commitGroups: readonly CommitGroup[]
  copyText?: () => string
  notes: UpdateNotesView
  rollback: boolean
}) {
  const { t } = useI18n()
  const u = t.updates
  // A rollback brings no new changes; the "improvements" fallback would claim some.
  const notes = rollback ? null : fetched
  const pending = Boolean(notes?.url) && notes?.items === undefined

  const shown: readonly CommitGroup[] =
    rollback || pending
      ? []
      : notes?.items?.length
        ? [{ id: 'new', items: notes.items, label: u.changeLogNew }]
        : commitGroups

  return (
    <div className="grid gap-3">
      {pending && <Loader className="mx-auto size-5" label={u.checking} type="lemniscate-bloom" />}
      {shown.map((group, index) => (
        <div key={group.id}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-(--linear-text-tertiary)">{group.label}</p>
            {index === 0 && copyText && (
              <CopyButton
                appearance="icon"
                buttonSize="icon-xs"
                className="-my-1 shrink-0"
                iconClassName="size-3"
                label={u.copyFullLog}
                side="left"
                text={copyText}
              />
            )}
          </div>
          <ul className="mt-1.5 grid gap-1.5 text-[0.8125rem] text-(--linear-text-secondary)">
            {group.items.map(item => (
              <li className="flex items-start gap-2" key={item}>
                <span aria-hidden className="mt-2 inline-block size-1 shrink-0 rounded-full bg-(--linear-accent)" />
                <span className="line-clamp-2 leading-snug" title={item}>
                  {item}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {notes?.url && (
        <a
          className="inline-flex items-center gap-1 text-xs font-medium text-(--linear-accent) underline-offset-2 hover:underline"
          href={notes.url}
          onClick={event => {
            event.preventDefault()
            void window.hermesDesktop?.openExternal?.(event.currentTarget.href)
          }}
          rel="noreferrer"
          target="_blank"
        >
          <ExternalLink className="size-3" />
          {notes.kind === 'release' ? u.releaseNotes : t.settings.about.channel.allChanges}
        </a>
      )}
    </div>
  )
}

export function UpdatesOverlay() {
  const open = useStore($updateOverlayOpen)
  const target = useStore($updateOverlayTarget)

  const clientStatus = useStore($updateStatus)
  const clientChecking = useStore($updateChecking)
  const clientApply = useStore($updateApply)
  const backendStatus = useStore($backendUpdateStatus)
  const backendChecking = useStore($backendUpdateChecking)
  const backendApply = useStore($backendUpdateApply)
  const desktopVersion = useStore($desktopVersion)

  const isBackend = target === 'backend'
  const status = isBackend ? backendStatus : clientStatus
  const checking = isBackend ? backendChecking : clientChecking
  const apply = isBackend ? backendApply : clientApply
  const check = isBackend ? checkBackendUpdates : checkUpdates
  const install = isBackend ? applyBackendUpdate : applyUpdates

  useEffect(() => {
    if (open && !status && !checking) {
      void check()
    }
  }, [check, checking, open, status])

  const behind = status?.behind ?? 0
  const updateAvailable = status?.updateAvailable || behind > 0

  const phase: 'idle' | 'applying' | 'manual' | 'guiSkew' | 'error' =
    apply.stage === 'manual'
      ? 'manual'
      : apply.stage === 'guiSkew'
        ? 'guiSkew'
        : apply.applying || apply.stage === 'restart'
          ? 'applying'
          : apply.stage === 'error'
            ? 'error'
            : 'idle'

  const handleClose = (next: boolean) => {
    if (phase === 'applying') {
      return
    }

    setUpdateOverlayOpen(next)

    if (
      !next &&
      (apply.stage === 'error' || apply.stage === 'restart' || apply.stage === 'manual' || apply.stage === 'guiSkew')
    ) {
      resetUpdateApplyState()
    }
  }

  const handleInstall = () => {
    void install()
  }

  return (
    <Dialog onOpenChange={handleClose} open={open}>
      {/* This dialog has no inputs, so Radix's default autofocus would land on
          the close button and trigger its tooltip immediately on open. */}
      <DialogContent
        bodyClassName="overflow-hidden p-0 gap-0"
        className="max-w-sm"
        onOpenAutoFocus={preventCloseButtonAutoFocus}
        showCloseButton={phase !== 'applying'}
      >
        {phase === 'applying' && (
          <ApplyingView apply={apply} isBackend={isBackend} statusMechanism={status?.mechanism} />
        )}

        {phase === 'manual' && (
          <ManualView
            command={apply.command ?? null}
            isBackend={isBackend}
            message={apply.message}
            onDone={() => handleClose(false)}
          />
        )}

        {phase === 'guiSkew' && <GuiSkewView message={apply.message} onDone={() => handleClose(false)} />}

        {phase === 'error' ? (
          <ErrorView message={apply.message} onDismiss={() => handleClose(false)} onRetry={handleInstall} />
        ) : null}

        {phase === 'idle' && !isBackend && status?.retirement?.state === 'discontinued' && (
          <DiscontinuedNotice
            onDismiss={() => {
              dismissDiscontinuedNotice(status.retirement!)
              handleClose(false)
            }}
            retirement={status.retirement}
          />
        )}
        {phase === 'idle' && (isBackend || !status?.retirement) && (
          <IdleView
            behind={behind}
            checking={checking}
            commits={status?.commits ?? []}
            onInstall={handleInstall}
            onLater={() => handleClose(false)}
            onRetryCheck={() => void check()}
            status={status}
            target={target}
            updateAvailable={updateAvailable}
            version={desktopVersion}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function IdleView({
  behind,
  checking,
  commits,
  onInstall,
  onLater,
  onRetryCheck,
  status,
  target,
  updateAvailable,
  version
}: {
  behind: number
  checking: boolean
  commits: readonly DesktopUpdateCommit[]
  onInstall: () => void
  onLater: () => void
  onRetryCheck: () => void
  status: DesktopUpdateStatus | null
  target: UpdateTarget
  updateAvailable: boolean
  version: DesktopVersionInfo | null
}) {
  const { t } = useI18n()
  const u = t.updates
  const notes = useUpdateNotes(status, updateAvailable)

  if (!status && checking) {
    return (
      <CenteredStatus
        icon={<Loader className="size-12" label={u.checking} type="lemniscate-bloom" />}
        title={u.checking}
      />
    )
  }

  if (!status) {
    return (
      <CenteredStatus
        action={
          <Button onClick={onRetryCheck} size="sm">
            {u.tryAgain}
          </Button>
        }
        icon={<ErrorIcon />}
        title={u.checkFailedTitle}
      />
    )
  }

  // The channel is chosen in Settings (with its confirm step); here it is named, with a way there.
  const changeChannel = (
    <button
      className="cursor-pointer text-(--linear-accent) underline-offset-2 hover:underline"
      onClick={() => {
        setUpdateOverlayOpen(false)
        window.location.hash = `#${SETTINGS_ROUTE}?${settingsSearchTargetQuery({ view: 'about', setting: SETTING_IDS.about.updates })}`
      }}
      type="button"
    >
      {t.settings.about.channel.change}
    </button>
  )

  // Only where Settings shows a selector: a custom branch or an older runtime gets the label alone.
  const details = version ? (
    <VersionDetails channelAction={sourceUpdateChannel(status) ? changeChannel : undefined} version={version} />
  ) : null

  // App-installer check-unknown (OS checker unavailable): NOT "no updates"
  // and NOT a generic error — the OS also installs updates automatically on
  // restart (it re-reads the .appinstaller feed on every launch), so the
  // honest view names that path. Only this mechanism gets it.
  if (status.mechanism === 'app-installer' && status.error && !status.updateAvailable) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 px-6 pb-6 pt-1">
        <VersionHero renderHeading={heading => <DialogTitle>{heading}</DialogTitle>} version={version} />
        <div className="flex flex-col items-center gap-2 text-center">
          <AlertCircle className="size-6 text-(--linear-text-tertiary)" />
          <p className="text-[0.8125rem] font-medium text-(--linear-text-primary)">{u.checkUnknownTitleAppInstaller}</p>
          <p className="max-w-prose text-[0.8125rem] leading-5 text-(--linear-text-tertiary)">
            {u.checkUnknownBodyAppInstaller}
          </p>
        </div>
        <Button onClick={onRetryCheck} size="sm">
          {u.tryAgain}
        </Button>
        {details}
      </div>
    )
  }

  // Everything that is NOT the install pitch — unsupported, check error, and
  // already-latest — is exactly the About page's state: render the shared
  // hero + status card so the two surfaces cannot drift. The card owns the
  // check/retry actions (its "Check now" covers the old Try-again button).
  if (!status.supported || status.error || !updateAvailable) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 px-6 pb-6 pt-1">
        <VersionHero renderHeading={heading => <DialogTitle>{heading}</DialogTitle>} version={version} />
        <UpdateStatusCard target={target} version={version} />
        <SyncStatusCard />
        {details}
      </div>
    )
  }

  const groups = buildCommitChangelog(commits, {
    labels: {
      new: u.changeLogNew,
      fixed: u.changeLogFixed,
      faster: u.changeLogFaster,
      improved: u.changeLogImproved,
      other: u.changeLogOther
    },
    fallback: { label: u.changeLogFallbackLabel, item: u.changeLogFallbackItem }
  })

  // Notes are their own summary and link onward, so the commit count tail would mismatch them.
  const shownItems = totalItems(groups)
  const remaining = notes.items?.length ? 0 : Math.max(0, behind - shownItems)

  // Name what's being updated. In remote mode the overlay acts on the connected
  // backend, not the local client — say so. When there are no commit rows to
  // show (e.g. pip/non-git backend), degrade to honest "no release notes" copy
  // instead of generic filler. On a release-feed channel (stable), name the
  // release tag instead of commit vocabulary.
  // A stable release this checkout already contains is a move back, never "a new update".
  const rollbackTag = rollbackRelease(status)
  const channelCopy = t.settings.about.channel

  const { title, body } = rollbackTag
    ? { title: channelCopy.rollbackTitle(rollbackTag), body: channelCopy.rollbackBody(rollbackTag) }
    : resolveUpdateCopy({
        target,
        shownItems,
        channel: status?.channel === 'stable' ? 'stable' : 'main',
        latestTag: updateReleaseTag(status),
        mechanism: status?.mechanism,
        copy: u
      })

  const handleCopyFullLog = () => formatFullChangelogText(commits, behind, status.branch)

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 px-6 pb-6 pt-7">
      <div className="flex flex-col items-center gap-3 text-center">
        <BrandMark className="size-16" />

        <DialogTitle className="text-center">{title}</DialogTitle>
        <DialogDescription className="text-center">{body}</DialogDescription>
      </div>

      <UpdateChangeList
        commitGroups={groups}
        copyText={commits.length > 0 ? handleCopyFullLog : undefined}
        notes={notes}
        rollback={Boolean(rollbackTag)}
      />

      <div className="grid gap-2">
        <Button onClick={onInstall} size="lg">
          {rollbackTag ? channelCopy.rollbackAction(rollbackTag) : u.updateNow}
        </Button>
        <Button onClick={onLater} type="button" variant="text">
          {u.maybeLater}
        </Button>
      </div>

      {remaining > 0 && <p className="text-center text-xs text-(--linear-text-tertiary)">{u.moreChanges(remaining)}</p>}

      <SyncStatusCard />
    </div>
  )
}

function ManualView({
  command,
  isBackend,
  message,
  onDone
}: {
  command: string | null
  isBackend: boolean
  message?: string
  onDone: () => void
}) {
  const { t } = useI18n()
  const u = t.updates
  const [copied, setCopied] = useState(false)
  const guidance: string | undefined = message && message !== command ? message : undefined

  const handleCopy = () => {
    if (!command) {
      return
    }

    void writeClipboardText(command).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    })
  }

  // No command (e.g. the Linux sandbox-blocked relaunch): render the explanatory
  // message + a Done button, not a copy-a-command box.
  if (!command) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 px-6 pb-6 pt-7">
        <div className="flex flex-col items-center gap-3 text-center">
          <Terminal className="size-8 text-(--linear-accent)" />

          <DialogTitle className="text-center">{isBackend ? u.manualUnavailableTitle : u.manualTitle}</DialogTitle>
          <DialogDescription className="text-center">{message || u.manualPickedUp}</DialogDescription>
        </div>

        <Button onClick={onDone} size="lg" variant="secondary">
          {u.done}
        </Button>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 px-6 pb-6 pt-7">
      <div className="flex flex-col items-center gap-3 text-center">
        <Terminal className="size-8 text-(--linear-accent)" />

        <DialogTitle className="text-center">{u.manualTitle}</DialogTitle>
        <DialogDescription className="text-center">
          {guidance ?? (isBackend ? u.manualBodyBackend : u.manualBody)}
        </DialogDescription>
      </div>

      <button
        className={cn(
          'group flex w-full cursor-pointer items-center justify-between gap-3 rounded-(--linear-radius-control) border-[0.5px] px-4 py-3 text-left transition-colors duration-(--linear-speed-quick)',
          copied
            ? 'border-(--linear-accent)'
            : 'border-(--linear-border-secondary) hover:border-(--linear-border-tertiary)'
        )}
        onClick={handleCopy}
        type="button"
      >
        <code className="min-w-0 flex-1 truncate font-mono text-[0.8125rem] text-(--linear-text-primary) select-all">
          <span className="text-(--linear-text-tertiary) select-none">$ </span>
          {command}
        </code>
        <span
          className={cn(
            'flex shrink-0 items-center gap-1 text-xs font-medium transition-colors',
            copied ? 'text-(--linear-accent)' : 'text-(--linear-text-tertiary) group-hover:text-(--linear-text-primary)'
          )}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? u.copied : u.copy}
        </span>
      </button>

      {!guidance && (
        <p className="text-center text-xs text-(--linear-text-tertiary)">
          {isBackend ? u.manualPickedUpBackend : u.manualPickedUp}
        </p>
      )}

      <Button onClick={onDone} size="lg" variant="secondary">
        {u.done}
      </Button>
    </div>
  )
}

// Linux GUI/backend skew (#45205): backend updated, but the running desktop app
// package (AppImage/.deb/.rpm) was NOT changed. Closeable terminal state that
// tells the user to update/reinstall the desktop app — never claims the GUI was
// updated.
function GuiSkewView({ message, onDone }: { message?: string; onDone: () => void }) {
  const { t } = useI18n()
  const u = t.updates

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 px-6 pb-6 pt-7">
      <div className="flex flex-col items-center gap-3 text-center">
        <AlertCircle className="size-8 text-(--linear-orange)" />

        <DialogTitle className="text-center">{u.guiSkewTitle}</DialogTitle>
        <DialogDescription className="max-w-prose text-center">{message || u.guiSkewBody}</DialogDescription>
      </div>

      <Button onClick={onDone} size="lg" variant="secondary">
        {u.done}
      </Button>
    </div>
  )
}

function ApplyingView({
  apply,
  isBackend,
  statusMechanism
}: {
  apply: UpdateApplyState
  isBackend: boolean
  statusMechanism?: UpdaterMechanismClient
}) {
  const { t } = useI18n()
  const u = t.updates
  const label = u.stages[apply.stage as DesktopUpdateStage] ?? u.stages.idle
  const isWindowsPackage = statusMechanism === 'app-installer' || statusMechanism === 'microsoft-store'

  const body = isWindowsPackage ? u.applyingBodyAppInstaller : isBackend ? u.applyingBodyBackend : u.applyingBody

  const currentMessage = apply.message.trim()
  const recentLog = apply.log.slice(-4)

  const percent =
    typeof apply.percent === 'number' && Number.isFinite(apply.percent)
      ? Math.max(2, Math.min(100, Math.round(apply.percent)))
      : null

  return (
    <div className="grid gap-5 px-6 pb-6 pt-7">
      <div className="flex flex-col items-center gap-3 text-center">
        <Loader className="size-16" label={label} type="lemniscate-bloom" />

        <DialogTitle className="text-center">{label}</DialogTitle>
        <DialogDescription className="text-center">{body}</DialogDescription>

        {currentMessage ? (
          <p className="max-w-lg break-words text-center text-xs leading-5 text-(--linear-text-tertiary)">
            {currentMessage}
          </p>
        ) : null}
      </div>

      <Progress
        aria-label={label}
        indeterminate={percent === null}
        size="lg"
        value={percent === null ? 0 : percent / 100}
      />

      {recentLog.length > 1 ? (
        <div className="max-h-24 overflow-hidden rounded-(--linear-radius-control) border-[0.5px] border-(--linear-border-secondary) px-3 py-2 text-left font-mono text-[0.6875rem] leading-4 text-(--linear-text-tertiary)">
          {recentLog.map((entry, index) => (
            <div className="truncate" key={`${entry.at}-${index}`}>
              {entry.message}
            </div>
          ))}
        </div>
      ) : null}

      <p className="text-center text-xs text-(--linear-text-tertiary)">{u.applyingClose}</p>
    </div>
  )
}

function ErrorView({ message, onDismiss, onRetry }: { message: string; onDismiss: () => void; onRetry: () => void }) {
  const { t } = useI18n()
  const u = t.updates

  return (
    <ErrorState
      className="px-6 pb-6 pt-7 pr-8"
      description={<DialogDescription className="max-w-prose text-center">{message || u.errorBody}</DialogDescription>}
      title={<DialogTitle className="text-center">{u.errorTitle}</DialogTitle>}
    >
      <Button onClick={onRetry} size="lg">
        {u.tryAgain}
      </Button>
      <Button onClick={onDismiss} variant="text">
        {u.notNow}
      </Button>
    </ErrorState>
  )
}

function CenteredStatus({
  action,
  body,
  icon,
  title
}: {
  action?: React.ReactNode
  body?: string
  icon: React.ReactNode
  title: string
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 px-6 pb-6 pt-8">
      <div className="flex flex-col items-center gap-3 text-center">
        {icon}

        <DialogTitle className="text-center">{title}</DialogTitle>
        {body && <DialogDescription className="text-center">{body}</DialogDescription>}
      </div>

      {action && <div className="flex justify-center">{action}</div>}
    </div>
  )
}
