import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { MarkdownTextContent } from '@/components/assistant-ui/markdown-text'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Loader } from '@/components/ui/loader'
import { SearchField } from '@/components/ui/search-field'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { setSessionOwnerHint } from '@/store/session'
import type { SessionOwnerRoute } from '@/store/session-request-router'

import { OVERLAY_PANEL_SURFACE, OverlayView } from '../overlays/overlay-view'
import { PanelEmpty, PanelTitle } from '../overlays/panel'

import { type ForeignImportResult, type ForeignPage, type ForeignPreview, foreignRequest } from './api'

interface SessionImportViewProps {
  owner: SessionOwnerRoute
  onClose: () => void
  onOpenSession: (id: string) => void
}

export function SessionImportView({ owner, onClose, onOpenSession }: SessionImportViewProps) {
  const { t, locale } = useI18n()
  const copy = t.sessionImport
  const queryClient = useQueryClient()
  const [source, setSource] = useState<'all' | 'claude' | 'codex'>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const lifetime = useRef<AbortController | null>(null)
  // eslint-disable-next-line no-restricted-syntax -- lifetime cancellation, not a mirrored reactive value
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller

    return () => controller.abort()
  }, [])
  const scope = [owner.connectionId, owner.profile]

  const sessions = useInfiniteQuery({
    queryKey: ['foreign-sessions', ...scope, source],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      foreignRequest<ForeignPage>(
        owner,
        'list',
        {
          source: source === 'all' ? null : source,
          offset: pageParam
        },
        signal
      ),
    getNextPageParam: page => page.next_offset,
    retry: false
  })

  const rows = [
    ...new Map((sessions.data?.pages.flatMap(page => page.sessions) ?? []).map(row => [row.id, row])).values()
  ]

  const visible = rows.filter(row =>
    `${row.title} ${row.cwd ?? ''} ${row.excerpt}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())
  )

  const current = rows.find(row => row.id === selected)

  const preview = useQuery({
    queryKey: ['foreign-preview', ...scope, selected],
    queryFn: ({ signal }) => foreignRequest<ForeignPreview>(owner, 'preview', { id: selected }, signal),
    enabled: Boolean(current),
    retry: false
  })

  const host = sessions.data?.pages[0]?.host
  const unreadable = sessions.data?.pages.reduce((sum, page) => sum + page.unreadable, 0) ?? 0

  async function continueSession() {
    if (!current || pending) {
      return
    }

    const signal = lifetime.current?.signal
    setPending(true)
    setError('')

    try {
      const result = await foreignRequest<ForeignImportResult>(owner, 'import', { id: current.id }, signal)
      setSessionOwnerHint(result.session_id, owner)
      void queryClient.invalidateQueries({ queryKey: ['foreign-preview', ...scope] })
      void queryClient.invalidateQueries({ queryKey: ['sessions'] })

      if (!signal?.aborted) {
        onOpenSession(result.session_id)
      }
    } catch (cause) {
      if (!signal?.aborted) {
        setError(cause instanceof Error ? cause.message : copy.importError)
      }
    } finally {
      if (!signal?.aborted) {
        setPending(false)
      }
    }
  }

  return (
    <OverlayView
      contentClassName={cn('mx-2 mb-2', OVERLAY_PANEL_SURFACE)}
      onClose={onClose}
      titlebarActions={
        <Button
          aria-label={t.common.refresh}
          disabled={sessions.isFetching}
          onClick={() => {
            void sessions.refetch()

            if (current) {
              void preview.refetch()
            }
          }}
          size="icon-titlebar"
          variant="ghost"
        >
          <Codicon name="refresh" />
        </Button>
      }
    >
      <section aria-label={copy.title} className="session-import flex h-full min-h-0 flex-col">
        {/* Linear's page title: 24px/500 on a 32px line, -0.16px tracking. */}
        <header className="px-8 pt-12 pb-6">
          <h1 className="text-[1.5rem] leading-8 font-medium tracking-[-0.16px] text-(--linear-text-primary)">
            {copy.title}
          </h1>
          <p className="mt-1 text-[0.8125rem] text-(--linear-text-tertiary)">{copy.subtitle}</p>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-medium text-(--linear-text-secondary) [&_.codicon]:text-(--linear-icon)">
            <span className="inline-flex items-center gap-2">
              <Codicon name="device-desktop" />
              {copy.readingFrom} {host ?? copy.connectedComputer}
            </span>
            <span className="inline-flex items-center gap-2">
              <Codicon name="account" />
              {copy.destination} {owner.targetProfile ?? owner.profile}
            </span>
          </div>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(17rem,0.85fr)_minmax(0,1.6fr)] border-t-[0.5px] border-(--linear-border-primary) max-[760px]:grid-cols-1">
          <aside className={cn('flex min-h-0 flex-col bg-(--linear-bg-window)', selected && 'max-[760px]:hidden')}>
            <div className="flex flex-col gap-3 px-5 pt-5 pb-3">
              <SegmentedControl
                onChange={value => {
                  setSource(value)
                  setSelected(null)
                  setError('')
                }}
                options={[
                  { id: 'all', label: copy.all },
                  { id: 'claude', label: 'Claude Code' },
                  { id: 'codex', label: 'Codex' }
                ]}
                value={source}
              />
              {rows.length > 0 && (
                <SearchField
                  aria-label={copy.search}
                  onChange={setSearch}
                  placeholder={copy.search}
                  value={search}
                  variant="box"
                />
              )}
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-5">
              {sessions.isPending && <Loader className="mx-auto my-12" label={copy.scanning} />}
              {sessions.isError && (
                <ErrorState className="p-5" description={copy.scanHelp} title={copy.scanError}>
                  <Button onClick={() => void sessions.refetch()} variant="secondary">
                    {t.common.retry}
                  </Button>
                </ErrorState>
              )}
              {!sessions.isPending && !sessions.isError && visible.length === 0 && (
                <div className="p-5">
                  <EmptyState
                    description={search ? copy.searchHelp : copy.emptyHelp}
                    title={search ? copy.noMatches : copy.empty}
                  />
                </div>
              )}
              {visible.map((row, index) => {
                const date = new Date(row.mtime * 1000).toLocaleDateString(locale, {
                  month: 'short',
                  day: 'numeric'
                })

                const previous = visible[index - 1]

                const newDate =
                  !previous ||
                  new Date(previous.mtime * 1000).toDateString() !== new Date(row.mtime * 1000).toDateString()

                return (
                  <div key={row.id}>
                    {newDate && (
                      <p className="flex min-h-7 items-center px-3 pt-3 text-xs font-medium text-(--linear-text-tertiary)">
                        {date}
                      </p>
                    )}
                    <button
                      aria-pressed={selected === row.id}
                      className={cn(
                        // Linear's list row: 44px, radius 8, 13px/500 title.
                        'flex h-11 w-full cursor-pointer items-center gap-2 rounded-(--linear-radius-control) px-3 text-start transition-colors duration-(--linear-speed-quick) hover:transition-none focus-visible:ring-1 focus-visible:ring-(--linear-focus) focus-visible:outline-none',
                        selected === row.id ? 'bg-(--linear-active-sidebar)' : 'hover:bg-(--linear-hover-row)'
                      )}
                      onClick={() => {
                        setSelected(row.id)
                        setError('')
                      }}
                      type="button"
                    >
                      <Codicon className="shrink-0 text-(--linear-icon)" name="comment-discussion" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.8125rem] leading-4 font-medium text-(--linear-text-primary)">
                          {row.title}
                        </span>
                        <span className="block truncate text-xs leading-4 font-[450] text-(--linear-text-tertiary)">
                          {[row.label, row.cwd || row.excerpt].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs font-[450] text-(--linear-text-tertiary) tabular-nums">
                        {row.turn_count} {copy.messages}
                      </span>
                    </button>
                  </div>
                )
              })}
              {unreadable > 0 && <p className="px-3 py-4 text-xs text-(--linear-text-tertiary)">{copy.skipped}</p>}
              {sessions.hasNextPage && (
                <div className="flex justify-center pt-4">
                  <Button
                    disabled={sessions.isFetchingNextPage}
                    onClick={() => void sessions.fetchNextPage()}
                    variant="text"
                  >
                    {copy.more}
                  </Button>
                </div>
              )}
            </div>
          </aside>
          <main className={cn('flex min-h-0 min-w-0 flex-col', !selected && 'max-[760px]:hidden')}>
            {!current ? (
              <PanelEmpty description={copy.chooseHelp} icon="comment-discussion" title={copy.choose} />
            ) : (
              <>
                <div className="px-8 pb-5 pt-6">
                  <div className="mb-4 hidden max-[760px]:block">
                    <Button onClick={() => setSelected(null)} variant="text">
                      {t.common.back}
                    </Button>
                  </div>
                  <PanelTitle as="h2">{current.title}</PanelTitle>
                  <p className="mt-1 text-xs font-[450] text-(--linear-text-tertiary)">
                    {current.label} · {current.turn_count} {copy.messages}
                  </p>
                </div>
                <div aria-live="polite" className="min-h-0 flex-1 overflow-y-auto px-8 pb-8" key={current.id}>
                  {preview.isPending && <Loader className="mx-auto my-12" label={copy.previewLoading} />}
                  {preview.isError && (
                    <ErrorState description={copy.previewHelp} title={copy.previewError}>
                      <Button onClick={() => void preview.refetch()} variant="secondary">
                        {t.common.retry}
                      </Button>
                    </ErrorState>
                  )}
                  {preview.data && (
                    <div className="max-w-prose space-y-7">
                      {preview.data.truncated && (
                        <p className="text-xs text-(--linear-text-tertiary)">{copy.previewLimit}</p>
                      )}
                      {preview.data.messages.map((message, index) => (
                        <article className="min-w-0" key={index}>
                          <p className="mb-1.5 text-xs font-medium text-(--linear-text-tertiary)">
                            {message.role === 'user' ? copy.you : current.label}
                          </p>
                          {/* Linear's issue description: 15px/450 on 24px, secondary ink. */}
                          <div className="text-[0.9375rem] leading-6 font-[450] wrap-anywhere text-(--linear-text-secondary)">
                            <MarkdownTextContent isRunning={false} previewOnly text={message.content} />
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
                <footer className="flex flex-wrap items-center justify-between gap-4 border-t-[0.5px] border-(--linear-border-primary) px-8 py-4">
                  <p className="max-w-xs text-xs leading-5 font-[450] text-(--linear-text-tertiary)">
                    {preview.data?.already_imported ? copy.snapshot : copy.copyNotice}
                  </p>
                  <Button disabled={pending || !preview.data || preview.isError} onClick={() => void continueSession()}>
                    {pending ? copy.importing : preview.data?.already_imported ? copy.open : copy.continue}
                    <Codicon name="arrow-right" />
                  </Button>
                  {error && (
                    <div className="w-full text-[0.8125rem] text-(--linear-red)" role="alert">
                      {copy.importError} {error}
                    </div>
                  )}
                </footer>
              </>
            )}
          </main>
        </div>
      </section>
    </OverlayView>
  )
}
