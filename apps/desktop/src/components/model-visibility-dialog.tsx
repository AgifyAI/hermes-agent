import type { ModelOptionProvider, ModelOptionsResult } from '@hermes/shared'
import { useStore } from '@nanostores/react'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DisclosureCaret } from '@/components/ui/disclosure-caret'
import { GlyphSpinner } from '@/components/ui/glyph-spinner'
import { HighlightMatches } from '@/components/ui/highlight-matches'
import { RowButton } from '@/components/ui/row-button'
import { Switch } from '@/components/ui/switch'
import type { HermesGateway } from '@/hermes'
import { useI18n } from '@/i18n'
import { Plus, Search, X } from '@/lib/icons'
import { modelOptionsQueryKey, requestModelOptions } from '@/lib/model-options'
import { displayModelName, modelDisplayParts } from '@/lib/model-status-label'
import { foldIncludes, normalize } from '@/lib/text'
import { confirm } from '@/store/confirm'
import {
  $customModels,
  addCustomModel,
  customModelCandidate,
  isCustomModel,
  removeCustomModel,
  resetModelVisibilityKeepingCustoms,
  withCustomModels
} from '@/store/custom-models'
import {
  $visibleModels,
  collapseModelFamilies,
  effectiveVisibleKeys,
  modelVisibilityKey,
  seedKnownModels,
  setProviderVisibility,
  setVisibleModels,
  toggleModelVisibility
} from '@/store/model-visibility'
import { $collapsedProviders, toggleCollapsedProvider } from '@/store/provider-collapse'
import { ambientRequestFor } from '@/store/session-gone-latch'
import { sessionOwnerIsKnown } from '@/store/session-owner-resolution'
import { knownOwnerForSession, requestForOwnedSession } from '@/store/session-states'

/** A session-scoped `model.options` goes to the session's OWNER: the ambient
 *  socket refuses a secondary profile's session_id and the dialog fell back to
 *  the launch profile's REST catalog. An owner nothing names yet keeps the
 *  ambient path (and its REST recovery) — this is a settings view, not a write. */
function ownerModelOptionsRequest(gw: HermesGateway | undefined, sessionId: null | string | undefined) {
  if (!gw || !sessionId || !sessionOwnerIsKnown(knownOwnerForSession(sessionId))) {
    return undefined
  }

  const ambient = ambientRequestFor(gw)

  return <T,>(method: string, params?: Record<string, unknown>) =>
    requestForOwnedSession<T>(sessionId, ambient, method, params)
}

interface ModelVisibilityDialogProps {
  gw?: HermesGateway
  onOpenChange: (open: boolean) => void
  onOpenProviders: () => void
  open: boolean
  ownerConnectionId?: string
  profile?: string
  sessionId?: string | null
}

export function ModelVisibilityDialog({
  gw,
  onOpenChange,
  onOpenProviders,
  open,
  ownerConnectionId,
  profile = 'default',
  sessionId
}: ModelVisibilityDialogProps) {
  const { t } = useI18n()
  const copy = t.modelVisibility
  const [search, setSearch] = useState('')
  const stored = useStore($visibleModels)
  const collapsedProviders = useStore($collapsedProviders)
  const customModels = useStore($customModels)

  const modelOptions = useQuery({
    queryKey: modelOptionsQueryKey(profile, sessionId, ownerConnectionId),
    queryFn: (): Promise<ModelOptionsResult> =>
      requestModelOptions({ gateway: gw, profile, request: ownerModelOptionsRequest(gw, sessionId), sessionId }),
    enabled: open
  })

  const providers = useMemo(
    () =>
      withCustomModels(
        (modelOptions.data?.providers ?? []).filter(provider => (provider.models ?? []).length > 0),
        customModels
      ),
    [modelOptions.data, customModels]
  )

  useEffect(() => seedKnownModels(providers), [providers])

  const visible = effectiveVisibleKeys(stored, providers)

  const toggle = (provider: ModelOptionProvider, model: string) => {
    setVisibleModels(toggleModelVisibility($visibleModels.get(), providers, provider.slug, model), providers)
  }

  const setProviderVisible = (provider: ModelOptionProvider, next: boolean) => {
    setVisibleModels(setProviderVisibility($visibleModels.get(), providers, provider.slug, next), providers)
  }

  const resetToDefaults = async () => {
    const ok = await confirm({
      confirmLabel: copy.resetAction,
      description: copy.resetDescription,
      destructive: true,
      title: copy.resetConfirm
    })

    if (ok) {
      resetModelVisibilityKeepingCustoms(providers)
    }
  }

  const q = normalize(search)

  const matches = (provider: ModelOptionProvider, model: string) =>
    !q || foldIncludes(`${model} ${provider.name} ${provider.slug} ${displayModelName(model)}`, q)

  // Typing an id no provider lists offers to add it — same gesture as the
  // pickers, minus the switch — and the new row lands visible. Only once the
  // query matches nothing, so a partial search isn't shadowed by the offer.
  const hasMatches = providers.some(provider =>
    collapseModelFamilies(provider.models ?? []).some(family => matches(provider, family.id))
  )

  const customSlug = hasMatches ? null : customModelCandidate(search, providers)

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent bodyClassName="gap-0 overflow-hidden p-0" className="max-w-xs">
        <DialogHeader className="px-4 pb-1 pt-4 pr-12">
          <DialogTitle>{copy.title}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 px-4 py-2">
          <Search className="pointer-events-none size-3.5 shrink-0 text-(--linear-text-quaternary)" />
          <input
            autoFocus
            className="h-5 w-full bg-transparent text-[0.8125rem] text-(--linear-text-primary) placeholder:text-(--linear-text-quaternary) focus:outline-none"
            onChange={event => setSearch(event.target.value)}
            placeholder={copy.search}
            type="text"
            value={search}
          />
        </div>

        <div className="max-h-[55vh] overflow-y-auto px-1.5 pb-1">
          {providers.length === 0 ? (
            <div className="px-2 py-5 text-center text-xs text-(--linear-text-tertiary)">
              {modelOptions.isPending ? <GlyphSpinner className="mx-auto text-sm" /> : copy.noAuthenticatedProviders}
            </div>
          ) : (
            providers.map(provider => {
              const models = collapseModelFamilies(provider.models ?? []).filter(family => matches(provider, family.id))

              if (models.length === 0) {
                return null
              }

              const allFamilies = collapseModelFamilies(provider.models ?? [])

              const onCount = allFamilies.filter(family =>
                visible.has(modelVisibilityKey(provider.slug, family.id))
              ).length

              const checkState = onCount === 0 ? false : onCount === allFamilies.length ? true : 'indeterminate'

              const collapsed = collapsedProviders.includes(provider.slug) && !q

              return (
                <div className="py-0.5" key={provider.slug}>
                  <div className="flex h-7 items-center gap-2 px-2">
                    <button
                      className="group/label flex w-full items-center gap-1 text-left text-xs font-medium text-(--linear-text-tertiary) hover:text-(--linear-text-primary)"
                      onClick={() => toggleCollapsedProvider(provider.slug)}
                      type="button"
                    >
                      <span className="min-w-0 truncate">
                        <HighlightMatches foldSeparators query={search} text={provider.name} />
                      </span>
                      <DisclosureCaret
                        className="shrink-0 opacity-0 transition group-hover/label:opacity-100"
                        open={!collapsed}
                        size="0.625rem"
                      />
                    </button>
                    <Checkbox
                      checked={checkState}
                      onCheckedChange={next => setProviderVisible(provider, next !== false)}
                    />
                  </div>
                  {!collapsed &&
                    models.map(family => {
                      const { name, tag } = modelDisplayParts(family.id)
                      const key = modelVisibilityKey(provider.slug, family.id)

                      return (
                        <label
                          className="flex min-h-8 cursor-pointer items-center gap-2 rounded-(--linear-radius-control) px-2 text-[0.8125rem] transition-colors duration-(--linear-speed-quick) hover:bg-(--linear-hover-row) hover:transition-none"
                          key={key}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            <HighlightMatches foldSeparators query={search} text={name} />
                            {tag ? <span className="text-(--linear-text-tertiary)"> {tag}</span> : null}
                          </span>
                          {isCustomModel(customModels, provider.slug, family.id) && (
                            <Button
                              aria-label={copy.removeCustomModel}
                              className="-my-1 text-(--linear-text-tertiary)"
                              onClick={event => {
                                event.preventDefault()
                                removeCustomModel(provider.slug, family.id)
                              }}
                              size="icon-xs"
                              type="button"
                              variant="ghost"
                            >
                              <X className="size-3" />
                            </Button>
                          )}
                          <Switch
                            checked={visible.has(key)}
                            onCheckedChange={() => toggle(provider, family.id)}
                            size="xs"
                          />
                        </label>
                      )
                    })}
                </div>
              )
            })
          )}
          {customSlug && providers.length > 0 && (
            <div className="py-0.5">
              <div className="flex h-7 items-center px-2 text-xs font-medium text-(--linear-text-tertiary)">
                {copy.addCustomModel}
              </div>
              {providers.map(provider => (
                <RowButton
                  className="flex min-h-8 w-full items-center gap-2 text-left rounded-(--linear-radius-control) px-2 text-[0.8125rem] transition-colors duration-(--linear-speed-quick) hover:bg-(--linear-hover-row) hover:transition-none"
                  key={`custom:${provider.slug}`}
                  onClick={() => {
                    addCustomModel(provider.slug, customSlug, provider)
                    setSearch('')
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {customSlug}
                    <span className="text-(--linear-text-tertiary)"> {provider.name}</span>
                  </span>
                  <Plus className="size-3 shrink-0 text-(--linear-text-tertiary)" />
                </RowButton>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-3">
          <Button
            className="text-(--linear-text-tertiary)"
            onClick={() => {
              onOpenChange(false)
              onOpenProviders()
            }}
            size="xs"
            type="button"
            variant="text"
          >
            {copy.addProvider}
          </Button>
          {/* Only once there is something to undo, like the sidebar view reset. */}
          {stored !== null && modelOptions.isSuccess && (
            <Button onClick={() => void resetToDefaults()} size="xs" type="button" variant="text">
              {copy.resetToDefaults}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
