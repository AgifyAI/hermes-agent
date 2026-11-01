import { Button, Codicon, DisclosureCaret, GlyphSpinner, PanelEmpty, RowButton } from '@hermes/plugin-sdk'
import type { ReactNode, RefObject } from 'react'

import type { useRoster } from './data'
import { $showHiddenBots } from './hidden-bots'
import type { useBots } from './i18n'
import type { deriveRosterPresentation, deriveRosterRows } from './roster-pane-derivation'
import type { rosterSectionRenderers } from './roster-pane-sections'
import type { rosterGatewayOptions } from './roster-sections'
import type { RosterRow } from './types'

interface RosterContentProps {
  b: ReturnType<typeof useBots>
  staleNotice: string | number | null
  isLoading: boolean
  initialRosterLoading: boolean
  roster: RosterRow[]
  error: ReturnType<typeof useRoster>['error']
  gatewayUp: boolean
  refetch: ReturnType<typeof useRoster>['refetch']
  allBotsHidden: boolean
  hiddenExpanded: boolean
  rosterRows: ReturnType<typeof deriveRosterRows>['rosterRows']
  matchingHiddenBots: RosterRow[]
  query: string
  selectedGateway: ReturnType<typeof rosterGatewayOptions>[number] | undefined
  showGatewaySections: boolean
  sortedGroupRows: ReturnType<typeof deriveRosterRows>['sortedGroupRows']
  gatewaySections: ReturnType<typeof deriveRosterRows>['gatewaySections']
  showHiddenSection: boolean
  hiddenSectionRef: RefObject<HTMLDivElement | null>
  hasRosterConstraint: boolean
  hiddenBots: RosterRow[]
  showHiddenRows: boolean
  hiddenGatewaySections: ReturnType<typeof deriveRosterPresentation>['hiddenGatewaySections']
  renderBotRow: (bot: RosterRow, keyPrefix?: string) => ReactNode
  renderGroupChatSection: ReturnType<typeof rosterSectionRenderers>['renderGroupChatSection']
  renderGatewaySection: ReturnType<typeof rosterSectionRenderers>['renderGatewaySection']
  renderUserSections: ReturnType<typeof rosterSectionRenderers>['renderUserSections']
  renderHiddenGatewaySection: ReturnType<typeof rosterSectionRenderers>['renderHiddenGatewaySection']
}

export function renderRosterContent({
  b,
  staleNotice,
  isLoading,
  initialRosterLoading,
  roster,
  error,
  gatewayUp,
  refetch,
  allBotsHidden,
  hiddenExpanded,
  rosterRows,
  matchingHiddenBots,
  query,
  selectedGateway,
  showGatewaySections,
  sortedGroupRows,
  gatewaySections,
  showHiddenSection,
  hiddenSectionRef,
  hasRosterConstraint,
  hiddenBots,
  showHiddenRows,
  hiddenGatewaySections,
  renderBotRow,
  renderGroupChatSection,
  renderGatewaySection,
  renderUserSections,
  renderHiddenGatewaySection
}: RosterContentProps) {
  return (
    <>
      {staleNotice ? (
        <div className="mx-2.5 mb-1 rounded-md bg-(--linear-hover-control) px-2 py-1.5 text-[0.6875rem] font-[450] text-(--linear-text-tertiary)">
          {staleNotice}
        </div>
      ) : null}
      {(isLoading || initialRosterLoading) && !roster.length ? (
        <div className="flex flex-1 items-center justify-center">
          <GlyphSpinner className="text-(--linear-text-tertiary)" spinner="breathe" />
        </div>
      ) : error && !roster.length ? (
        <div className="grid gap-2 px-3 py-4 text-xs font-[450] text-(--linear-text-tertiary)">
          <div>
            {gatewayUp
              ? b.roster.rosterUnavailable(error instanceof Error ? error.message : 'gateway error')
              : b.roster.waitingForGateway}
          </div>
          <Button className="justify-self-start" onClick={() => void refetch()} size="sm" variant="secondary">
            {b.roster.retryNow}
          </Button>
        </div>
      ) : roster.length === 0 ? (
        <PanelEmpty description={b.roster.emptyDesc} icon="hubot" title={b.roster.emptyTitle} />
      ) : allBotsHidden && !hiddenExpanded ? (
        <div className="grid content-start gap-2 px-3 py-4 text-xs font-[450] text-(--linear-text-tertiary)">
          <div className="flex items-center gap-1.5 font-medium text-(--linear-text-secondary)">
            <Codicon className="text-(--linear-text-quaternary)" name="eye-closed" />
            {b.roster.allHidden}
          </div>
          <p className="leading-relaxed">{b.roster.allHiddenDesc}</p>
          <Button
            className="justify-self-start"
            onClick={() => $showHiddenBots.set(true)}
            size="sm"
            variant="secondary"
          >
            {b.roster.showHidden}
          </Button>
        </div>
      ) : rosterRows.length === 0 && matchingHiddenBots.length === 0 ? (
        <div aria-live="polite" className="flex min-h-0 flex-1 flex-col" role="status">
          <PanelEmpty
            description={
              query.trim()
                ? selectedGateway
                  ? b.roster.noMatchQueryOn(query.trim(), String(selectedGateway.label))
                  : b.roster.noMatchQuery(query.trim())
                : selectedGateway
                  ? b.roster.noMatchFiltersOn(String(selectedGateway.label))
                  : b.roster.noMatchFilters
            }
            icon="search"
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-slot="bots-roster">
          <div className="grid w-full min-w-0 gap-0.5 px-1.5 pb-2">
            {showGatewaySections
              ? [
                  sortedGroupRows.length ? renderGroupChatSection() : null,
                  ...gatewaySections.sections.map(renderGatewaySection)
                ].filter(Boolean)
              : renderUserSections(rosterRows)}
            {showHiddenSection ? (
              <div
                className="mt-1 border-t-[0.5px] border-(--linear-border-panel) pt-1"
                key={'hidden-section'}
                ref={hiddenSectionRef}
              >
                {hasRosterConstraint ? (
                  <div className="flex w-full items-center gap-1 px-2 py-1.5 text-[0.6875rem] font-medium text-(--linear-text-tertiary)">
                    <Codicon name="eye-closed" />
                    <span>Hidden</span>
                    <span className="text-(--linear-text-quaternary)">{matchingHiddenBots.length}</span>
                  </div>
                ) : (
                  <RowButton
                    aria-expanded={hiddenExpanded}
                    className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-[0.6875rem] font-medium text-(--linear-text-tertiary) transition-colors hover:bg-(--linear-hover-control) hover:text-(--linear-text-primary)"
                    onClick={() => $showHiddenBots.set(!hiddenExpanded)}
                  >
                    <DisclosureCaret open={hiddenExpanded} />
                    <span>Hidden</span>
                    <span className="text-(--linear-text-quaternary)">{hiddenBots.length}</span>
                  </RowButton>
                )}
                {showHiddenRows ? (
                  matchingHiddenBots.length ? (
                    hiddenGatewaySections.sectioned ? (
                      hiddenGatewaySections.sections.map(renderHiddenGatewaySection)
                    ) : (
                      matchingHiddenBots.map((bot: RosterRow) => renderBotRow(bot, 'hidden:'))
                    )
                  ) : (
                    <div className="px-2 py-2 text-xs font-[450] text-(--linear-text-quaternary)">{b.roster.noHiddenMatch}</div>
                  )
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </>
  )
}
