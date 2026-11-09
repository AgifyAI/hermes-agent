import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router'

import { Codicon } from '@/components/ui/codicon'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu'
import { KbdGroup } from '@/components/ui/kbd'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from '@/components/ui/sidebar'
import { TipKeybindLabel } from '@/components/ui/tooltip'
import { useContributions } from '@/contrib/react/use-contributions'
import { useI18n } from '@/i18n'
import { comboTokens } from '@/lib/keybinds/combo'
import { cn } from '@/lib/utils'
import { recordAction } from '@/store/desktop-metrics'
import { $interfaceMode, shownInMode } from '@/store/interface-mode'
import { $bindings } from '@/store/keybinds'
import { $newChatProfile } from '@/store/profile'
import { openRouteTile } from '@/store/route-tiles'
import { applySidebarNavPrefs, SIDEBAR_NAV_PREFS_AREA } from '@/store/sidebar-nav'

import {
  type AppView,
  ARTIFACTS_ROUTE,
  CAPABILITIES_ROUTE,
  CRON_ROUTE,
  MESSAGING_ROUTE,
  REVIEW_ROUTE,
  SIDEBAR_NAV_AREA,
  type SidebarNavContribution,
  SKILLS_ROUTE,
  TOOLS_ROUTE
} from '../../routes'
import type { SidebarNavItem } from '../../types'
import { type NewSessionSplitHandler, startNewSessionDrag } from '../new-session-drag'

import { CONTEXT_SPLIT_KIT, SplitSubmenu } from './split-submenu'

// A row's `tier` is the one mode it belongs to (Simple keeps the setup rows,
// Advanced adds the readouts); the list filters once, nothing is passed down.
const SIDEBAR_NAV: SidebarNavItem[] = [
  {
    id: 'new-session',
    label: '',
    icon: props => <Codicon name="robot" {...props} />,
    action: 'new-session',
    keybindActionId: 'session.new'
  },
  {
    id: 'capabilities',
    label: '',
    icon: props => <Codicon name="symbol-misc" {...props} />,
    route: CAPABILITIES_ROUTE,
    keybindActionId: 'nav.capabilities'
  },
  {
    id: 'tools',
    label: 'Tools',
    icon: props => <Codicon name="tools" {...props} />,
    route: TOOLS_ROUTE
  },
  {
    id: 'skills',
    label: 'Skills',
    icon: props => <Codicon name="book" {...props} />,
    route: SKILLS_ROUTE
  },
  {
    id: 'messaging',
    label: '',
    icon: props => <Codicon name="comment" {...props} />,
    route: MESSAGING_ROUTE,
    keybindActionId: 'nav.messaging'
  },
  // Artifacts is an output of running Hermes the developer way; Capabilities
  // and Messaging are how anyone sets it up. Scheduled jobs is a first-class
  // page (jobs are managed there, not in a sidebar section), so it stays
  // visible in both interface modes.
  {
    id: 'artifacts',
    label: '',
    icon: props => <Codicon name="files" {...props} />,
    route: ARTIFACTS_ROUTE,
    keybindActionId: 'nav.artifacts',
    tier: 'advanced'
  },
  {
    id: 'cron',
    label: '',
    icon: props => <Codicon name="watch" {...props} />,
    route: CRON_ROUTE,
    keybindActionId: 'nav.cron'
  },
  {
    id: 'review',
    label: '',
    icon: props => <Codicon name="git-pull-request" {...props} />,
    route: REVIEW_ROUTE
  }
]

// Built-in rows whose id is the view they light up at.
const VIEW_BACKED_ROWS: ReadonlySet<string> = new Set([
  'capabilities',
  'skills',
  'messaging',
  'artifacts',
  'cron',
  'review',
  'tools'
])

function isNavRowActive(item: SidebarNavItem, currentView: AppView, pathname: string) {
  return (
    (VIEW_BACKED_ROWS.has(item.id) && currentView === item.id) ||
    // Contributed rows light up at their own route.
    (currentView === 'extension' && Boolean(item.route) && pathname === item.route)
  )
}

interface SidebarNavSectionProps {
  currentView: AppView
  onNavigate: (item: SidebarNavItem) => void
  onNewSessionSplit: NewSessionSplitHandler
}

interface SidebarNavRowProps extends Omit<SidebarNavSectionProps, 'currentView'> {
  active: boolean
  item: SidebarNavItem
  // The "New session" row's keybind chip; rows without one pass nothing.
  kbd?: { flash: boolean; keys: string[] }
}

function SidebarNavRow({ active, item, kbd, onNavigate, onNewSessionSplit }: SidebarNavRowProps) {
  const { t } = useI18n()
  const s = t.sidebar
  const isInteractive = Boolean(item.action) || Boolean(item.route)
  const isNewSession = item.id === 'new-session'

  const label =
    item.id === 'skills'
      ? t.skills.tabSkills
      : item.id === 'tools'
        ? t.skills.tabToolsets
        : item.id === 'review'
          ? t.statusStack.coding.review
          : (s.nav[item.id] ?? item.label)

  const button = (
    <SidebarMenuButton
      aria-disabled={!isInteractive}
      // Geometry, type and fills come from the primitive. no-drag:
      // these rows sit directly under the titlebar's
      // [-webkit-app-region:drag] strips (app-shell.tsx), with only
      // 6px of clearance. Drag regions win hit-testing over DOM
      // (pointer-events can't override), and on Linux/WSLg the
      // resolved region has been observed to swallow clicks on the
      // top rows. Same carve-out as USER_BUBBLE_BASE_CLASS in
      // thread.tsx.
      className="[-webkit-app-region:no-drag]"
      // A tip anchored to the label points at the end of the
      // word; the row is what it's actually about.
      data-tip-region=""
      isActive={active}
      onClick={() => {
        // A plain new session lands in whatever profile the live
        // gateway is on (= the active switcher context). null →
        // no swap. The switcher header is the single place to
        // change which profile that is.
        if (isNewSession) {
          $newChatProfile.set(null)
        }

        if (item.keybindActionId) {
          recordAction(item.keybindActionId, 'click')
        }

        onNavigate(item)
      }}
      onPointerDown={event => {
        // The "New session" row is a drag source too: drag it onto
        // a chat zone's tab strip / edge / center to create the
        // session exactly there (stack / split). The pointer drag
        // session owns the gesture — a sub-threshold release falls
        // through to the onClick above (ordinary new session), and
        // an engaged drag suppresses that click so it never
        // double-creates. The create callback sets $newChatProfile
        // itself (the suppressed click can't), so a dragged new
        // session lands in the same profile a click would.
        if (!isNewSession) {
          return
        }

        startNewSessionDrag(placement => {
          $newChatProfile.set(null)
          onNewSessionSplit(placement.dir, { anchor: placement.anchor, before: placement.before })
        }, event)
      }}
      tooltip={
        item.keybindActionId ? { children: <TipKeybindLabel actionId={item.keybindActionId} text={label} /> } : label
      }
      type="button"
    >
      {/* Codicons are font glyphs: `!` beats codicon.css's 16px. */}
      <item.icon className="size-3.5 shrink-0 text-[0.875rem]! leading-none" />
      {/* Shrink-to-fit, not flex-1: the label carries the row's
          `data-tour` handle, and anything anchored to it should
          land at the end of the WORD, not out at the sidebar's
          edge. Still truncates — `min-w-0` lets it shrink past
          its content when the rail is narrow — and the trailing
          chip's `ml-auto` was already doing the pushing that
          `flex-1` looked like it was for.
          Its own `sidebar-nav-` namespace: the overlay nav owns
          `nav-<id>`, and both are on screen with Settings open. */}
      <span className="min-w-0 truncate" data-tip-arrow-only="" data-tour={`sidebar-nav-${item.id}`}>
        {label}
      </span>
      {kbd && <KbdGroup className={cn('ml-auto opacity-55', kbd.flash && 'opacity-100!')} keys={kbd.keys} size="sm" />}
    </SidebarMenuButton>
  )

  // New session + route-backed pages can open in a split —
  // right-click for the directional "Open in split" submenu.
  return (
    <SidebarMenuItem>
      {isNewSession || item.route ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>{button}</ContextMenuTrigger>
          <ContextMenuContent aria-label={label}>
            <SplitSubmenu
              kit={CONTEXT_SPLIT_KIT}
              label={s.row.openInSplit}
              onSplit={dir => {
                if (isNewSession) {
                  onNewSessionSplit(dir)
                } else if (item.route) {
                  openRouteTile(item.route, dir)
                }
              }}
            />
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        button
      )}
    </SidebarMenuItem>
  )
}

export function SidebarNavSection({ currentView, onNavigate, onNewSessionSplit }: SidebarNavSectionProps) {
  const { pathname } = useLocation()
  // Contributed nav rows (plugins pairing a page with a sidebar entry) render
  // below the built-ins with the same chrome; active = at their route.
  const navContributions = useContributions(SIDEBAR_NAV_AREA)

  const contributedNav = useMemo<SidebarNavItem[]>(
    () =>
      navContributions.flatMap(c => {
        const data = c.data as Partial<SidebarNavContribution> | undefined

        if (!data?.path?.startsWith('/') || !data.label) {
          return []
        }

        const codicon = data.codicon || 'plug'

        return [
          {
            id: c.id,
            label: data.label,
            icon: (props: { className?: string }) => <Codicon name={codicon} {...props} />,
            route: data.path,
            tier: data.tier
          }
        ]
      }),
    [navContributions]
  )

  const interfaceMode = useStore($interfaceMode)

  // Nav preferences (`sidebarNav.prefs` contributions): a plugin may hide rows
  // or re-order them. Merged here, at render, from the registry — so the
  // preference never mutates the default list, and a plugin's disable/reload
  // disposes its contribution and the rows come straight back.
  const navPrefs = useContributions(SIDEBAR_NAV_PREFS_AREA)

  const navItems = useMemo(
    () => applySidebarNavPrefs([...SIDEBAR_NAV, ...contributedNav].filter(shownInMode(interfaceMode)), navPrefs),
    [contributedNav, interfaceMode, navPrefs]
  )

  const newSessionCombo = useStore($bindings)['session.new']?.[0]
  const newSessionKbd = newSessionCombo ? comboTokens(newSessionCombo) : []
  const [newSessionKbdFlash, setNewSessionKbdFlash] = useState(false)

  // Flash the ⌘N hint full-opacity (no transition) for the press, so hitting
  // the shortcut visibly pings its affordance in the sidebar.
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined

    const onShortcut = () => {
      setNewSessionKbdFlash(true)
      clearTimeout(timeout)
      timeout = setTimeout(() => setNewSessionKbdFlash(false), 140)
    }

    window.addEventListener('hermes:new-session-shortcut', onShortcut)

    return () => {
      window.removeEventListener('hermes:new-session-shortcut', onShortcut)
      clearTimeout(timeout)
    }
  }, [])

  return (
    <SidebarGroup className="shrink-0 p-0 pb-2 pt-[calc(var(--titlebar-height)+0.375rem)]">
      <SidebarGroupContent>
        <SidebarMenu className="gap-px">
          {navItems.map(item => (
            <SidebarNavRow
              active={isNavRowActive(item, currentView, pathname)}
              item={item}
              kbd={item.id === 'new-session' ? { flash: newSessionKbdFlash, keys: newSessionKbd } : undefined}
              key={item.id}
              onNavigate={onNavigate}
              onNewSessionSplit={onNewSessionSplit}
            />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
