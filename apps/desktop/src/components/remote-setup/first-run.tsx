import { useState } from 'react'
import type { ReactElement } from 'react'

import { BrandMark } from '@/components/brand-mark'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { Loader2 } from '@/lib/icons'

import { RemoteSetupFields } from './fields'
import { useRemoteSetup } from './use-remote-setup'

interface FirstRunRemoteSetupProps {
  onBack: () => void
}

export function FirstRunRemoteSetup({ onBack }: FirstRunRemoteSetupProps): ReactElement {
  const { t } = useI18n()
  const copy = t.install
  const setup = useRemoteSetup({ host: 'first-run' })
  const [applying, setApplying] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const apply = async (): Promise<void> => {
    if (!setup.canCommit || applying) {
      return
    }

    setApplying(true)
    setError(null)

    try {
      await window.hermesDesktop.applyConnectionConfig(setup.payload)
      onBack()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err || t.settings.gateway.applyFailed))
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="fixed inset-0 z-(--z-setup) flex items-start justify-center overflow-y-auto bg-(--linear-bg-panel) px-6 pt-20 pb-6">
      <div className="flex w-full max-w-[46.875rem] flex-col rounded-(--linear-radius-modal) border-[0.5px] border-(--linear-border-overlay) bg-(--linear-bg-card) text-(--linear-text-primary) shadow-(--linear-shadow-dialog) p-5">
        <div className="flex items-start gap-3">
          <BrandMark className="size-11 shrink-0" />
          <div className="min-w-0">
            <h2 className="text-[1.125rem] leading-[1.8rem] font-semibold">{copy.remoteSetupTitle}</h2>
            <p className="mt-0.5 text-[0.9375rem] leading-[1.40625rem] text-(--linear-text-tertiary)">{copy.remoteSetupDesc}</p>
          </div>
        </div>
        <div className="mt-5">
          <RemoteSetupFields disabled={applying} setup={setup} />
          {error ? <div className="mt-3 text-xs text-(--linear-red)">{error}</div> : null}
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <Button disabled={applying} onClick={onBack} size="sm" variant="ghost">
            {copy.backToSetup}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              disabled={setup.testing || applying || !setup.canTest}
              onClick={() => void setup.test()}
              size="sm"
              variant="secondary"
            >
              {setup.testing ? <Loader2 className="animate-spin" /> : null}
              {copy.testConnection}
            </Button>
            <Button disabled={applying || !setup.canCommit} onClick={() => void apply()} size="sm">
              {applying ? <Loader2 className="animate-spin" /> : null}
              {copy.applyRemote}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
