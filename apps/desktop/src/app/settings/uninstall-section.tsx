import { type ReactElement, useContext, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import type { DesktopUninstallMode, DesktopUninstallResult, DesktopUninstallSummary } from '@/global'
import { useI18n } from '@/i18n'
import { Loader2, Trash2 } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { SectionHeading, SettingsBreadcrumbContext, SettingsCard } from './primitives'

interface ModeOption {
  mode: DesktopUninstallMode
  title: string
  description: string
  /** Shown in the confirm step so people know exactly what disappears. */
  consequence: string
  /** True when the option removes the Python agent (hidden if no agent). */
  needsAgent: boolean
}

export function UninstallSection(): ReactElement | null {
  const hasBreadcrumb = useContext(SettingsBreadcrumbContext)
  const { t } = useI18n()
  const u = t.settings.uninstallSection

  const options: ModeOption[] = [
    {
      mode: 'gui',
      title: u.options.gui.title,
      description: u.options.gui.description,
      consequence: u.options.gui.consequence,
      needsAgent: false
    },
    {
      mode: 'lite',
      title: u.options.lite.title,
      description: u.options.lite.description,
      consequence: u.options.lite.consequence,
      needsAgent: true
    },
    {
      mode: 'full',
      title: u.options.full.title,
      description: u.options.full.description,
      consequence: u.options.full.consequence,
      // full removes the agent (and user data), so it's an agent-removing option:
      // hide it on a lite client with no local agent, same as lite. A lite client
      // connecting to a remote backend has no local agent OR local user data the
      // GUI installed, so gui-only is the correct (and only) option there.
      needsAgent: true
    }
  ]

  const [summary, setSummary] = useState<DesktopUninstallSummary | null>(null)
  const [pending, setPending] = useState<DesktopUninstallMode | null>(null)
  const [running, setRunning] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  useEffect((): (() => void) | undefined => {
    let alive: boolean = true
    const bridge: Window['hermesDesktop']['uninstall'] | undefined = window.hermesDesktop?.uninstall

    if (!bridge) {
      return
    }

    void bridge
      .summary()
      .then((result: DesktopUninstallSummary): void => {
        if (alive) {
          setSummary(result)
        }
      })
      .catch((): void => {
        // A failed ownership probe must not offer a destructive fallback.
        if (alive) {
          setSummary(null)
        }
      })

    return (): void => {
      alive = false
    }
  }, [])

  const bridge: Window['hermesDesktop']['uninstall'] | undefined = window.hermesDesktop?.uninstall

  if (!bridge || !summary) {
    return null
  }

  if (!summary.code_removal_allowed) {
    // The OS or package manager owns removal; show how, never a destructive fallback.
    if (!summary.native_removal_instructions) {
      return null
    }

    return (
      <div className={cn(!hasBreadcrumb && 'mt-12')}>
        <SectionHeading page title={u.uninstallHermes} />
        <SettingsCard className="flex flex-col gap-2 py-4">
          <p className="text-xs text-(--linear-text-tertiary)">{u.managedBody}</p>
          <p className="text-[0.8125rem] font-medium">{summary.native_removal_instructions}</p>
          <p className="text-xs text-(--linear-text-tertiary)">{u.dataKept(summary.hermes_home)}</p>
          {summary.platform === 'win32' && (
            <div className="mt-1">
              <Button onClick={(): void => void bridge.openAppsSettings()} size="sm" variant="outline">
                {u.openAppsSettings}
              </Button>
            </div>
          )}
        </SettingsCard>
      </div>
    )
  }

  // An owned GUI can remain after its local agent has been removed.
  const agentInstalled: boolean = summary.agent_installed
  const visibleOptions: ModeOption[] = options.filter((opt: ModeOption): boolean => agentInstalled || !opt.needsAgent)

  const handleConfirm: () => Promise<void> = async (): Promise<void> => {
    if (!pending) {
      return
    }

    setRunning(true)
    setError(null)

    try {
      const result: DesktopUninstallResult = await bridge.run(pending)

      if (!result.ok) {
        setError(result.message || result.error || u.couldNotStart)
        setRunning(false)
        setPending(null)
      }
      // On success the app quits shortly; keep the spinner up until it does.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setRunning(false)
      setPending(null)
    }
  }

  const pendingOption: ModeOption | null = options.find((opt: ModeOption): boolean => opt.mode === pending) ?? null

  return (
    <div className={cn(!hasBreadcrumb && 'mt-12')}>
      <SectionHeading page title={t.settings.uninstallSection.dangerZone} />

      <SettingsCard className="py-4">
        {pendingOption ? (
          <div>
            <p className="text-[0.8125rem] font-medium text-(--linear-red)">
              {t.settings.uninstallSection.confirmUninstall}
            </p>
            <p className="mt-1 text-xs text-(--linear-text-tertiary)">{u.confirmBody(pendingOption.consequence)}</p>
            {summary?.running_app_path && (
              <p className="mt-1 font-mono text-[0.6875rem] text-(--linear-text-quaternary)">
                {u.appLabel} {summary.running_app_path}
              </p>
            )}
            {error && <p className="mt-2 text-xs text-(--linear-red)">{error}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button disabled={running} onClick={(): void => void handleConfirm()} size="sm" variant="destructive">
                {running && <Loader2 className="size-3 animate-spin" />}
                {running ? u.uninstalling : u.yesUninstall}
              </Button>
              <Button disabled={running} onClick={(): void => setPending(null)} size="sm" variant="text">
                {t.common.cancel}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-[0.8125rem] font-medium">{t.settings.uninstallSection.uninstallHermes}</p>
            <p className="text-xs text-(--linear-text-tertiary)">{u.chooseHowMuch}</p>
            <div className="mt-1 flex flex-col gap-2">
              {visibleOptions.map((opt: ModeOption): ReactElement => (
                <button
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-(--linear-radius-control) border-[0.5px] border-(--linear-border-secondary) px-3 py-2.5 text-left transition-colors duration-(--linear-speed-quick)',
                    'hover:border-(--linear-red) hover:bg-(--linear-hover-row)'
                  )}
                  key={opt.mode}
                  onClick={(): void => {
                    setError(null)
                    setPending(opt.mode)
                  }}
                  type="button"
                >
                  <Trash2 className="mt-0.5 size-4 shrink-0 text-(--linear-icon)" />
                  <span className="min-w-0">
                    <span className="block text-[0.8125rem] font-medium text-(--linear-text-primary)">{opt.title}</span>
                    <span className="mt-[3px] block text-xs text-(--linear-text-tertiary)">{opt.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </SettingsCard>
    </div>
  )
}
