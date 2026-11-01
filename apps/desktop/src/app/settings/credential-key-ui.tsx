import { type ChangeEvent, type KeyboardEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { translateNow, useI18n } from '@/i18n'
import { ChevronDown, ExternalLink, Loader2, Save, Trash2 } from '@/lib/icons'
import { isSubmitEnter } from '@/lib/ime'
import { cn } from '@/lib/utils'
import type { EnvVarInfo } from '@/types/hermes'

import { CONTROL_TEXT } from './constants'
import { credentialPreview, prettyName, withoutKey } from './helpers'
import { LIST_ROW_COLUMNS, ListRow } from './primitives'
import type { EnvRowProps } from './types'

export type KeyRowProps = Omit<EnvRowProps, 'info' | 'varKey'>

/** Matches Advanced / config field controls (ListRow + Input). */
export const CREDENTIAL_CONTROL_CLASS = cn('h-8', CONTROL_TEXT)

// Resting credential field: chrome stripped so it reads as plain subtext.
// Stacked (<@lg) it collapses to zero box (flush under its label); at @lg it
// keeps the full control metrics (h-8 + px-2.5/py-1.5) so it centres on the
// label and nothing shifts when focus/expand adds the border. `!` beats the
// unlayered chrome CSS and the shared control sizing.
const CRED_BARE = 'border-0! bg-transparent! shadow-none! h-auto! p-0! @lg:h-8! @lg:px-2.5! @lg:py-1.5!'

export const isKeyVar = (key: string, info: EnvVarInfo) => info.is_password || /(?:_API_KEY|_TOKEN|_KEY)$/.test(key)

export const friendlyFieldLabel = (key: string, info: EnvVarInfo) =>
  info.description?.trim() ||
  key
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase())

export const credentialPlaceholder = (key: string, info: EnvVarInfo, label: string): string =>
  isKeyVar(key, info)
    ? translateNow('settings.credentials.pasteLabelKey', label)
    : /URL$/i.test(key)
      ? 'https://…'
      : translateNow('settings.credentials.optional')

// A single credential field: a set key shows as a filled read-only input
// (redacted value) that edits in place on click. Save appears once typed; a set
// key also offers Remove, and Esc cancels without closing the overlay.
export function KeyField({
  expanded = false,
  info,
  placeholder,
  rowProps,
  varKey,
  editKey = varKey
}: {
  editKey?: string
  expanded?: boolean
  info: EnvVarInfo
  placeholder?: string
  rowProps: KeyRowProps
  varKey: string
}) {
  const { t } = useI18n()
  const { edits, onClear, onSave, saving, setEdits } = rowProps
  const editing = edits[editKey] !== undefined
  // Bare (plain subtext) only while the group is collapsed and idle. Expanding
  // the card counts as "focused in", so it gets full input chrome too.
  const bare = !editing && !expanded
  const draft = edits[editKey] ?? ''
  const dirty = draft.trim().length > 0
  const busy = saving === varKey
  const masked = credentialPreview(info.redacted_value) ?? '••••••••'
  const startEdit = () => setEdits(c => ({ ...c, [editKey]: '' }))
  const cancel = () => setEdits(c => withoutKey(c, editKey))
  const update = (e: ChangeEvent<HTMLInputElement>) => setEdits(c => ({ ...c, [editKey]: e.target.value }))

  const keydown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (isSubmitEnter(e) && dirty) {
      void onSave(varKey, editKey)
    } else if (e.key === 'Escape' && editing) {
      e.preventDefault()
      e.stopPropagation()
      cancel()
    }
  }

  const editType = info.is_password ? 'password' : 'text'

  if (info.is_set && !editing) {
    return (
      <Input
        className={cn(CREDENTIAL_CONTROL_CLASS, bare && CRED_BARE, 'cursor-pointer text-(--linear-text-tertiary)')}
        onFocus={startEdit}
        readOnly
        value={masked}
      />
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        autoFocus={editing}
        className={cn('flex-1', CREDENTIAL_CONTROL_CLASS, bare && CRED_BARE)}
        onChange={update}
        onFocus={() => {
          if (!editing) {
            startEdit()
          }
        }}
        onKeyDown={keydown}
        placeholder={placeholder ?? t.settings.credentials.pasteKey}
        type={editType}
        value={draft}
      />
      {/* Inline trailing controls — mirrors SearchField's inline clear button.
          No floating hint row that reflows the grid or overlaps the card body;
          Esc still cancels via keydown. */}
      {editing && (info.is_set || dirty) && (
        <div className="flex items-center gap-1">
          {info.is_set && (
            <Button
              aria-label={t.settings.credentials.remove}
              className="text-(--linear-text-tertiary) hover:text-(--linear-red)"
              disabled={busy}
              onClick={() => void onClear(varKey, editKey)}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <Trash2 />
            </Button>
          )}
          {dirty && (
            <Button disabled={busy} onClick={() => void onSave(varKey, editKey)} size="lg">
              {busy ? <Loader2 className="animate-spin" /> : <Save />}
              {busy ? t.settings.credentials.saving : t.common.save}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function CredentialDocsLink({ href }: { href: string }) {
  const { t } = useI18n()

  return (
    <a
      className="inline-flex w-fit items-center gap-1 text-xs text-(--linear-text-tertiary) underline-offset-4 transition-colors hover:text-(--linear-text-primary) hover:underline"
      href={href}
      onClick={e => e.stopPropagation()}
      rel="noreferrer"
      target="_blank"
    >
      {t.settings.credentials.getKey}
      <ExternalLink className="size-3" />
    </a>
  )
}

/** One credential row — collapsible; description and docs link expand on click. */
export function CredentialKeyCard({
  expanded,
  info,
  label,
  onExpand,
  onToggle,
  placeholder,
  rowProps,
  varKey
}: CredentialKeyCardProps) {
  const docsUrl = info.url?.trim()
  const description = info.description?.trim()
  const expandable = Boolean(description || docsUrl)

  return (
    <div
      className={cn(
        // A row of its settings card: Linear's 16px rhythm, no surface of its own.
        '@container group/card rounded-(--linear-radius-control) py-4 outline-none focus-visible:ring-1 focus-visible:ring-(--linear-focus)',
        expandable && 'cursor-pointer'
      )}
      onClick={expandable ? onToggle : undefined}
      onKeyDown={
        expandable
          ? e => {
              // Only the card's own focus toggles it — ignore Enter/Space
              // bubbling up from the inputs/buttons inside (Enter saves a key,
              // Space types a space) so keyboard editing never collapses the card.
              if (e.target !== e.currentTarget) {
                return
              }

              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onToggle()
              }
            }
          : undefined
      }
      role={expandable ? 'button' : undefined}
      tabIndex={expandable ? 0 : undefined}
    >
      {/* One CSS grid: 1 col stacked, 2 cols at @lg. py-4 row padding, gap-3
          row/col gaps, everything top-left aligned (items-start), no indents.
          The label row is h-8 to line up with the input row beside it. */}
      <div className={cn('grid grid-cols-1 items-start gap-x-3 gap-y-1.5 @lg:gap-y-3', LIST_ROW_COLUMNS)}>
        <div className="flex h-8 min-w-0 items-center gap-2">
          <span
            className={cn(
              'size-2 shrink-0 rounded-full',
              info.is_set ? 'bg-(--linear-accent)' : 'bg-(--linear-border-tertiary)'
            )}
          />

          <span className="min-w-0 truncate text-[0.8125rem] font-medium text-(--linear-text-primary)">{label}</span>

          {expandable && (
            <ChevronDown
              className={cn(
                'size-3.5 shrink-0 text-(--linear-icon) transition',
                expanded ? 'rotate-180 opacity-100' : 'opacity-0 group-hover/card:opacity-100'
              )}
            />
          )}
        </div>

        <div
          className="min-w-0"
          onClick={e => e.stopPropagation()}
          onFocus={() => {
            if (expandable && !expanded) {
              onExpand()
            }
          }}
        >
          <KeyField expanded={expanded} info={info} placeholder={placeholder} rowProps={rowProps} varKey={varKey} />
        </div>

        {expandable && expanded && (
          <div className="grid gap-3 @lg:col-span-2" onClick={e => e.stopPropagation()}>
            {description && <p className="text-xs text-(--linear-text-tertiary)">{description}</p>}

            {docsUrl && <CredentialDocsLink href={docsUrl} />}
          </div>
        )}
      </div>
    </div>
  )
}

/** Provider API key group — collapsible card; description, docs link, and advanced fields expand on click. */
export function ProviderKeyRows({ expanded, group, onExpand, onToggle, rowProps }: ProviderKeyRowsProps) {
  const { t } = useI18n()
  const docsUrl = group.docsUrl?.trim()
  const description = group.description?.trim()
  const expandable = Boolean(description || docsUrl || group.advanced.length > 0)

  return (
    <div
      className={cn(
        // A row of its settings card: Linear's 16px rhythm, no surface of its own.
        '@container group/card rounded-(--linear-radius-control) py-4 outline-none focus-visible:ring-1 focus-visible:ring-(--linear-focus)',
        expandable && 'cursor-pointer'
      )}
      onClick={expandable ? onToggle : undefined}
      onKeyDown={
        expandable
          ? e => {
              // Only the card's own focus toggles it — ignore Enter/Space
              // bubbling up from the inputs/buttons inside (Enter saves a key,
              // Space types a space) so keyboard editing never collapses the card.
              if (e.target !== e.currentTarget) {
                return
              }

              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onToggle()
              }
            }
          : undefined
      }
      role={expandable ? 'button' : undefined}
      tabIndex={expandable ? 0 : undefined}
    >
      {/* Same grid as CredentialKeyCard: 1 col stacked, 2 cols at @lg, py-4,
          gap-3, items-start, label row h-8 to line up with the input row. */}
      <div className={cn('grid grid-cols-1 items-start gap-x-3 gap-y-1.5 @lg:gap-y-3', LIST_ROW_COLUMNS)}>
        <div className="flex h-8 min-w-0 items-center gap-2">
          <span
            className={cn(
              'size-2 shrink-0 rounded-full',
              group.hasAnySet ? 'bg-(--linear-accent)' : 'bg-(--linear-border-tertiary)'
            )}
          />

          <span className="min-w-0 truncate text-[0.8125rem] font-medium text-(--linear-text-primary)">
            {group.name}
          </span>

          {expandable && (
            <ChevronDown
              className={cn(
                'size-3.5 shrink-0 text-(--linear-icon) transition',
                expanded ? 'rotate-180 opacity-100' : 'opacity-0 group-hover/card:opacity-100'
              )}
            />
          )}
        </div>

        <div
          className="min-w-0"
          onClick={e => e.stopPropagation()}
          onFocus={() => {
            if (expandable && !expanded) {
              onExpand()
            }
          }}
        >
          <KeyField
            editKey={`${group.name}:${group.primary[0]}`}
            expanded={expanded}
            info={group.primary[1]}
            placeholder={t.settings.credentials.pasteLabelKey(group.name)}
            rowProps={rowProps}
            varKey={group.primary[0]}
          />
        </div>

        {expandable && expanded && (
          <div className="grid gap-3 @lg:col-span-2" onClick={e => e.stopPropagation()}>
            {description && <p className="text-xs text-(--linear-text-tertiary)">{description}</p>}

            {group.advanced.map(([key, info]) => {
              const fieldLabel = isKeyVar(key, info)
                ? prettyName(key.replace(/(?:_API_KEY|_TOKEN|_KEY)$/i, ''))
                : friendlyFieldLabel(key, info)

              return (
                <ListRow
                  action={
                    <KeyField
                      editKey={`${group.name}:${key}`}
                      expanded={expanded}
                      info={info}
                      placeholder={credentialPlaceholder(key, info, fieldLabel)}
                      rowProps={rowProps}
                      varKey={key}
                    />
                  }
                  key={key}
                  title={fieldLabel}
                />
              )
            })}

            {docsUrl && <CredentialDocsLink href={docsUrl} />}
          </div>
        )}
      </div>
    </div>
  )
}

export function credentialRowLabel(varKey: string, info: EnvVarInfo): string {
  if (isKeyVar(varKey, info)) {
    return prettyName(varKey.replace(/(?:_API_KEY|_TOKEN|_KEY)$/i, ''))
  }

  return prettyName(varKey)
}

interface CredentialKeyCardProps {
  expanded: boolean
  info: EnvVarInfo
  label: string
  onExpand: () => void
  onToggle: () => void
  placeholder: string
  rowProps: KeyRowProps
  varKey: string
}

interface ProviderKeyRowsProps {
  expanded: boolean
  group: ProviderKeyRowGroup
  onExpand: () => void
  onToggle: () => void
  rowProps: KeyRowProps
}

export interface ProviderKeyRowGroup {
  advanced: [string, EnvVarInfo][]
  description?: string
  docsUrl?: string
  hasAnySet: boolean
  name: string
  primary: [string, EnvVarInfo]
}
