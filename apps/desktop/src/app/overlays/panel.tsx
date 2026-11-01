import type { ReactNode } from 'react'

import { ActionsContextMenu, ActionsMenu, type MenuKit, renderActionItem } from '@/components/ui/actions-menu'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { RowButton } from '@/components/ui/row-button'
import { SearchField } from '@/components/ui/search-field'
import { Tip } from '@/components/ui/tooltip'
import { translateNow } from '@/i18n'
import { cn } from '@/lib/utils'

import { OVERLAY_PANEL_SURFACE, OverlayView } from './overlay-view'

// Overlay "panel" primitive — the Linear content panel shared by every
// non-settings overlay (profiles, webhooks, …): Linear's 13px type scale,
// 28px nav rows on the sidebar fills, a Properties-style key/value grid and
// NO container borders (rows separate via fills + gaps).
//
// Compose it as:
//   <Panel onClose>
//     <PanelHeader title subtitle actions={…} />
//     <PanelBody>                 // master/detail row
//       <PanelList>…</PanelList>
//       <PanelDetail>…</PanelDetail>
//     </PanelBody>
//   </Panel>
//
// Single-column views drop their content straight after the header.

interface PanelProps {
  children: ReactNode
  // Root layout override.
  className?: string
  closeLabel?: string
  contentClassName?: string
  onClose: () => void
}

export function Panel({
  children,
  className,
  closeLabel = translateNow('common.close'),
  contentClassName,
  onClose
}: PanelProps) {
  return (
    <OverlayView
      closeLabel={closeLabel}
      contentClassName={cn('mx-2 mb-2 px-4 pb-4 sm:px-5', OVERLAY_PANEL_SURFACE, contentClassName)}
      onClose={onClose}
      rootClassName={cn('flex h-full w-full flex-col', className)}
    >
      {children}
    </OverlayView>
  )
}

interface PanelHeaderProps {
  // Right-aligned controls (search, "+ New", segmented control, …).
  actions?: ReactNode
  subtitle?: ReactNode
  title: ReactNode
}

export function PanelHeader({ actions, subtitle, title }: PanelHeaderProps) {
  return (
    // Linear's page header: 44px, hairline across the whole panel; 13px/500
    // title, 12px tertiary count beside it.
    <header className="-mx-4 mb-3 flex h-11 shrink-0 items-center justify-between gap-3 border-b-[0.5px] border-(--linear-border-primary) px-4 sm:-mx-5 sm:px-5">
      <div className="flex min-w-0 items-baseline gap-2">
        <h2 className="shrink-0 text-[0.8125rem] font-medium text-(--linear-text-primary)">{title}</h2>
        {subtitle ? <p className="truncate text-xs font-[450] text-(--linear-text-tertiary)">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </header>
  )
}

export function PanelBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        // Side-by-side master/detail on a wide card; once it narrows (same
        // threshold the other overlays collapse at) stack the list above the
        // detail so the detail keeps full width instead of being squished.
        'flex min-h-0 flex-1 flex-col gap-4 overflow-hidden min-[47.5rem]:flex-row min-[47.5rem]:gap-5',
        className
      )}
    >
      {children}
    </div>
  )
}

interface PanelListProps {
  children: ReactNode
  className?: string
  // Pass an onSearchChange to bake a full-bleed filter field in above the items
  // (pinned; the rows scroll under it). Controlled via searchValue.
  onSearchChange?: (value: string) => void
  searchLabel?: string
  searchPlaceholder?: string
  /** Data-derived rotating placeholder nudges (see SearchField.hints). */
  searchHints?: string[]
  searchValue?: string
}

// Left master list. Dense + borderless, like the trace waterfall's label tree:
// single-line rows that touch, separated from the detail only by the body gap.
// An optional search field pins to the top, full-bleed, above the scroll.
export function PanelList({
  children,
  className,
  onSearchChange,
  searchLabel,
  searchPlaceholder,
  searchHints,
  searchValue
}: PanelListProps) {
  return (
    // Full-width and height-capped when stacked (narrow); a fixed 13rem rail
    // beside the detail when wide.
    <div className={cn('flex w-full shrink-0 flex-col max-[47.5rem]:max-h-[40%] min-[47.5rem]:w-52', className)}>
      {onSearchChange ? (
        <SearchField
          aria-label={searchLabel ?? searchPlaceholder ?? ''}
          containerClassName="mb-2 w-full shrink-0"
          hints={searchHints}
          onChange={onSearchChange}
          placeholder={searchPlaceholder ?? ''}
          value={searchValue ?? ''}
          variant="box"
        />
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">{children}</div>
    </div>
  )
}

interface PanelListRowProps {
  active: boolean
  // Leading status dot color class (e.g. 'bg-(--linear-green)'); omit for none.
  dotClassName?: string
  // Leading codicon glyph name (used when there's no lead/dot).
  icon?: string
  // Custom leading element (colored swatch, avatar, …). Wins over dot/icon.
  lead?: ReactNode
  // Per-row actions. Pass `menuItems` to get BOTH the hover kebab and a matching
  // right-click menu from one array (preferred). `menu` takes a raw node for the
  // rare custom trigger; it gets no right-click parity.
  menu?: ReactNode
  menuItems?: PanelMenuItem[]
  // aria/tooltip label for the kebab + right-click menu built from `menuItems`.
  menuLabel?: string
  // Short always-visible trailing meta (a tag/time, like the trace label's duration).
  meta?: ReactNode
  onSelect: () => void
  rowKey?: string
  title: ReactNode
}

// A row is a container (not a <button>) so it can host both the select target
// and a kebab menu without nesting interactive elements. Hover/active bg lives
// on the wrapper so the whole row highlights as one. When `menuItems` is passed,
// the whole row also answers right-click with the same actions as its kebab.
export function PanelListRow({
  active,
  dotClassName,
  icon,
  lead,
  menu,
  menuItems,
  menuLabel,
  meta,
  onSelect,
  rowKey,
  title
}: PanelListRowProps) {
  const row = (
    <div
      className={cn(
        // Linear's list row: 44px, radius 8, 13px/500 primary; rows touch.
        'group/row relative flex h-11 w-full shrink-0 items-center rounded-(--linear-radius-control) text-[0.8125rem] font-medium text-(--linear-text-primary) transition-colors duration-(--linear-speed-quick) hover:transition-none',
        active ? 'bg-(--linear-active-sidebar)' : 'hover:bg-(--linear-hover-row)'
      )}
      data-panel-row={rowKey}
    >
      <RowButton
        className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-(--linear-radius-control) pl-2 pr-1 text-left"
        onClick={onSelect}
      >
        {lead ??
          (dotClassName ? (
            <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', dotClassName)} />
          ) : icon ? (
            <Codicon className="shrink-0 text-(--linear-icon) opacity-80" name={icon} size="0.875rem" />
          ) : null)}
        <span className="min-w-0 flex-1 truncate">{title}</span>
      </RowButton>
      {meta ? (
        <span className="shrink-0 pr-2 text-[0.6875rem] font-[450] tabular-nums text-(--linear-text-tertiary)">
          {meta}
        </span>
      ) : null}
      {menuItems ? (
        <div className="shrink-0 pr-1">
          <PanelRowMenu items={menuItems} label={menuLabel} />
        </div>
      ) : menu ? (
        <div className="shrink-0 pr-1">{menu}</div>
      ) : null}
    </div>
  )

  // Right-click parity: same items as the kebab. `disabled` (no actionable
  // items) renders the row bare.
  return menuItems ? (
    <ActionsContextMenu
      ariaLabel={menuLabel}
      contentClassName="w-40"
      disabled={menuItems.length === 0}
      items={renderPanelMenuItems(menuItems)}
    >
      {row}
    </ActionsContextMenu>
  ) : (
    row
  )
}

export interface PanelMenuItem {
  disabled?: boolean
  icon?: string
  label: string
  onSelect: () => void
  tone?: 'danger' | 'default'
}

// Bridge PanelMenuItem[] → the shared actions-menu render fn, so a panel row's
// kebab and its right-click menu render from one source.
function renderPanelMenuItems(items: PanelMenuItem[]) {
  return (kit: MenuKit) =>
    items.map(item =>
      renderActionItem(kit, {
        disabled: item.disabled,
        icon: item.icon,
        key: item.label,
        label: item.label,
        onSelect: item.onSelect,
        variant: item.tone === 'danger' ? 'destructive' : 'default'
      })
    )
}

// Per-row "⋮" actions menu — Linear's 24px ghost icon button + kebab-vertical
// codicon + w-40 content. Hidden until
// the row is hovered/focused (or the menu is open). Returns null with no items
// (e.g. the default profile, which can't be renamed/deleted).
export function PanelRowMenu({ items, label = 'Actions' }: { items: PanelMenuItem[]; label?: string }) {
  if (items.length === 0) {
    return null
  }

  return (
    <ActionsMenu ariaLabel={label} contentClassName="w-40" items={renderPanelMenuItems(items)}>
      <Button
        aria-label={label}
        className="opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100 data-[state=open]:bg-(--linear-hover-control) data-[state=open]:text-(--linear-text-primary) data-[state=open]:opacity-100"
        size="icon-xs"
        variant="ghost"
      >
        <Codicon name="kebab-vertical" size="0.875rem" />
      </Button>
    </ActionsMenu>
  )
}

// Scrolling detail region. Fills the column (no right rail here, unlike the
// trace inspector), so the content stretches the full available width.
export function PanelDetail({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain', className)}>
      <div className="space-y-6 pb-6 pl-1 pr-2">{children}</div>
    </div>
  )
}

interface PanelEmptyProps {
  action?: ReactNode
  description?: ReactNode
  // Codicon glyph name (e.g. 'hubot', 'warning', 'loading~spin').
  icon?: string
  title?: ReactNode
}

export function PanelEmpty({ action, description, icon = 'inbox', title }: PanelEmptyProps) {
  return (
    <div className="grid flex-1 place-items-center px-6 py-10 text-center">
      <div className="flex flex-col items-center gap-2">
        <Codicon className="text-(--linear-text-quaternary)" name={icon} size="1.25rem" />
        {title ? <p className="text-[0.8125rem] font-medium text-(--linear-text-primary)">{title}</p> : null}
        {description ? (
          <p className="max-w-sm text-xs font-[450] leading-relaxed text-(--linear-text-tertiary)">{description}</p>
        ) : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </div>
  )
}

// Inline failure notice (load errors, last-run failures): a faint red wash at
// the control radius with red ink. Callers add padding and layout.
export const PANEL_ERROR_NOTICE =
  'rounded-(--linear-radius-control) bg-[color-mix(in_srgb,var(--linear-red)_8%,transparent)] text-(--linear-red)'

// Detail title — Linear's issue title: 24px/600, -0.1px tracking.
// `as` keeps the caller's heading level (h3 under a panel header by default).
export function PanelTitle({ as: Heading = 'h3', children }: { as?: 'h2' | 'h3'; children: ReactNode }) {
  return (
    <Heading className="text-[1.5rem] leading-8 font-medium tracking-[-0.16px] break-words text-(--linear-text-primary)">
      {children}
    </Heading>
  )
}

export function PanelSectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    // Linear's section header: 12px/500 tertiary on a 28px line.
    <div className={cn('flex min-h-7 items-center text-xs font-medium text-(--linear-text-tertiary)', className)}>
      {children}
    </div>
  )
}

// Key/value grid in the shape of Linear's issue Properties panel: 32px rows,
// tertiary 13px label, primary 13px value.
export interface PanelMetaRow {
  label: ReactNode
  value: ReactNode
}

export function PanelMeta({ className, rows }: { className?: string; rows: PanelMetaRow[] }) {
  return (
    <dl className={cn('grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 text-[0.8125rem] leading-5 font-[450]', className)}>
      {rows.map((row, i) => (
        <div className="contents" key={typeof row.label === 'string' ? row.label : i}>
          <dt className="min-h-8 truncate py-1.5 text-(--linear-text-tertiary)">{row.label}</dt>
          <dd className="min-h-8 min-w-0 break-words py-1.5 text-(--linear-text-primary)">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

// Monospace content block (job prompt, etc.): no fill, a hairline frame at the
// control radius, 12px mono in the secondary ink.
export function PanelBlock({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <pre
      className={cn(
        'max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-(--linear-radius-control) border-[0.5px] border-(--linear-border-secondary) px-3 py-2.5 font-mono text-xs leading-5 text-(--linear-text-secondary)',
        className
      )}
    >
      {children}
    </pre>
  )
}

export type PanelPillTone = 'bad' | 'good' | 'muted' | 'warn'

const PILL_VARIANT: Record<PanelPillTone, NonNullable<BadgeProps['variant']>> = {
  bad: 'destructive',
  good: 'success',
  muted: 'muted',
  warn: 'warn'
}

// State tag — the shared Badge, tone mapped onto its status variants.
export function PanelPill({ children, tone = 'muted' }: { children: ReactNode; tone?: PanelPillTone }) {
  return (
    <Badge className="capitalize" variant={PILL_VARIANT[tone]}>
      {children}
    </Badge>
  )
}

// Self-describing centered "+" that sits as the LAST item in a PanelList. The
// label rides aria/title only — no visible text.
export function PanelAddButton({
  icon = 'add',
  label,
  onClick
}: {
  icon?: string
  label: string
  onClick: () => void
}) {
  return (
    <Tip label={label}>
      <Button aria-label={label} className="w-full" onClick={onClick} variant="ghost">
        <Codicon name={icon} size="0.875rem" />
      </Button>
    </Tip>
  )
}

// Visible action for a detail header (cron pause/resume/trigger, …). Linear's
// toolbar button by default; `primary` promotes the main action to the accent.
export function PanelAction({
  children,
  disabled,
  icon,
  onClick,
  primary,
  spinning
}: {
  children: ReactNode
  disabled?: boolean
  icon: string
  onClick: () => void
  primary?: boolean
  spinning?: boolean
}) {
  return (
    <Button
      aria-busy={spinning || undefined}
      disabled={disabled}
      onClick={onClick}
      variant={primary ? 'default' : 'secondary'}
    >
      <Codicon name={icon} size="0.875rem" spinning={spinning} />
      {children}
    </Button>
  )
}
