import './page.css'

import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'

import { PageLoader } from '@/components/page-loader'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { RowButton } from '@/components/ui/row-button'
import { editLearningNode, getSkillContent, getSkills, type ProfileScope, profileScopeKey } from '@/hermes'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { notify, notifyError } from '@/store/notifications'
import { $activeGatewayProfile } from '@/store/profile'
import type { SkillInfo } from '@/types/hermes'

import { useCapabilityScope } from '../capabilities/scope-selector'
import { isEditableProvenance } from '../capabilities/skills/skill-provenance'
import { skillsQueryKey } from '../capabilities/skills/skills-data'

import { parseSkillDocument, type SkillMetadataField, updateSkillDocument } from './document'
import { launchPersonalSkillSession } from './session-launcher'

export interface PersonalSkillsPageProps extends ComponentProps<'section'> {
  /** Pin the page to one profile when it is mounted inside another surface. */
  fixedConnection?: string
  fixedProfile?: string
  /** The shell may provide its routed creator. Without it, the shared launcher
   * installed by the workspace wiring owns the same profile-aware path. */
  onOpenSession?: (args: { profile: ProfileScope; prompt: string; skill: SkillInfo }) => void
}

interface OwnedSkill {
  key: string
  profile: ProfileScope
  skill: SkillInfo
}

const CONTENT_KEY = ['personal-skill-content'] as const

function personalSkill(skill: SkillInfo): boolean {
  // Older runtimes omitted provenance. Their /api/skills response was already
  // profile-local, so unknown provenance remains visible for those users.
  return skill.provenance === undefined || isEditableProvenance(skill.provenance)
}

function scopeProfileName(profile: ProfileScope): string {
  return typeof profile === 'string' ? profile : profile?.profile ?? $activeGatewayProfile.get()
}

function scopeFromOption(value: string): ProfileScope {
  const separator = value.indexOf('::')

  return separator >= 0
    ? { connectionId: value.slice(0, separator), profile: value.slice(separator + 2) }
    : value
}

function ownedSkillKey(profile: ProfileScope, skill: SkillInfo): string {
  return `${profileScopeKey(profile)}::${skill.name}`
}

function editableText(element: HTMLElement): string {
  const parts: string[] = []

  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.nodeValue ?? '')

      return
    }

    if (node.nodeName === 'BR') {
      parts.push('\n')

      return
    }

    node.childNodes.forEach(visit)

    if (node.nodeType === Node.ELEMENT_NODE && /^(DIV|P|LI)$/.test(node.nodeName)) {
      parts.push('\n')
    }
  }

  visit(element)

  return parts.join('').replace(/\n+$/, '')
}

function skillPrompt(skill: SkillInfo): string {
  return `/${skill.name}\n\n`
}

function SkillRow({ owner, selected, skill, onClick }: { onClick: () => void; owner: string; selected: boolean; skill: SkillInfo }) {
  return (
    <RowButton
      aria-current={selected ? 'true' : undefined}
      className="personal-skills-row flex w-full items-center gap-2 text-left"
      data-selected={selected}
      onClick={onClick}
    >
      <Codicon className="shrink-0 text-(--linear-text-tertiary)" name="book" size="0.875rem" />
      <span className="min-w-0 flex-1 truncate">
        <span className="block truncate">{skill.name}</span>
        <span className="block truncate text-[0.6875rem] font-normal text-(--linear-text-tertiary)">{owner}</span>
      </span>
    </RowButton>
  )
}

function EditableText({
  ariaLabel,
  className,
  onSave,
  saving,
  value
}: {
  ariaLabel: string
  className?: string
  onSave?: (value: string) => Promise<void>
  saving: boolean
  value: string
}) {
  const editorRef = useRef<HTMLSpanElement>(null)
  const dirty = useRef(false)
  const lastValue = useRef(value)

  const save = useCallback(async () => {
    const next = editorRef.current ? editableText(editorRef.current) : ''

    if (!onSave || !dirty.current || next === lastValue.current) {
      return
    }

    await onSave(next)
    lastValue.current = next
    dirty.current = false
  }, [onSave])

  return (
    <span
      aria-label={ariaLabel}
      className={cn('personal-skills-inline-editor', className)}
      contentEditable={Boolean(onSave) && !saving}
      onBlur={() => void save().catch(() => undefined)}
      onInput={() => {
        dirty.current = true
      }}
      onKeyDown={event => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault()
          void save().catch(() => undefined)
        }
      }}
      ref={editorRef}
      role={onSave ? 'textbox' : undefined}
      spellCheck
      suppressContentEditableWarning
    >
      {value}
    </span>
  )
}

function SkillEditor({
  content,
  onSave,
  saving,
  skillName
}: {
  content: string
  onSave: (content: string) => Promise<void>
  saving: boolean
  skillName: string
}) {
  const editorRef = useRef<HTMLDivElement>(null)
  const dirty = useRef(false)
  const lastContent = useRef(content)

  const save = useCallback(async () => {
    const value = editorRef.current ? editableText(editorRef.current) : ''

    if (!dirty.current || value === lastContent.current) {
      return
    }

    await onSave(value)
    lastContent.current = value
    dirty.current = false
  }, [onSave])

  return (
    <div
      aria-label={skillName}
      className="personal-skills-editor"
      contentEditable={!saving}
      data-skill-editor="true"
      onBlur={() => void save().catch(() => undefined)}
      onInput={() => {
        dirty.current = true
      }}
      onKeyDown={event => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault()
          void save().catch(() => undefined)
        }
      }}
      ref={editorRef}
      role="textbox"
      spellCheck
      suppressContentEditableWarning
    >
      {content}
    </div>
  )
}

function SkillDetail({
  content,
  editorKey,
  error,
  loading,
  onOpenSession,
  onSave,
  saving,
  skill,
  t
}: {
  content?: string
  editorKey: string
  error?: unknown
  loading: boolean
  onOpenSession: () => void
  onSave: (next: string) => Promise<void>
  saving: boolean
  skill: SkillInfo
  t: ReturnType<typeof useI18n>['t']
}) {
  const parsed = useMemo(() => (content === undefined ? null : parseSkillDocument(content)), [content])
  const metadata = parsed?.metadata ?? []
  const nameField = metadata.find(field => field.key === 'name')
  const descriptionField = metadata.find(field => field.key === 'description')

  const saveMetadata = useCallback(
    (field: SkillMetadataField, value: string) => {
      if (content === undefined) {
        return Promise.resolve()
      }

      return onSave(updateSkillDocument(content, { [field.key]: value }))
    },
    [content, onSave]
  )

  const saveBody = useCallback(
    (body: string) => {
      if (content === undefined) {
        return Promise.resolve()
      }

      return onSave(updateSkillDocument(content, {}, body))
    },
    [content, onSave]
  )

  const editableField = (field: SkillMetadataField) => (
    <EditableText
      ariaLabel={field.key}
      key={`${field.key}:${field.value}`}
      onSave={value => saveMetadata(field, value)}
      saving={saving}
      value={field.value}
    />
  )

  return (
    <div className="personal-skills-detail-inner space-y-7">
      <header className="space-y-2">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="break-words text-[1.5rem] leading-8 font-medium tracking-[-0.16px] text-(--linear-text-primary)">
              {nameField ? editableField(nameField) : skill.name}
            </h1>
            <p className="mt-1 text-[0.8125rem] leading-5 text-(--linear-text-secondary)">
              {descriptionField ? editableField(descriptionField) : skill.description || t.skills.noDescription}
            </p>
          </div>
          <Button onClick={onOpenSession} size="sm">
            <Codicon name="comment-discussion" size="0.875rem" />
            {t.skills.openSession}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-(--linear-text-tertiary)">
          <span className="rounded-full bg-(--linear-hover-control) px-2 py-0.5">{t.skills.personal}</span>
          <span>{skill.enabled ? t.skills.skillEnabled : t.skills.skillDisabled}</span>
          {typeof skill.usage === 'number' && <span>{t.skills.usageCount(skill.usage)}</span>}
        </div>
      </header>

      {metadata.length ? (
        <section aria-label={t.skills.metadata} className="space-y-2">
          <h2 className="text-[0.8125rem] font-medium text-(--linear-text-primary)">{t.skills.metadata}</h2>
          <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-5 gap-y-2 rounded-(--linear-radius-card) bg-(--linear-bg-secondary) p-4 text-xs">
            {metadata.map(field => (
              <div className="contents" key={field.key}>
                <dt className="text-(--linear-text-tertiary)">{field.key}</dt>
                <dd className="m-0 whitespace-pre-wrap break-words text-(--linear-text-secondary)">
                  {editableField(field)}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[0.8125rem] font-medium text-(--linear-text-primary)">{t.skills.instructions}</h2>
          <span className="text-[0.6875rem] text-(--linear-text-quaternary)">
            {saving ? t.common.saving : t.skills.clickToEdit}
          </span>
        </div>
        {loading ? (
          <PageLoader className="h-52" label={t.skills.loading} />
        ) : error ? (
          <p className="rounded-(--linear-radius-card) bg-(--linear-bg-secondary) p-4 text-sm text-(--linear-red)">
            {error instanceof Error ? error.message : t.skills.skillsLoadFailed}
          </p>
        ) : parsed ? (
          <SkillEditor content={parsed.body} key={editorKey} onSave={saveBody} saving={saving} skillName={skill.name} />
        ) : null}
      </section>
    </div>
  )
}

export function PersonalSkillsPage({ fixedConnection, fixedProfile, onOpenSession, ...props }: PersonalSkillsPageProps) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const scope = useCapabilityScope({ fixedConnection, fixedProfile })

  const profileScopes = useMemo(() => {
    const options = scope.options.map(option => scopeFromOption(option.value))

    return options.length > 0 ? options : [scope.profile]
  }, [scope.options, scope.profile])

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
  const [selectedKey, setSelectedKey] = useState<string | null>(selectedFromUrl)

  const selected =
    skills.find(item => item.key === selectedKey) ??
    skills.find(item => item.skill.name === selectedKey) ??
    skills[0]

  const selectedIndex = selected ? skills.findIndex(item => item.key === selected.key) : -1
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const next =
      selectedFromUrl && skills.some(item => item.key === selectedFromUrl || item.skill.name === selectedFromUrl)
        ? selectedFromUrl
        : skills[0]?.key ?? null

    setSelectedKey(current => (current === next ? current : next))
  }, [selectedFromUrl, skills])

  useEffect(() => {
    if (selected?.key && selected.key !== searchParams.get('skill')) {
      setSearchParams(current => {
        const next = new URLSearchParams(current)
        next.set('skill', selected.key)

        return next
      }, { replace: true })
    }
  }, [searchParams, selected?.key, setSearchParams])

  const selectSkill = useCallback(
    (key: string) => {
      setSelectedKey(key)
      setSearchParams(current => {
        const next = new URLSearchParams(current)
        next.set('skill', key)

        return next
      }, { replace: true })
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

  const saveContent = useCallback(
    async (next: string) => {
      if (!selected) {
        return
      }

      setSaving(true)

      try {
        const result = await editLearningNode(selected.skill.name, next, selected.profile)

        if (!result.ok) {
          throw new Error(result.message)
        }

        queryClient.setQueryData(
          [...CONTENT_KEY, selected.skill.name, profileScopeKey(selected.profile)],
          (current: { content: string; name: string; path: string } | undefined) =>
            current ? { ...current, content: next } : current
        )
        void queryClient.invalidateQueries({ queryKey: skillsQueryKey(selected.profile), exact: true })
        notify({ kind: 'success', title: t.skills.skillUpdated, message: t.skills.appliesToNewSessions(selected.skill.name) })
      } catch (error) {
        notifyError(error, t.skills.failedToUpdate(selected.skill.name))
        throw error
      } finally {
        setSaving(false)
      }
    },
    [queryClient, selected, t]
  )

  const launchSession = useCallback(() => {
    if (!selected) {
      return
    }

    const prompt = skillPrompt(selected.skill)

    if (onOpenSession) {
      onOpenSession({ profile: selected.profile, prompt, skill: selected.skill })

      return
    }

    if (!launchPersonalSkillSession({ profile: selected.profile, prompt, skill: selected.skill })) {
      notifyError(new Error(t.skills.openSession), t.skills.openSession)
    }
  }, [onOpenSession, selected, t])

  const pending = profileQueries.some(query => query.isPending)
  const failed = profileQueries.length > 0 && profileQueries.every(query => query.isError)
  const empty = !pending && skills.length === 0

  return (
    <section {...props} className={cn('personal-skills-page flex h-full min-h-0 flex-col', props.className)}>
      <header className="personal-skills-header flex shrink-0 items-center gap-2 px-3">
        <Codicon className="text-(--linear-text-tertiary)" name="book" size="1rem" />
        <h1 className="text-[0.9375rem] font-medium text-(--linear-text-primary)">{t.skills.personalPageTitle}</h1>
        <span className="text-xs text-(--linear-text-tertiary)">{t.skills.personal}</span>
        <span className="ml-auto text-xs text-(--linear-text-tertiary)">{skills.length}</span>
      </header>
      <div className="personal-skills-body min-h-0 flex-1">
        <aside className="personal-skills-sidebar flex min-h-0 flex-col gap-2">
          <div className="flex items-center justify-between px-1 text-[0.6875rem] font-medium uppercase tracking-[0.04em] text-(--linear-text-tertiary)">
            <span>{t.skills.personal}</span>
            <span>{t.skills.keyboardHint}</span>
          </div>
          <div className="personal-skills-list flex-1 space-y-0.5">
            {pending ? (
              <PageLoader className="h-32" label={t.skills.loading} />
            ) : failed ? (
              <p className="px-2 py-3 text-xs text-(--linear-red)">{t.skills.skillsLoadFailed}</p>
            ) : empty ? (
              <p className="px-2 py-3 text-xs leading-5 text-(--linear-text-tertiary)">{t.skills.personalEmpty}</p>
            ) : (
              skills.map(skill => (
                <SkillRow
                  key={skill.key}
                  onClick={() => selectSkill(skill.key)}
                  owner={scopeProfileName(skill.profile)}
                  selected={skill.key === selected?.key}
                  skill={skill.skill}
                />
              ))
            )}
          </div>
        </aside>
        <main className="personal-skills-detail">
          {selected ? (
            <SkillDetail
              content={contentQuery.data?.content}
              editorKey={selected.key}
              error={contentQuery.error}
              loading={contentQuery.isPending}
              onOpenSession={launchSession}
              onSave={saveContent}
              saving={saving}
              skill={selected.skill}
              t={t}
            />
          ) : (
            <div className="grid h-full min-h-56 place-items-center px-8 text-sm text-(--linear-text-tertiary)">{t.skills.personalEmpty}</div>
          )}
        </main>
      </div>
    </section>
  )
}

/** Route/tile name used by the workspace shell. */
export const PersonalSkillsView = PersonalSkillsPage

export default PersonalSkillsPage

