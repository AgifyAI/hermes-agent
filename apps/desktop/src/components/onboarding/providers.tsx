import { Badge } from '@/components/ui/badge'
import { RowButton } from '@/components/ui/row-button'
import { useI18n } from '@/i18n'
import { Check, ChevronRight, Terminal } from '@/lib/icons'
import { PROVIDER_DISPLAY_NAMES } from '@/lib/model-status-label'
import type { OAuthProvider } from '@/types/hermes'

// Titles live in PROVIDER_DISPLAY_NAMES (shared with the model pill); this is
// only the featured order. Both Anthropic entries sit at the bottom: the API-key
// path first, then the subscription OAuth path (only works with extra usage credits).
const PROVIDER_ORDER: Record<string, number> = {
  nous: 0,
  'openai-codex': 1,
  'minimax-oauth': 2,
  'qwen-oauth': 3,
  'xai-oauth': 4,
  anthropic: 5,
  'claude-code': 6
}

const assetPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`

export const providerTitle = (p: OAuthProvider) => PROVIDER_DISPLAY_NAMES[p.id] ?? p.name
const orderOf = (p: OAuthProvider) => PROVIDER_ORDER[p.id] ?? 99

export const sortProviders = (providers: OAuthProvider[]) =>
  [...providers].sort((a, b) => orderOf(a) - orderOf(b) || a.name.localeCompare(b.name))

export function FeaturedProviderRow({
  onSelect,
  provider
}: {
  onSelect: (provider: OAuthProvider) => void
  provider: OAuthProvider
}) {
  const { t } = useI18n()
  const freeTier = provider.status?.free_tier === true
  const loggedIn = provider.status?.logged_in && !freeTier

  return (
    <button
      className="group relative flex w-full items-center justify-between gap-4 rounded-(--linear-radius-card) bg-[color-mix(in_srgb,var(--linear-accent)_6%,transparent)] px-3 py-2.5 text-left transition-colors duration-(--linear-speed-quick) hover:bg-[color-mix(in_srgb,var(--linear-accent)_10%,transparent)] hover:transition-none"
      onClick={() => onSelect(provider)}
      type="button"
    >
      <span aria-hidden className="arc-border arc-reverse arc-nous" />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <img alt="" className="size-5 shrink-0 rounded" src={assetPath('apple-touch-icon.png')} />
          <span className="text-[0.8125rem] font-medium">
            {freeTier ? t.freeTier.providerRowTitle : providerTitle(provider)}
          </span>
          {freeTier ? (
            <FreeTierTag />
          ) : loggedIn ? (
            <ConnectedTag />
          ) : (
            <Badge variant="solid">
              <span aria-hidden="true" className="dither inline-block size-2 shrink-0" />
              {t.onboarding.recommended}
            </Badge>
          )}
        </div>
        <p className="mt-1 text-xs leading-5 text-(--linear-text-tertiary)">
          {freeTier ? t.freeTier.providerRowPitch : t.onboarding.featuredPitch}
        </p>
      </div>
      <ChevronRight className="size-3.5 shrink-0 text-(--linear-accent) transition group-hover:translate-x-0.5" />
    </button>
  )
}

// The free tier is an identity without an account: never "Connected", never the account's name.
function FreeTierTag() {
  const { t } = useI18n()

  return <Badge>{t.onboarding.freeTier}</Badge>
}

function ConnectedTag() {
  const { t } = useI18n()

  return (
    <Badge>
      <Check />
      {t.onboarding.connected}
    </Badge>
  )
}

const PROVIDER_ROW_CLASS =
  'group flex w-full items-center justify-between gap-3 rounded-(--linear-radius-control) px-3 py-2.5 text-left transition-colors duration-(--linear-speed-quick) hover:bg-(--linear-hover-row) hover:transition-none'

/** Quick-key row for API-key providers (Fireworks leads the expanded list after Nous, OpenRouter further down). */
export function KeyProviderRow({ onClick, pitch, title }: { onClick: () => void; pitch: string; title: string }) {
  return (
    <RowButton className={PROVIDER_ROW_CLASS} onClick={onClick}>
      <div className="min-w-0">
        <span className="text-[0.8125rem] font-medium">{title}</span>
        <p className="mt-1 text-xs leading-5 text-(--linear-text-tertiary)">{pitch}</p>
      </div>
      <ChevronRight className="size-3.5 text-(--linear-icon) transition group-hover:text-(--linear-text-primary)" />
    </RowButton>
  )
}

export function FireworksProviderRow({ onClick }: { onClick: () => void }) {
  const { t } = useI18n()

  return <KeyProviderRow onClick={onClick} pitch={t.onboarding.fireworksPitch} title="Fireworks AI" />
}

/** Onboarding row for the managed local runtime: no account, no key — the
 *  destination is the Local Models pane where install/download live. */
export function LocalModelsProviderRow({ onClick }: { onClick: () => void }) {
  const { t } = useI18n()

  return (
    <KeyProviderRow onClick={onClick} pitch={t.onboarding.localModelsPitch} title={t.onboarding.localModelsTitle} />
  )
}

export function OpenRouterProviderRow({ onClick }: { onClick: () => void }) {
  const { t } = useI18n()

  return <KeyProviderRow onClick={onClick} pitch={t.onboarding.openRouterPitch} title="OpenRouter" />
}

export function ProviderRow({
  onSelect,
  provider
}: {
  onSelect: (provider: OAuthProvider) => void
  provider: OAuthProvider
}) {
  const { t } = useI18n()
  const freeTier = provider.status?.free_tier === true
  const loggedIn = provider.status?.logged_in && !freeTier
  const Trail = provider.flow === 'external' ? Terminal : ChevronRight

  return (
    <RowButton className={PROVIDER_ROW_CLASS} onClick={() => onSelect(provider)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[0.8125rem] font-medium">
            {freeTier ? t.freeTier.providerRowTitle : providerTitle(provider)}
          </span>
          {freeTier ? <FreeTierTag /> : loggedIn ? <ConnectedTag /> : null}
        </div>
        <p className="mt-1 text-xs leading-5 text-(--linear-text-tertiary)">
          {t.onboarding.flowSubtitles[provider.flow]}
        </p>
      </div>
      <Trail className="size-3.5 text-(--linear-icon) transition group-hover:text-(--linear-text-primary)" />
    </RowButton>
  )
}
