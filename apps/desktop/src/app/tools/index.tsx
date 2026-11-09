import type * as React from 'react'
import { useCallback, useMemo, useState } from 'react'

import { PageLoader } from '@/components/page-loader'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { queryClient } from '@/lib/query-client'
import { invalidateSlashCompletions } from '@/lib/slash-completion-cache'

import { type CapabilityScope, CapabilityScopeSelector, useCapabilityScope } from '../capabilities/scope-selector'
import { refreshToolCalls } from '../capabilities/toolsets/tool-calls'
import {
  TOOLSETS_QUERY_KEY,
  toolsetSearchTerms,
  useToolsetsQuery,
  visibleToolsetCount
} from '../capabilities/toolsets/toolsets-data'
import { ToolsetsTab } from '../capabilities/toolsets/toolsets-tab'
import { useRefreshHotkey } from '../hooks/use-refresh-hotkey'
import { PanelEmpty } from '../overlays/panel'
import { PageSearchShell } from '../page-search-shell'

function scopeDisplayName(scope: CapabilityScope): string {
  if (scope.label) {
    return scope.label
  }

  if (typeof scope.profile === 'string' && scope.profile) {
    return scope.profile
  }

  if (scope.profile && typeof scope.profile === 'object') {
    return `${scope.profile.profile || 'default'} — ${scope.profile.connectionId || 'local'}`
  }

  return 'default'
}

/**
 * The standalone Tools page.
 *
 * ToolsetsTab remains the single owner of tool actions and configuration
 * dialogs. This page only supplies the page chrome and the gateway/profile
 * scope, so every read and write keeps using the existing profile-aware API.
 */
export function ToolsView(props: React.ComponentProps<'section'>) {
  const { t } = useI18n()
  const scope = useCapabilityScope({})
  const [query, setQuery] = useState('')
  const { data: toolsets, error, isError } = useToolsetsQuery(scope.profile)

  const refreshTools = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: TOOLSETS_QUERY_KEY })
    invalidateSlashCompletions()
    await refreshToolCalls(scope.profile)
  }, [scope.profile])

  useRefreshHotkey(refreshTools)

  const count = toolsets ? visibleToolsetCount(toolsets) : null
  const loading = !toolsets && !isError

  const searchHints = useMemo(
    () => (toolsets?.length ? toolsetSearchTerms(toolsets).map(term => t.common.tryHint(term)) : undefined),
    [t, toolsets]
  )

  const content = isError ? (
    <PanelEmpty
      action={
        <Button onClick={() => void refreshTools()} size="sm">
          {t.common.retry}
        </Button>
      }
      description={error instanceof Error ? error.message : undefined}
      icon="error"
      title={t.skills.toolsetsRefreshFailed}
    />
  ) : loading ? (
    <PageLoader label={t.skills.loading} />
  ) : (
    <ToolsetsTab
      hints={searchHints}
      onQueryChange={setQuery}
      profile={scope.profile}
      query={query}
      toolsets={toolsets ?? []}
    />
  )

  return (
    <PageSearchShell {...props} aria-label={t.skills.tabToolsets} searchHidden>
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b-[0.5px] border-(--linear-border-primary) pr-3 pl-2">
          <h1 className="truncate text-sm font-medium text-(--linear-text-primary)">{t.skills.tabToolsets}</h1>
          {count !== null && <span className="text-xs tabular-nums text-(--linear-text-tertiary)">{count}</span>}
        </header>
        {scope.options.length <= 1 && (
          <div className="flex h-8 shrink-0 items-center gap-1.5 border-b-[0.5px] border-(--linear-border-primary) px-2 text-xs">
            <span className="text-(--linear-text-tertiary)">{t.skills.configuringProfile}</span>
            <span className="truncate text-(--linear-text-secondary)">{scopeDisplayName(scope)}</span>
          </div>
        )}
        <CapabilityScopeSelector scope={scope} />
        <div className="flex min-h-0 flex-1 flex-col">{content}</div>
      </div>
    </PageSearchShell>
  )
}
