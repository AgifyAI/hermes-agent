import type { ModelOptionProvider } from '@hermes/shared'
import { isReasoningEffort, REASONING_EFFORT_VALUES } from '@hermes/shared'
import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useMemo } from 'react'

import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import { findCatalogProvider } from '@/lib/model-options'
import { cn } from '@/lib/utils'
import type { AuxiliaryTaskAssignment, ModelAssignmentRequest } from '@/types/hermes'

import { CONTROL_TEXT } from './constants'
import { ModelSelect } from './model-select'
import { useDeepLinkHighlight } from './use-deep-link-highlight'

// Built-in auxiliary tasks, in the order `_AUX_TASK_SLOTS` (hermes_cli/web_server_config.py)
// serves them. Friendly labels and hints come from i18n `m.tasks`; raw task keys (vision,
// mcp, …) are opaque to most users. Plugin-registered tasks are not listed here: the backend
// appends them to `/api/model/auxiliary` with their own `label`/`hint` (see `auxTaskRows`).
interface AuxTaskMeta {
  key: string
  /** Server-declared copy for a plugin task; built-ins resolve through i18n instead. */
  label?: string
  hint?: string
  /** Plugin task that follows this slot until it is pinned itself. */
  inheritFrom?: string
}

const AUX_TASKS: readonly AuxTaskMeta[] = [
  { key: 'vision' },
  { key: 'compression' },
  { key: 'skills_hub' },
  { key: 'approval' },
  { key: 'mcp' },
  { key: 'title_generation' },
  { key: 'review' },
  { key: 'voice_chat' },
  // Same three canonical slots the backend serves but the list below used to
  // omit (#97297): triage_specifier, kanban_decomposer, profile_describer.
  { key: 'triage_specifier' },
  { key: 'kanban_decomposer' },
  { key: 'profile_describer' },
  { key: 'curator' }
]

// Rows to render: the built-ins above, then every task the backend reported that is not a
// built-in — i.e. plugin-registered auxiliary tasks (PluginContext.register_auxiliary_task),
// which arrive with the plugin's own label/hint and inherited base. Older backends never send
// extra rows, so this is a no-op against them. Built-ins stay first so the layout is stable.
export function auxTaskRows(tasks: readonly AuxiliaryTaskAssignment[] | undefined): AuxTaskMeta[] {
  const builtin = new Set(AUX_TASKS.map(meta => meta.key))

  const extra = (tasks ?? [])
    .filter(entry => !builtin.has(entry.task))
    .map(entry => ({
      key: entry.task,
      label: entry.label || entry.task,
      hint: entry.hint || '',
      inheritFrom: entry.inherit_from || undefined
    }))

  return extra.length ? [...AUX_TASKS, ...extra] : [...AUX_TASKS]
}

/** The rows plus a label resolver that knows plugin tasks (i18n for built-ins, server copy else). */
export function useAuxTaskRows(
  tasks: readonly AuxiliaryTaskAssignment[] | undefined,
  list: { loading: boolean; visible: boolean }
) {
  const { t } = useI18n()
  const labels = t.settings.model.tasks
  const auxRows = useMemo(() => auxTaskRows(tasks), [tasks])

  // Deep link from the vision Capabilities detail (?tab=config:model&aux=vision):
  // scroll the auxiliary task row into view and flash it once the list loads.
  useDeepLinkHighlight({
    elementId: task => `aux-task-${task}`,
    param: 'aux',
    ready: task => list.visible && !list.loading && auxRows.some(meta => meta.key === task)
  })

  const auxiliaryTaskLabel = useCallback(
    (key: string) => labels[key]?.label ?? auxRows.find(meta => meta.key === key)?.label ?? key,
    [labels, auxRows]
  )

  return { auxRows, auxiliaryTaskLabel }
}

/**
 * Route line of one auxiliary-model row: the pinned route, "auto · use main model", or, for an
 * unpinned plugin task registered with `inherit_from`, `inherits <Base> · <route it resolves to>`.
 */
export function AuxTaskRouteSummary({
  current,
  inheritLabel
}: {
  current?: AuxiliaryTaskAssignment
  inheritLabel?: string
}) {
  const { t } = useI18n()
  const m = t.settings.model
  const isAuto = !current || !current.provider || current.provider === 'auto'
  const effective = current?.effective
  const effort = current?.reasoning_effort

  const effectiveRoute =
    effective?.provider && effective.provider !== 'auto'
      ? `${effective.provider} · ${effective.model || m.providerDefault}`
      : m.autoUseMain

  const autoLine = inheritLabel ? `${m.inheritsFrom(inheritLabel)} · ${effectiveRoute}` : m.autoUseMain

  return (
    <span className="font-mono text-[0.6875rem]">
      {isAuto ? autoLine : `${current.provider} · ${current.model || m.providerDefault}`}
      {!isAuto && current.base_url && <span className="text-(--linear-text-tertiary)"> · {current.base_url}</span>}
      {effort && (
        <span className="text-(--linear-text-tertiary)">
          {' · '}
          {effort === 'none'
            ? `${m.reasoning} ${m.reasoningOff}`
            : isReasoningEffort(effort)
              ? t.shell.modelOptions[effort]
              : effort}
        </span>
      )}
    </span>
  )
}

/** Route that puts a pinned inheriting plugin slot back on its base: "auto" + no model on such a
 *  slot means "no preference here" (agent/auxiliary_task_config.py::_layer_over_inherited). */
export const AUX_FOLLOW_BASE: Omit<ModelAssignmentRequest, 'scope' | 'task'> = {
  model: '',
  provider: 'auto',
  reasoning_effort: null
}

/** "Set to main": pin a slot to the main model (plus the endpoint a custom/local main needs). */
export function auxMainRoute(
  main: { model: string; provider: string },
  endpointFor: (provider: string) => object
): Omit<ModelAssignmentRequest, 'scope' | 'task'> {
  return { model: main.model, provider: main.provider, ...endpointFor(main.provider) }
}

/** "Follow <Base>" on a pinned plugin slot registered with `inherit_from`. */
export function AuxFollowBaseButton({
  baseLabel,
  disabled,
  onFollow
}: {
  baseLabel: string
  disabled: boolean
  onFollow: () => void
}) {
  const { t } = useI18n()

  return (
    <Button disabled={disabled} onClick={onFollow} size="sm" variant="text">
      {t.settings.model.followTask(baseLabel)}
    </Button>
  )
}

export interface AuxTaskDraft {
  model: string
  provider: string
  reasoningEffort: string
}

/** The inline provider / model / reasoning editor under an auxiliary task row. */
export function AuxTaskDraftEditor({
  applying,
  draft,
  label,
  models,
  onApply,
  onCancel,
  onDraftChange,
  providerOptions,
  providers
}: {
  applying: boolean
  draft: AuxTaskDraft
  label: string
  models: readonly string[]
  onApply: () => void
  onCancel: () => void
  onDraftChange: Dispatch<SetStateAction<AuxTaskDraft>>
  providerOptions: readonly ModelOptionProvider[]
  providers: readonly ModelOptionProvider[]
}) {
  const { t } = useI18n()
  const m = t.settings.model
  const draftProvider = findCatalogProvider(providers, draft.provider)

  return (
    <div className="mt-2 grid gap-2 pt-1">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          onValueChange={value => onDraftChange(prev => ({ ...prev, provider: value, model: '' }))}
          value={draftProvider?.slug ?? draft.provider}
        >
          <SelectTrigger aria-label={`${label} provider`} className={cn('min-w-32', CONTROL_TEXT)}>
            <SelectValue placeholder={m.provider} />
          </SelectTrigger>
          <SelectContent>
            {providerOptions.map(provider => (
              <SelectItem key={provider.slug || 'none'} value={provider.slug || 'none'}>
                {provider.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ModelSelect
          aria-label={`${label} model`}
          className="min-w-48"
          models={models}
          onValueChange={value => onDraftChange(prev => ({ ...prev, model: value }))}
          provider={draftProvider}
          providerSlug={draft.provider}
          value={draft.model}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-(--linear-text-tertiary)">{m.reasoning}</span>
        <Select
          onValueChange={value => onDraftChange(prev => ({ ...prev, reasoningEffort: value }))}
          value={draft.reasoningEffort}
        >
          <SelectTrigger aria-label={`${label} reasoning effort`} className={cn('min-w-32', CONTROL_TEXT)}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__inherit__">{m.inheritMainEffort}</SelectItem>
            {REASONING_EFFORT_VALUES.map(value => (
              <SelectItem key={value} value={value}>
                {value === 'none' ? m.reasoningOff : t.shell.modelOptions[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!draft.provider || !draft.model || applying} onClick={onApply} size="sm">
          {applying ? m.applying : t.common.apply}
        </Button>
        <Button onClick={onCancel} size="sm" variant="ghost">
          {t.common.cancel}
        </Button>
      </div>
    </div>
  )
}
