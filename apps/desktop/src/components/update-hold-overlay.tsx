import { useStore } from '@nanostores/react'
import { useEffect, useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import type { UpdateHoldWire } from '@/global'
import { useI18n } from '@/i18n'
import { AlertTriangle, FileText, Loader2, Power, RefreshCw } from '@/lib/icons'
import { $desktopBoot } from '@/store/boot'

type Busy = 'quit' | 'recheck' | 'start' | null

const formatTime = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

/**
 * The blocked boot screen (review R8 D3). While an earlier update's leftover
 * process holds the install — or the update helper cannot tell who owns it —
 * the local backend does not start, ever, on a timer. The user sees what holds
 * the install and can check again or quit; the only way through while the
 * hold lasts is an explicit, confirmed Start anyway that main logs. Main
 * starts the backend by itself as soon as the hold ends.
 */
export function UpdateHoldOverlay() {
  const boot = useStore($desktopBoot)
  const { t } = useI18n()
  const titleId = useId()
  const [busy, setBusy] = useState<Busy>(null)
  const [confirming, setConfirming] = useState(false)
  const [refused, setRefused] = useState(false)
  const hold: UpdateHoldWire | null = boot.error ? null : (boot.updateHold ?? null)
  const holdId = hold?.holdId ?? null
  const checkedAt = hold?.checkedAt ?? null

  // A new check landed: Check again is done.
  useEffect(() => {
    setBusy(current => (current === 'recheck' ? null : current))
  }, [checkedAt])

  // A different hold is a different decision: drop a pending confirmation.
  useEffect(() => {
    setConfirming(false)
    setBusy(null)
  }, [holdId])

  if (!hold) {
    return null
  }

  const copy = t.boot.updateHold
  const unverified = hold.verdict !== 'held'

  const recheck = async () => {
    setRefused(false)
    setBusy('recheck')
    const result = await window.hermesDesktop?.updateHold.recheck().catch(() => null)

    if (!result?.ok) {
      setBusy(null)
    }
  }

  const quit = async () => {
    setBusy('quit')
    await window.hermesDesktop?.updateHold.quit().catch(() => undefined)
  }

  const startAnyway = async () => {
    setBusy('start')

    const result = await window.hermesDesktop?.updateHold
      .startAnyway({ holdId: hold.holdId, confirmed: true })
      .catch(() => null)

    if (!result?.ok) {
      setRefused(true)
      setConfirming(false)
      setBusy(null)
    }
  }

  const openLogs = () => void window.hermesDesktop?.revealLogs().catch(() => undefined)

  return (
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className="fixed inset-0 z-(--z-setup) flex items-center justify-center bg-(--linear-bg-panel) p-6"
      data-testid="update-hold-overlay"
      role="alertdialog"
    >
      <div className="relative w-full max-w-[40rem] overflow-hidden rounded-(--linear-radius-modal) border-[0.5px] border-(--linear-border-overlay) bg-(--linear-bg-card) text-(--linear-text-primary) shadow-(--linear-shadow-dialog)">
        <div className="flex items-start gap-3 px-5 py-4">
          <AlertTriangle className="mt-1.5 size-4 shrink-0 text-(--linear-yellow)" />
          <div>
            <h2 className="text-[1.125rem] leading-[1.8rem] font-semibold" id={titleId}>
              {confirming ? copy.confirmTitle : unverified ? copy.titleUnverified : copy.title}
            </h2>
            <p className="mt-0.5 text-[0.8125rem] leading-5 text-(--linear-text-tertiary)">
              {confirming ? copy.confirmBody : copy.description}
            </p>
          </div>
        </div>

        <div className="grid gap-4 p-5 pt-0">
          <div
            className="rounded-(--linear-radius-card) bg-[color-mix(in_srgb,var(--linear-yellow)_10%,transparent)] px-3 py-2.5 text-[0.8125rem] leading-5 text-(--linear-text-secondary)"
            data-testid="update-hold-detail"
          >
            <p>{unverified ? copy.unverified : hold.ownerPid ? copy.heldByProcess(hold.ownerPid) : copy.heldUnknown}</p>
            <p className="mt-1 text-xs text-(--linear-text-tertiary)">
              {copy.since(formatTime(hold.since))} · {copy.lastChecked(formatTime(hold.checkedAt))}
            </p>
          </div>

          {refused ? <p className="text-xs text-(--linear-red)">{copy.startAnywayRefused}</p> : null}

          {confirming ? (
            <div className="flex flex-wrap gap-2">
              <Button disabled={Boolean(busy)} onClick={() => setConfirming(false)} variant="secondary">
                {copy.confirmKeepWaiting}
              </Button>
              <Button disabled={Boolean(busy)} onClick={() => void startAnyway()} variant="destructive">
                {busy === 'start' ? <Loader2 className="animate-spin" /> : null}
                {copy.confirmStart}
              </Button>
            </div>
          ) : (
            <div className="grid gap-2">
              <div className="flex flex-wrap gap-2">
                <Button disabled={Boolean(busy)} onClick={() => void recheck()}>
                  {busy === 'recheck' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  {copy.checkAgain}
                </Button>
                <Button disabled={Boolean(busy)} onClick={() => void quit()} variant="secondary">
                  {busy === 'quit' ? <Loader2 className="animate-spin" /> : <Power />}
                  {copy.quit}
                </Button>
                <Button onClick={openLogs} variant="ghost">
                  <FileText />
                  {copy.openLogs}
                </Button>
                <Button
                  className="ml-auto"
                  disabled={Boolean(busy)}
                  onClick={() => {
                    setRefused(false)
                    setConfirming(true)
                  }}
                  variant="ghost"
                >
                  {copy.startAnyway}
                </Button>
              </div>
              <p className="text-xs text-(--linear-text-tertiary)">{copy.recoveryHint}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
