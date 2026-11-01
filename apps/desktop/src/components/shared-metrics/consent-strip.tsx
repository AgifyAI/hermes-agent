import { useStore } from '@nanostores/react'
import { useMemo, useState } from 'react'

import { useGatewayRequest } from '@/app/gateway/hooks/use-gateway-request'
import { StatusRow } from '@/components/chat/status-row'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { notifyError } from '@/store/notifications'
import { $activeGatewayProfile, normalizeProfileKey } from '@/store/profile'
import {
  $sharedMetricsConsent,
  $sharedMetricsDetailsOpen,
  answerSharedMetricsOffer,
  type SharedMetricsChoice,
  sharedMetricsProfileRequester
} from '@/store/shared-metrics'

const CHOICES: readonly SharedMetricsChoice[] = ['share', 'off']

/**
 * The first-run shared-metrics offer, in the composer status stack beside the
 * free-tier strip: it never blocks the composer or takes focus, and it stays
 * until one of the two equal answers is saved (the backend's `decided` is
 * the only latch). "Details" opens the full explainer the host paints.
 */
export function SharedMetricsConsentStrip() {
  const { requestGateway } = useGatewayRequest()
  const { t } = useI18n()
  const copy = t.sharedMetrics
  const profile = normalizeProfileKey(useStore($activeGatewayProfile))
  const reask = useStore($sharedMetricsConsent)?.reask === true
  const [saving, setSaving] = useState(false)

  const scopedRequest = useMemo(() => sharedMetricsProfileRequester(requestGateway, profile), [profile, requestGateway])

  const choose = async (choice: SharedMetricsChoice) => {
    setSaving(true)

    try {
      await answerSharedMetricsOffer(scopedRequest, choice)
    } catch (err) {
      notifyError(err, copy.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  return (
    <StatusRow
      leading={<Codicon aria-hidden className="text-(--linear-text-tertiary)" name="graph" size="0.8rem" />}
      trailing={
        <>
          {CHOICES.map(choice => (
            <Button
              className="text-(--linear-text-secondary) hover:text-(--linear-text-primary)"
              disabled={saving}
              key={choice}
              onClick={() => void choose(choice)}
              size="micro"
              type="button"
              variant="text"
            >
              {copy.stripChoices[choice]}
            </Button>
          ))}
          <Button
            className="text-(--linear-text-quaternary) hover:text-(--linear-text-secondary)"
            onClick={() => $sharedMetricsDetailsOpen.set(true)}
            size="micro"
            type="button"
            variant="text"
          >
            {copy.stripDetails}
          </Button>
        </>
      }
      trailingVisible
    >
      <span className="min-w-0 truncate text-xs leading-4 text-(--linear-text-secondary)">
        <span className="font-medium">{copy.consentTitle}</span>
        <span className="text-(--linear-text-quaternary)"> {reask ? copy.stripReaskBody : copy.stripBody}</span>
      </span>
    </StatusRow>
  )
}
