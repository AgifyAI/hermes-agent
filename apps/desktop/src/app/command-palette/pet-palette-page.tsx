/**
 * Cmd-K "Pets…" page — browse the petdex gallery, adopt/switch, toggle off.
 *
 * A thin view over the `pet-gallery` store: it subscribes to the shared atoms
 * and calls the store's actions. The store owns fetching, caching, the thumb
 * cache, and optimistic mutations, so reopening this page is instant and a
 * toggle never re-pulls the network gallery.
 */

import { useStore } from '@nanostores/react'
import { useEffect, useMemo } from 'react'

import { StatusRow } from '@/app/command-palette/status-row'
import { HUD_ITEM, HUD_TEXT } from '@/app/floating-hud'
import { useGatewayRequest } from '@/app/gateway/hooks/use-gateway-request'
import { PetThumb } from '@/components/pet/pet-thumb'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { Check, Egg, Loader2, PawPrint } from '@/lib/icons'
import { cn } from '@/lib/utils'
import {
  $petBusy,
  $petGallery,
  $petGalleryError,
  $petGalleryStatus,
  adoptPet,
  loadPetGallery,
  loadPetThumb,
  rankedGalleryPets,
  setPetEnabled
} from '@/store/pet-gallery'

interface PetPalettePageProps {
  search: string
  /** Navigate to the "generate a pet" page (rendered as a header action). */
  onGenerate?: () => void
}

export function PetPalettePage({ search, onGenerate }: PetPalettePageProps) {
  const { t } = useI18n()
  const copy = t.commandCenter.pets
  const { requestGateway } = useGatewayRequest()

  const gallery = useStore($petGallery)
  const status = useStore($petGalleryStatus)
  const error = useStore($petGalleryError)
  const busy = useStore($petBusy)

  useEffect(() => {
    void loadPetGallery(requestGateway)
  }, [requestGateway])

  const enabled = gallery?.enabled ?? false
  const active = gallery?.active ?? ''

  const shown = useMemo(() => rankedGalleryPets(gallery, search).slice(0, 50), [gallery, search])

  const adopt = (slug: string) => {
    void adoptPet(requestGateway, slug, copy.adoptFailed).then(ok => ok && triggerHaptic('crisp'))
  }

  if (status === 'loading' && !gallery) {
    return <StatusRow icon={<Loader2 className="size-3.5 animate-spin" />} text={copy.loading} />
  }

  if (status === 'stale') {
    return <StatusRow text={copy.staleBackend} tone="error" />
  }

  if (!gallery?.pets.length && error) {
    return <StatusRow text={error} tone="error" />
  }

  const mutating = Boolean(busy)

  return (
    <div className="p-1.5" role="listbox">
      {onGenerate && (
        <button
          className={cn(
            'flex w-full items-center gap-2 rounded-(--linear-radius-control) text-left text-(--linear-text-overlay) transition-colors duration-(--linear-speed-quick) hover:bg-(--linear-hover-overlay) hover:text-(--linear-text-overlay-strong) hover:transition-none',
            HUD_ITEM,
            HUD_TEXT
          )}
          onClick={onGenerate}
          onMouseDown={event => event.preventDefault()}
          type="button"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-(--linear-radius-control) bg-(--linear-hover-overlay)">
            <Egg className="size-4" />
          </span>
          <span className="font-medium">{t.commandCenter.generatePet.title}</span>
        </button>
      )}

      {error && <p className="px-2 pb-1 pt-1.5 text-[0.6875rem] text-(--linear-red)">{error}</p>}

      {shown.length === 0 ? (
        <StatusRow text={copy.empty} />
      ) : (
        shown.map(pet => {
          const isActive = enabled && pet.slug === active
          const isBusy = busy === pet.slug

          return (
            <button
              className={cn(
                'flex w-full items-center gap-2 rounded-(--linear-radius-control) text-left text-(--linear-text-overlay) transition-colors duration-(--linear-speed-quick) hover:bg-(--linear-hover-overlay) hover:text-(--linear-text-overlay-strong) hover:transition-none disabled:opacity-60',
                HUD_ITEM,
                HUD_TEXT,
                isActive && 'bg-(--linear-hover-overlay) text-(--linear-text-overlay-strong)'
              )}
              disabled={mutating && !isBusy}
              key={pet.slug}
              onClick={() => adopt(pet.slug)}
              onMouseDown={event => event.preventDefault()}
              role="option"
              type="button"
            >
              <PetThumb
                alt={pet.displayName}
                load={(slug, url) => loadPetThumb(requestGateway, slug, url)}
                size={32}
                slug={pet.slug}
                url={pet.spritesheetUrl}
              />
              <span className="flex min-w-0 flex-col">
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-medium">{pet.displayName}</span>
                  {pet.generated && (
                    <Badge className="shrink-0">{copy.generatedTag}</Badge>
                  )}
                </span>
                <span className="truncate text-[0.6875rem] font-[450] text-(--linear-text-tertiary)">
                  {pet.slug}
                  {pet.installed ? ` · ${copy.installed}` : ''}
                </span>
              </span>
              <span className="ml-auto flex shrink-0 items-center text-[0.6875rem] text-(--linear-text-tertiary)">
                {isBusy ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : isActive ? (
                  <Check className="size-3.5 text-(--linear-accent)" />
                ) : null}
              </span>
            </button>
          )
        })
      )}
    </div>
  )
}

/**
 * Single on/off toggle, rendered inline on the palette's search row (see
 * `CommandInput`'s `right` slot). The paw lights up when pets are on. Reads the
 * same shared gallery atoms, so it stays in sync with the list below.
 */
export function PetInlineToggle() {
  const { t } = useI18n()
  const copy = t.commandCenter.pets
  const { requestGateway } = useGatewayRequest()
  const gallery = useStore($petGallery)
  const busy = useStore($petBusy)

  if (!gallery) {
    return null
  }

  const enabled = gallery.enabled

  const toggle = () => {
    void setPetEnabled(requestGateway, !enabled, {
      noneAvailable: copy.noneAvailable,
      fallback: copy.toggleFailed(!enabled)
    }).then(ok => ok && triggerHaptic('crisp'))
  }

  return (
    <Button
      aria-label={enabled ? copy.turnOff : copy.turnOn}
      aria-pressed={enabled}
      className={cn('shrink-0', enabled && 'bg-(--linear-hover-overlay) text-(--linear-text-overlay-strong)')}
      disabled={Boolean(busy)}
      onClick={toggle}
      // Don't steal focus from the search input on click.
      onMouseDown={event => event.preventDefault()}
      size="icon"
      type="button"
      variant="ghost"
    >
      {busy ? <Loader2 className="animate-spin" /> : <PawPrint />}
    </Button>
  )
}
