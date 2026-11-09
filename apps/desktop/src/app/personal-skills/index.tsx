import './page.css'

import { useStore } from '@nanostores/react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Check, CircleDashed, CodeXml, FileCode2, FileText, FolderGit2, Layers2, Library, ListChecks, Monitor, NotebookPen, Search } from 'lucide-react'
import { type ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'

import { PageLoader } from '@/components/page-loader'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { RowButton } from '@/components/ui/row-button'
import {
  getSkillContent,
  getSkills,
  type ProfileScope,
  profileScopeKey,
  type SkillContentResponse,
  type SkillCopyDirection,
  type SkillLocation,
  syncSkillSource
} from '@/hermes'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { $activeConnectionId } from '@/store/connections'
import { notify, notifyError } from '@/store/notifications'
import { $activeGatewayProfile, $profileScope, ALL_PROFILES } from '@/store/profile'
import type { SkillInfo } from '@/types/hermes'

import { useCapabilityScope } from '../capabilities/scope-selector'
import { isEditableProvenance } from '../capabilities/skills/skill-provenance'
import { skillsQueryKey } from '../capabilities/skills/skills-data'

import { parseSkillDocument, updateSkillDocument } from './document'
import { launchPersonalSkillSession } from './session-launcher'
import { SkillBodyEditor } from './skill-body-editor'
import { SkillVersionComparison } from './skill-version-comparison'

export interface PersonalSkillsPageProps extends ComponentProps<'section'> {
  /** Pin the page to one profile when it is mounted inside another surface. */
  fixedConnection?: string
  fixedProfile?: string
  /** The shell may provide its routed creator. Without it, the shared launcher
   * installed by the workspace wiring owns the same profile-aware path. */
  onOpenSession?: (args: { cwd?: string; profile: ProfileScope; prompt: string; skill: SkillInfo }) => void
}

interface OwnedSkill {
  key: string
  profile: ProfileScope
  skill: SkillInfo
}

interface SkillDraft {
  body: string
  description: string
  name: string
  sourceVersion?: string
}

interface SavedSkillName {
  name: string
  sourceVersion?: string
}

type SavedSkillNames = Record<string, SavedSkillName>

const CONTENT_KEY = ['personal-skill-content'] as const
const SAVED_NAMES_STORAGE_KEY = 'hermes:personal-skills:saved-source-names:v1'

function readSavedSkillNames(): SavedSkillNames {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const value = window.sessionStorage.getItem(SAVED_NAMES_STORAGE_KEY)

    return value ? JSON.parse(value) as SavedSkillNames : {}
  } catch {
    return {}
  }
}

function writeSavedSkillNames(names: SavedSkillNames): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.sessionStorage.setItem(SAVED_NAMES_STORAGE_KEY, JSON.stringify(names))
  } catch {
    // A private browsing context can reject storage; the in-memory state still works.
  }
}

function personalSkill(skill: SkillInfo): boolean {
  // Older runtimes omitted provenance. Their /api/skills response was already
  // profile-local, so unknown provenance remains visible for those users.
  return skill.provenance === undefined || isEditableProvenance(skill.provenance)
}

function scopeProfileName(profile: ProfileScope): string {
  return typeof profile === 'string' ? profile : (profile?.profile ?? $activeGatewayProfile.get())
}

function scopeFromOption(value: string): ProfileScope {
  const separator = value.indexOf('::')

  return separator >= 0 ? { connectionId: value.slice(0, separator), profile: value.slice(separator + 2) } : value
}

function ownedSkillKey(profile: ProfileScope, skill: SkillInfo): string {
  return `${profileScopeKey(profile)}::${skill.name}`
}

function editableText(element: HTMLElement): string {
  const text = typeof element.innerText === 'string' ? element.innerText : (element.textContent ?? '')

  return text.replace(/\n+$/, '')
}

function singleLineText(value: string): string {
  return value.replace(/\r\n|\r|\n/g, ' ')
}

function emitInput(element: HTMLElement, data: string): void {
  const event = typeof InputEvent === 'function'
    ? new InputEvent('input', { bubbles: true, data, inputType: 'insertText' })
    : new Event('input', { bubbles: true })

  element.dispatchEvent(event)
}

function insertPlainText(element: HTMLElement, value: string, singleLine: boolean): void {
  const text = singleLine ? singleLineText(value) : value
  const selection = window.getSelection()

  if (!selection || selection.rangeCount === 0 || !element.contains(selection.anchorNode)) {
    element.textContent = text
    emitInput(element, text)

    return
  }

  const range = selection.getRangeAt(0)
  range.deleteContents()
  const node = document.createTextNode(text)
  range.insertNode(node)
  range.setStartAfter(node)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
  emitInput(element, text)
}

function isSkillSyncConflict(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  const statusCode = (error as Error & { statusCode?: number }).statusCode

  return statusCode === 409 || /^409(?:\s|:)/.test(error.message)
}

const categoryIcons = new Map([
  ['note-taking', FileText],
  ['productivity', ListChecks],
  ['software-development', CodeXml],
  ['writing', NotebookPen]
])

function SkillIcon({ category, size }: { category: string; size: number }) {
  const Icon = categoryIcons.get(category) ?? BookOpen

  return <Icon aria-hidden className="shrink-0" size={size} strokeWidth={1.75} />
}

function SkillRow({
  displayName,
  owner,
  selected,
  skill,
  showOwner,
  onClick
}: {
  displayName?: string
  onClick: () => void
  owner: string
  selected: boolean
  skill: SkillInfo
  showOwner: boolean
}) {
  return (
    <RowButton
      aria-current={selected ? 'true' : undefined}
      className="personal-skills-row flex w-full items-center gap-2 text-left"
      data-selected={selected}
      onClick={onClick}
    >
      <SkillIcon category={skill.category} size={14} />
      <span className="min-w-0 flex-1 truncate">
        <span className="block truncate">{displayName || skill.name}</span>
        {showOwner && <span className="block truncate text-[0.6875rem] font-normal text-(--linear-text-tertiary)">{owner}</span>}
      </span>
    </RowButton>
  )
}

function EditableText({
  ariaLabel,
  className,
  editable = true,
  onInput,
  placeholder = '',
  saving,
  singleLine = false,
  value
}: {
  ariaLabel: string
  className?: string
  editable?: boolean
  onInput?: (value: string) => void
  placeholder?: string
  saving: boolean
  singleLine?: boolean
  value: string
}) {
  const editorRef = useRef<HTMLSpanElement>(null)
  const focused = useRef(false)

  useEffect(() => {
    if (editorRef.current && !focused.current && editorRef.current.textContent !== value) {
      editorRef.current.textContent = value
    }
  }, [placeholder, value])

  return (
    <span
      aria-label={ariaLabel}
      className={cn('personal-skills-inline-editor', className)}
      contentEditable={editable && !saving}
      data-editable={editable ? 'true' : 'false'}
      data-placeholder={placeholder || undefined}
      onBeforeInput={event => {
        const inputType = (event.nativeEvent as InputEvent).inputType

        if (inputType === 'insertParagraph' || inputType === 'insertLineBreak') {
          event.preventDefault()
        }
      }}
      onBlur={() => { focused.current = false }}
      onFocus={() => {
        focused.current = true
      }}
      onInput={() => {
        if (!editorRef.current) {
          return
        }

        const next = singleLine ? singleLineText(editableText(editorRef.current)) : editableText(editorRef.current)

        if (singleLine && editorRef.current.textContent !== next) {
          editorRef.current.textContent = next
        }

        onInput?.(next)
      }}
      onKeyDown={event => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault()
          editorRef.current?.blur()
        }
      }}
      onPaste={event => {
        event.preventDefault()
        insertPlainText(event.currentTarget, event.clipboardData.getData('text/plain'), singleLine)
      }}
      ref={editorRef}
      role="textbox"
      spellCheck
      suppressContentEditableWarning
    />
  )
}

function SkillDetailHeader({
  category,
  description,
  editable,
  name,
  onDescriptionInput,
  onNameInput,
  saving,
  t
}: {
  category: string
  description: string
  editable: boolean
  name: string
  onDescriptionInput: (value: string) => void
  onNameInput: (value: string) => void
  saving: boolean
  t: ReturnType<typeof useI18n>['t']
}) {
  return (
    <header className="personal-skills-skill-header">
      <div className="personal-skills-skill-mark" data-category={category}><SkillIcon category={category} size={21} /></div>
      <h1><EditableText ariaLabel={t.skills.personalPage.nameLabel} editable={editable} onInput={onNameInput} saving={saving} singleLine value={name} /></h1>
      <p><EditableText ariaLabel={t.skills.personalPage.descriptionLabel} editable={editable} onInput={onDescriptionInput} placeholder={t.skills.noDescription} saving={saving} value={description} /></p>
    </header>
  )
}

function SkillDetailProperties({ installation, installationStatus, repository, t }: { installation: string; installationStatus?: string; repository: string; t: ReturnType<typeof useI18n>['t'] }) {
  return (
    <div className="personal-skills-properties">
      <div><span><FolderGit2 aria-hidden size={14} strokeWidth={1.75} />{t.skills.personalPage.repository}</span><b>{repository}</b></div>
      <div><span><Layers2 aria-hidden size={14} strokeWidth={1.75} />{t.skills.personalPage.installation}</span><b>{installationStatus === 'identical' ? <Check aria-hidden className="text-(--linear-text-tertiary)" size={14} strokeWidth={1.75} /> : installationStatus === 'different' ? <CircleDashed aria-hidden className="text-(--linear-orange)" size={14} strokeWidth={1.75} /> : null}{installation}</b></div>
    </div>
  )
}

function skillInstallationLabel(location: SkillLocation | undefined, sourceAvailable: boolean, t: ReturnType<typeof useI18n>['t']): string {
  if (location?.installation?.status === 'different') {
    return t.skills.personalPage.differentFromSource
  }

  if (location?.installation?.status === 'identical') {
    return t.skills.personalPage.sameAsSource
  }

  return sourceAvailable ? t.skills.personalPage.unknownInstallation : t.skills.personalPage.sourceUnavailable
}

function skillSourceAvailable(sourceContent: null | string | undefined, location: SkillLocation | undefined): boolean {
  return sourceContent !== undefined && sourceContent !== null
    ? true
    : Boolean(location?.source?.exists || location?.installation?.source_version)
}

function skillDocumentName(content: null | string | undefined): string | undefined {
  if (!content) {
    return undefined
  }

  const name = parseSkillDocument(content).metadata.find(field => field.key === 'name')?.value.trim()

  return name || undefined
}

function skillVisibleFields(
  version: 'installed' | 'source',
  draft: SkillDraft | undefined,
  installed: { body?: string; description: string; name: string }
): { body?: string; description: string; name: string } {
  if (version === 'source' && draft) {
    return draft
  }

  return installed
}

function skillFilePaths(version: 'installed' | 'source', location: SkillLocation | undefined, contentPath: string | undefined): { displayPath?: string; fullPath?: string } {
  const fileLocation = version === 'source' ? location?.source : location?.runtime
  const fullPath = fileLocation?.path || contentPath

  return { displayPath: fileLocation?.display_path || fullPath, fullPath }
}

function SkillFileSwitcher({
  contentAvailable,
  onOpenSession,
  onVersionChange,
  sourceAvailable,
  t,
  version
}: {
  contentAvailable: boolean
  onOpenSession: () => void
  onVersionChange: (version: 'installed' | 'source') => void
  sourceAvailable: boolean
  t: ReturnType<typeof useI18n>['t']
  version: 'installed' | 'source'
}) {
  return (
    <div className="personal-skills-filebar">
      <div className="personal-skills-segments">
        <button aria-pressed={version === 'source'} disabled={!sourceAvailable} onClick={() => onVersionChange('source')} type="button">{t.skills.personalPage.source}</button>
        <button aria-pressed={version === 'installed'} disabled={!contentAvailable} onClick={() => onVersionChange('installed')} type="button">{t.skills.personalPage.installed}</button>
      </div>
      <Button disabled={!contentAvailable} onClick={onOpenSession} size="xs" variant="text"><Codicon name="comment-discussion" size="0.875rem" />{t.skills.openSession}</Button>
    </div>
  )
}

function SkillFileCard({
  body,
  editable,
  error,
  loading,
  onBodyChange,
  parsed,
  path,
  saving,
  fullPath,
  t,
  version
}: {
  body?: string
  editable: boolean
  error?: unknown
  loading: boolean
  onBodyChange: (body: string) => void
  parsed: ReturnType<typeof parseSkillDocument> | null
  path?: string
  saving: boolean
  fullPath?: string
  t: ReturnType<typeof useI18n>['t']
  version: 'installed' | 'source'
}) {
  return (
    <section className="personal-skills-file">
      {loading ? (
        <PageLoader className="h-52" label={t.skills.loading} />
      ) : error ? (
        <p className="rounded-(--linear-radius-card) bg-(--linear-bg-secondary) p-4 text-sm text-(--linear-red)">
          {error instanceof Error ? error.message : t.skills.skillsLoadFailed}
        </p>
      ) : parsed && body !== undefined ? (
        <SkillBodyEditor
          ariaLabel={t.skills.personalPage.bodyLabel}
          body={body}
          key={version}
          onChange={onBodyChange}
          readOnly={!editable || saving}
        />
      ) : null}
      <footer className="personal-skills-footer">
        <div><FileCode2 aria-hidden size={14} strokeWidth={1.75} /><strong>SKILL.md</strong></div>
        {path && <code title={fullPath}>{path}</code>}
      </footer>
    </section>
  )
}

function SkillSaveRow({ disabled, dirty, onSave, saving, t }: { disabled: boolean; dirty: boolean; onSave: () => void; saving: boolean; t: ReturnType<typeof useI18n>['t'] }) {
  return (
    <div className="personal-skills-save-row"><Button disabled={disabled || !dirty || saving} onClick={onSave} size="default" variant="secondary">{saving ? t.common.saving : t.skills.personalPage.save}</Button><span>{dirty ? t.skills.personalPage.unsavedChanges : ''}</span></div>
  )
}

function SkillDetail({
  content,
  contentPath,
  draft,
  editorKey,
  error,
  loading,
  location,
  onOpenSession,
  onSave,
  onDraftChange,
  onSync,
  saving,
  skill,
  sourceContent,
  sourceVersion,
  t
}: {
  content?: string
  contentPath?: string
  draft?: SkillDraft
  editorKey: string
  error?: unknown
  loading: boolean
  location?: SkillLocation
  onOpenSession: () => void
  onDraftChange: (draft: SkillDraft) => void
  onSave: (next: string, target: 'source' | 'installed', expectedSourceVersion?: string) => Promise<void>
  onSync: (direction: SkillCopyDirection) => Promise<void>
  saving: boolean
  skill: SkillInfo
  sourceContent?: null | string
  sourceVersion?: null | string
  t: ReturnType<typeof useI18n>['t']
}) {
  const sourceAvailable = skillSourceAvailable(sourceContent, location)

  const [version, setVersion] = useState<'installed' | 'source'>('source')
  const displayedContent = version === 'source' && sourceAvailable ? sourceContent ?? content : content

  const parsed = useMemo(
    () => (displayedContent === undefined ? null : parseSkillDocument(displayedContent)),
    [displayedContent]
  )

  const nameField = parsed?.metadata.find(field => field.key === 'name')
  const descriptionField = parsed?.metadata.find(field => field.key === 'description')
  const sourceEditable = location?.source?.editable ?? false
  const editable = version === 'source' && sourceAvailable && sourceEditable && isEditableProvenance(skill.provenance)

  const { displayPath, fullPath } = skillFilePaths(version, location, contentPath)

  const repository = location?.repo || location?.source?.repo

  const repositoryLabel =
    (typeof repository === 'string' ? repository : repository?.name) ||
    (skill.provenance === 'external' ? t.skills.personalPage.externalRepository : t.skills.personalPage.defaultRepository)

  const installationLabel = skillInstallationLabel(location, sourceAvailable, t)

  useEffect(() => {
    setVersion('source')
  }, [editorKey])

  useEffect(() => {
    if (!loading && !sourceAvailable && version === 'source') {
      setVersion('installed')
    }
  }, [loading, sourceAvailable, version])

  const baseName = nameField?.value ?? skill.name
  const baseDescription = descriptionField?.value ?? skill.description
  const baseBody = parsed?.body ?? ''

  const commitDraft = useCallback((updates: Partial<SkillDraft>) => {
    const current = draft ?? { body: baseBody, description: baseDescription, name: baseName, sourceVersion }

    onDraftChange({
      body: updates.body ?? current.body,
      description: updates.description ?? current.description,
      name: updates.name ?? current.name,
      sourceVersion: current.sourceVersion ?? sourceVersion ?? undefined
    })
  }, [baseBody, baseDescription, baseName, draft, onDraftChange, sourceVersion])

  const saveDraft = useCallback(() => {
    if (displayedContent === undefined || !editable || version !== 'source' || !draft || !draft.name.trim()) {
      return Promise.resolve()
    }

    const updates: Record<string, string> = {}
    const initialName = baseName
    const initialDescription = baseDescription

    if (draft.name !== initialName) {updates.name = draft.name}

    if (draft.description !== initialDescription) {updates.description = draft.description}

    return onSave(
      updateSkillDocument(displayedContent, updates, draft.body),
      'source',
      draft.sourceVersion
    )
  }, [baseDescription, baseName, displayedContent, draft, editable, onSave, version])

  const visible = skillVisibleFields(
    version,
    draft,
    { body: parsed?.body, description: baseDescription, name: baseName }
  )

  return (
    <div className="personal-skills-detail-inner">
      <SkillDetailHeader
        category={skill.category}
        description={visible.description}
        editable={editable}
        name={visible.name}
        onDescriptionInput={value => commitDraft({ description: value })}
        onNameInput={value => commitDraft({ name: value })}
        saving={saving}
        t={t}
      />
      <SkillDetailProperties installation={installationLabel} installationStatus={location?.installation?.status} repository={repositoryLabel} t={t} />
      <SkillFileSwitcher
        contentAvailable={content !== undefined}
        onOpenSession={onOpenSession}
        onVersionChange={setVersion}
        sourceAvailable={sourceAvailable}
        t={t}
        version={version}
      />
      <SkillFileCard
        body={visible.body}
        editable={editable}
        error={error}
        fullPath={fullPath}
        loading={loading}
        onBodyChange={body => commitDraft({ body })}
        parsed={parsed}
        path={displayPath}
        saving={saving}
        t={t}
        version={version}
      />
      {version === 'source' && <SkillSaveRow dirty={Boolean(draft)} disabled={!editable || !draft?.name.trim()} onSave={() => void saveDraft().catch(() => undefined)} saving={saving} t={t} />}
      <SkillVersionComparison
        installedContent={content}
        location={location}
        onSync={onSync}
        saving={saving}
        sourceContent={sourceContent}
        t={t}
      />
    </div>
  )
}

interface SkillGroup {
  items: OwnedSkill[]
  label: null | string
}

function skillCategoryLabel(category: string | undefined): null | string {
  const value = category?.trim()

  if (!value || value.toLocaleLowerCase() === 'default') {
    return null
  }

  return value
    .split(/[\\/]/)
    .at(-1)
    ?.replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, character => character.toLocaleUpperCase()) || null
}

function groupSkills(skills: OwnedSkill[]): SkillGroup[] {
  const groups = new Map<string, OwnedSkill[]>()

  for (const item of skills) {
    const key = item.skill.category?.trim() || ''
    const group = groups.get(key)

    if (group) {
      group.push(item)
    } else {
      groups.set(key, [item])
    }
  }

  return [...groups.entries()].map(([category, items]) => ({ items, label: skillCategoryLabel(category) }))
}

function SkillSidebar({
  drafts,
  empty,
  failed,
  onQueryChange,
  onSelect,
  pending,
  profile,
  query,
  savedName,
  scopeProfile,
  selected,
  t,
  visibleSkills
}: {
  drafts: Record<string, SkillDraft>
  empty: boolean
  failed: boolean
  onQueryChange: (query: string) => void
  onSelect: (key: string) => void
  pending: boolean
  profile?: string
  query: string
  savedName?: string
  scopeProfile: ProfileScope
  selected?: OwnedSkill
  t: ReturnType<typeof useI18n>['t']
  visibleSkills: OwnedSkill[]
}) {
  const groups = useMemo(() => groupSkills(visibleSkills), [visibleSkills])

  return (
    <aside className="personal-skills-sidebar flex min-h-0 flex-col gap-2">
      <div className="personal-skills-identity">
        <span className="personal-skills-monogram">H</span>
        <strong>Hermès</strong>
        <span>{profile ? scopeProfileName(scopeProfile) : t.skills.all}</span>
      </div>
      <label className="personal-skills-search">
        <Search aria-hidden size={14} strokeWidth={1.75} />
        <input aria-label={t.skills.searchSkills} onChange={event => onQueryChange(event.target.value)} placeholder={t.skills.searchSkills} type="search" value={query} />
      </label>
      <div className="personal-skills-list flex-1 space-y-0.5">
        {pending ? (
          <PageLoader className="h-32" label={t.skills.loading} />
        ) : failed ? (
          <p className="px-2 py-3 text-xs text-(--linear-red)">{t.skills.skillsLoadFailed}</p>
        ) : empty ? (
          <p className="px-2 py-3 text-xs leading-5 text-(--linear-text-tertiary)">{t.skills.personalEmpty}</p>
        ) : (
          groups.map((group, groupIndex) => (
            <div key={group.label ?? `ungrouped-${groupIndex}`}>
              {group.label && <div className="personal-skills-category">{group.label}</div>}
              {group.items.map(item => (
                <SkillRow
                  displayName={drafts[item.key]?.name ?? (item.key === selected?.key ? savedName : undefined)}
                  key={item.key}
                  onClick={() => onSelect(item.key)}
                  owner={scopeProfileName(item.profile)}
                  selected={item.key === selected?.key}
                  showOwner={!profile}
                  skill={item.skill}
                />
              ))}
            </div>
          ))
        )}
        {!pending && !failed && !empty && visibleSkills.length === 0 && <p className="px-2 py-3 text-xs text-(--linear-text-tertiary)">{t.skills.emptyNothingMatches(query)}</p>}
      </div>
    </aside>
  )
}

function SkillMain({
  content,
  contentPath,
  displayName,
  draft,
  error,
  loading,
  location,
  onOpenSession,
  onDraftChange,
  onSave,
  onSync,
  saving,
  selected,
  sourceContent,
  sourceVersion,
  t
}: {
  content?: string
  contentPath?: string
  displayName?: string
  draft?: SkillDraft
  error?: unknown
  loading: boolean
  location?: SkillLocation
  onOpenSession: () => void
  onDraftChange: (draft: SkillDraft) => void
  onSave: (next: string, target: 'source' | 'installed', expectedSourceVersion?: string) => Promise<void>
  onSync: (direction: SkillCopyDirection) => Promise<void>
  saving: boolean
  selected?: OwnedSkill
  sourceContent?: null | string
  sourceVersion?: null | string
  t: ReturnType<typeof useI18n>['t']
}) {
  const machine = location?.machine && location.machine !== 'unknown' ? location.machine : null

  return (
    <main className="personal-skills-detail">
      <header className="personal-skills-detail-bar">
        <Library aria-hidden className="text-(--linear-text-tertiary)" size={14} strokeWidth={1.75} />
        <span>Skills</span><span>/</span><strong>{displayName ?? selected?.skill.name ?? t.skills.personalPageTitle}</strong>
        {machine && <span className="personal-skills-machine"><Monitor aria-hidden size={14} strokeWidth={1.75} />{machine}</span>}
      </header>
      {selected ? <SkillDetail content={content} contentPath={contentPath} draft={draft} editorKey={selected.key} error={error} loading={loading} location={location} onDraftChange={onDraftChange} onOpenSession={onOpenSession} onSave={onSave} onSync={onSync} saving={saving} skill={selected.skill} sourceContent={sourceContent} sourceVersion={sourceVersion} t={t} /> : <div className="grid h-full min-h-56 place-items-center px-8 text-sm text-(--linear-text-tertiary)">{t.skills.personalEmpty}</div>}
    </main>
  )
}

export function PersonalSkillsPage({
  fixedConnection,
  fixedProfile,
  onOpenSession,
  ...props
}: PersonalSkillsPageProps) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const sidebarProfile = useStore($profileScope)
  const connectionId = useStore($activeConnectionId)
  const profile = fixedProfile ?? (sidebarProfile === ALL_PROFILES ? undefined : sidebarProfile)

  const scope = useCapabilityScope({
    fixedConnection: fixedConnection ?? connectionId ?? undefined,
    fixedProfile: profile
  })

  const profileScopes = useMemo(() => {
    if (profile) {
      return [scope.profile]
    }

    const options = scope.options.map(option => scopeFromOption(option.value))

    return options.length > 0 ? options : [scope.profile]
  }, [profile, scope.options, scope.profile])

  const profileQueries = useQueries({
    queries: profileScopes.map(profile => ({
      queryKey: skillsQueryKey(profile),
      queryFn: () => getSkills(profile),
      staleTime: 0
    }))
  })

  const skills = useMemo<OwnedSkill[]>(
    () =>
      profileQueries.flatMap((query, index) =>
        (query.data ?? [])
          .filter(personalSkill)
          .map(skill => ({ key: ownedSkillKey(profileScopes[index], skill), profile: profileScopes[index], skill }))
      ),
    [profileQueries, profileScopes]
  )

  const selectedFromUrl = searchParams.get('skill')
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(selectedFromUrl)
  const [skillDrafts, setSkillDrafts] = useState<Record<string, SkillDraft>>({})
  const [savedSkillNames, setSavedSkillNames] = useState<SavedSkillNames>(readSavedSkillNames)

  const selected =
    skills.find(item => item.key === selectedKey) ?? skills.find(item => item.skill.name === selectedKey) ?? skills[0]

  const selectedIndex = selected ? skills.findIndex(item => item.key === selected.key) : -1
  const [saving, setSaving] = useState(false)

  const updateSkillDraft = useCallback((key: string, draft: SkillDraft) => {
    setSkillDrafts(current => ({ ...current, [key]: draft }))
  }, [])

  const clearSkillDraft = useCallback((key: string) => {
    setSkillDrafts(current => {
      if (!current[key]) {
        return current
      }

      const next = { ...current }
      delete next[key]

      return next
    })
  }, [])

  const rememberSavedSkillName = useCallback((key: string, entry: SavedSkillName) => {
    setSavedSkillNames(current => {
      const next = { ...current, [key]: entry }
      writeSavedSkillNames(next)

      return next
    })
  }, [])

  useEffect(() => {
    const next =
      selectedFromUrl && skills.some(item => item.key === selectedFromUrl || item.skill.name === selectedFromUrl)
        ? selectedFromUrl
        : (skills[0]?.key ?? null)

    setSelectedKey(current => (current === next ? current : next))
  }, [selectedFromUrl, skills])

  useEffect(() => {
    if (selected?.key && selected.key !== searchParams.get('skill')) {
      setSearchParams(
        current => {
          const next = new URLSearchParams(current)
          next.set('skill', selected.key)

          return next
        },
        { replace: true }
      )
    }
  }, [searchParams, selected?.key, setSearchParams])

  const selectSkill = useCallback(
    (key: string) => {
      setSelectedKey(key)
      setSearchParams(
        current => {
          const next = new URLSearchParams(current)
          next.set('skill', key)

          return next
        },
        { replace: true }
      )
    },
    [setSearchParams]
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey || !event.altKey || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') || !skills.length) {
        return
      }

      event.preventDefault()
      const delta = event.key === 'ArrowDown' ? 1 : -1
      const nextIndex = Math.min(skills.length - 1, Math.max(0, selectedIndex + delta))

      if (nextIndex !== selectedIndex) {
        selectSkill(skills[nextIndex].key)
      }
    }

    document.addEventListener('keydown', onKeyDown)

    return () => document.removeEventListener('keydown', onKeyDown)
  }, [selectSkill, selectedIndex, skills])

  const contentQuery = useQuery({
    enabled: Boolean(selected),
    queryKey: [...CONTENT_KEY, selected?.skill.name ?? '', profileScopeKey(selected?.profile)],
    queryFn: () => getSkillContent(selected!.skill.name, selected!.profile),
    staleTime: 60_000
  })

  const runtimeVersion = contentQuery.data?.location?.installation?.runtime_version
  const sourceVersion = contentQuery.data?.location?.installation?.source_version

  const saveContent = useCallback(
    async (next: string, target: 'source' | 'installed', expectedSourceVersionOverride?: string) => {
      if (!selected || target !== 'source') {
        return
      }

      const expectedVersion = expectedSourceVersionOverride ?? sourceVersion

      if (!expectedVersion) {
        const error = new Error(t.skills.personalPage.sourceReadOnly)
        notifyError(error, t.skills.failedToUpdate(selected.skill.name))
        throw error
      }

      setSaving(true)

      try {
        const result = await syncSkillSource(
          selected.skill.name,
          'edit_source',
          {
            content: next,
            expectedSourceVersion: expectedVersion,
            profile: selected.profile
          }
        )

        if (!result.success) {
          throw new Error(result.error || t.skills.personalPage.syncFailed)
        }

        queryClient.setQueryData(
          [...CONTENT_KEY, selected.skill.name, profileScopeKey(selected.profile)],
          (current: SkillContentResponse | undefined) =>
            current
              ? { ...current, location: result.location ?? current.location, source_content: next }
              : current
        )
        const savedName = parseSkillDocument(next).metadata.find(field => field.key === 'name')?.value.trim()

        if (savedName) {
          rememberSavedSkillName(selected.key, {
            name: savedName,
            sourceVersion: result.version ?? result.location?.installation?.source_version ?? expectedVersion
          })
        }

        clearSkillDraft(selected.key)
        void queryClient.invalidateQueries({ queryKey: skillsQueryKey(selected.profile), exact: true })
        notify({
          kind: 'success',
          title: t.skills.skillUpdated,
          message: t.skills.skillUpdated
        })
      } catch (error) {
        notifyError(
          error,
          isSkillSyncConflict(error) ? t.skills.personalPage.syncConflict : t.skills.failedToUpdate(selected.skill.name)
        )
        throw error
      } finally {
        setSaving(false)
      }
    },
    [clearSkillDraft, queryClient, rememberSavedSkillName, selected, sourceVersion, t]
  )

  const syncVersions = useCallback(
    async (direction: SkillCopyDirection) => {
      if (!selected || !runtimeVersion || !sourceVersion) {
        return
      }

      setSaving(true)

      try {
        const result = await syncSkillSource(selected.skill.name, direction, {
          expectedRuntimeVersion: runtimeVersion,
          expectedSourceVersion: sourceVersion,
          profile: selected.profile
        })

        if (!result.success) {
          throw new Error(result.error || t.skills.personalPage.syncFailed)
        }

        queryClient.setQueryData(
          [...CONTENT_KEY, selected.skill.name, profileScopeKey(selected.profile)],
          (current: SkillContentResponse | undefined) => {
            if (!current) {
              return current
            }

            return {
              ...current,
              content: direction === 'source_to_installed' ? current.source_content ?? current.content : current.content,
              location: result.location ?? current.location,
              source_content: direction === 'installed_to_source' ? current.content : current.source_content
            }
          }
        )
        void queryClient.invalidateQueries({ queryKey: skillsQueryKey(selected.profile), exact: true })
        notify({ kind: 'success', message: t.skills.skillUpdated, title: t.skills.skillUpdated })
      } catch (error) {
        notifyError(error, isSkillSyncConflict(error) ? t.skills.personalPage.syncConflict : t.skills.personalPage.syncFailed)
        throw error
      } finally {
        setSaving(false)
      }
    },
    [queryClient, runtimeVersion, selected, sourceVersion, t]
  )

  const launchSession = useCallback(() => {
    const file = contentQuery.data

    if (!selected || !file) {
      return
    }

    const source = file.location?.source
    const sourcePath = source?.exists ? source.path : undefined
    const path = sourcePath || file.path
    const cwd = (sourcePath ? source?.cwd : file.location?.runtime?.cwd) ?? undefined
    const label = sourcePath ? t.skills.personalPage.source : t.skills.personalPage.installed
    const prompt = `${selected.skill.name} · ${label}\n${path}\n\n`

    if (onOpenSession) {
      onOpenSession({ cwd, profile: selected.profile, prompt, skill: selected.skill })

      return
    }

    if (!launchPersonalSkillSession({ cwd, profile: selected.profile, prompt, skill: selected.skill })) {
      notifyError(new Error(t.skills.openSession), t.skills.openSession)
    }
  }, [contentQuery.data, onOpenSession, selected, t])

  const pending = profileQueries.some(query => query.isPending)
  const failed = profileQueries.length > 0 && profileQueries.every(query => query.isError)
  const empty = !pending && skills.length === 0

  const visibleSkills = useMemo(() => {
    const value = query.trim().toLocaleLowerCase()

    return value
      ? skills.filter(item => `${skillDrafts[item.key]?.name ?? item.skill.name} ${item.skill.description} ${item.skill.category ?? ''}`.toLocaleLowerCase().includes(value))
      : skills
  }, [query, skillDrafts, skills])

  const selectedSavedName = selected ? savedSkillNames[selected.key] : undefined
  const sourceContentName = skillDocumentName(contentQuery.data?.source_content)

  const selectedDisplayName = selected
    ? skillDrafts[selected.key]?.name ?? selectedSavedName?.name ?? sourceContentName
    : undefined

  return (
    <section {...props} className={cn('personal-skills-page flex h-full min-h-0 flex-col', props.className)}>
      <div className="personal-skills-body min-h-0 flex-1">
        <SkillSidebar
          drafts={skillDrafts}
          empty={empty}
          failed={failed}
          onQueryChange={setQuery}
          onSelect={selectSkill}
          pending={pending}
          profile={profile}
          query={query}
          savedName={selectedDisplayName}
          scopeProfile={scope.profile}
          selected={selected}
          t={t}
          visibleSkills={visibleSkills}
        />
        <SkillMain
          content={contentQuery.data?.content}
          contentPath={contentQuery.data?.path}
          displayName={selectedDisplayName}
          draft={selected ? skillDrafts[selected.key] : undefined}
          error={contentQuery.error}
          loading={contentQuery.isPending}
          location={contentQuery.data?.location}
          onDraftChange={draft => {
            if (selected) {
              updateSkillDraft(selected.key, draft)
            }
          }}
          onOpenSession={launchSession}
          onSave={saveContent}
          onSync={syncVersions}
          saving={saving}
          selected={selected}
          sourceContent={contentQuery.data?.source_content}
          sourceVersion={sourceVersion}
          t={t}
        />
      </div>
    </section>
  )
}

/** Route/tile name used by the workspace shell. */
export const PersonalSkillsView = PersonalSkillsPage

export default PersonalSkillsPage
