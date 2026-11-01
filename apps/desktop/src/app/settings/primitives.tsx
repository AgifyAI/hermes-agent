import type { ComponentProps, ReactNode } from 'react'
import { createContext, useContext } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { triggerHaptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'

import { PAGE_INSET_X } from '../layout-constants'

// The settings shell owns page titles; embedded callers retain their headings.
export const SettingsBreadcrumbContext = createContext(false)

// The page title the settings shell hands its active page. `SettingsContent`
// renders it at the head of the column (Linear's Preferences title) and clears
// it for anything nested, so an embedded page never repeats it.
export const SettingsPageTitleContext = createContext<string | undefined>(undefined)

// Rows inside a card pad all four sides like Linear's; flat rows keep their
// vertical rhythm only.
const SettingsCardContext = createContext(false)

// A `bare` embed (the boot-failure recovery card) is already a card: settings
// cards inside it stay flat instead of nesting one surface in another.
const SettingsFlatContext = createContext(false)

// Linear's settings content column: 640px, centred in the pane.
export const SETTINGS_COLUMN = 'mx-auto w-full max-w-[40rem]'

// `bare` drops the page gutters + tall bottom pad for embedding in a tighter
// surface (e.g. the boot-failure recovery card owns its own padding).
export function SettingsContent({ children, bare = false }: { children: ReactNode; bare?: boolean }) {
  const title = useContext(SettingsPageTitleContext)

  const content = (
    <SettingsPageTitleContext.Provider value={undefined}>
      <div>{children}</div>
    </SettingsPageTitleContext.Provider>
  )

  return (
    <section className="min-h-0 overflow-hidden">
      <div className={cn('h-full min-h-0 overflow-y-auto', bare ? 'px-5 pb-6' : cn('pb-20', PAGE_INSET_X))}>
        <div className={cn(!bare && SETTINGS_COLUMN)}>
          {!bare && title && (
            <h1 className="mb-8 text-[1.5rem] leading-8 font-medium tracking-[-0.01rem] text-(--linear-text-primary)">
              {title}
            </h1>
          )}
          {bare ? <SettingsFlatContext.Provider value>{content}</SettingsFlatContext.Provider> : content}
        </div>
      </div>
    </section>
  )
}

// A warning sitting among settings rows: orange hairline over a faint orange wash.
export const WARN_NOTICE_CLASS =
  'rounded-(--linear-radius-control) border-[0.5px] border-(--linear-orange) bg-[color-mix(in_srgb,var(--linear-orange)_12%,transparent)]'

// Linear's settings card: one rounded surface per group of rows, rows split by
// an inset hairline. Margins collapse in the page's block flow, so a card sits
// 16px under its section title and 16px under a previous card. The hairline
// goes on every rendered row after the first, so a slot that renders nothing
// (an empty wrapper, a hidden input) never doubles or strands a line.
const CARD_SEPARATOR =
  '[&>:not(:empty)~:not(:empty)]:border-t-[0.5px] [&>:not(:empty)~:not(:empty)]:border-(--linear-border-secondary)'

export function SettingsCard({ children, className }: { children: ReactNode; className?: string }) {
  if (useContext(SettingsFlatContext)) {
    return <div className={className}>{children}</div>
  }

  return (
    <SettingsCardContext.Provider value>
      <div
        className={cn(
          'not-first:mt-4 rounded-(--linear-radius-card) bg-(--linear-bg-card) px-4 shadow-(--linear-shadow-card) empty:hidden',
          CARD_SEPARATOR,
          className
        )}
        data-slot="settings-card"
      >
        {children}
      </div>
    </SettingsCardContext.Provider>
  )
}

const PILL_VARIANT = {
  muted: 'muted',
  primary: 'default',
  success: 'success',
  warn: 'warn',
  destructive: 'destructive'
} as const

// Rest props spread through to the Badge's DOM node — REQUIRED for Radix
// `asChild` composition (wrapping a Pill in `Tip` clones it with the hover
// handlers and ref as props; swallowing them left every tooltip on a Pill
// silently dead).
export function Pill({
  tone = 'muted',
  children,
  ...props
}: { tone?: keyof typeof PILL_VARIANT; children: ReactNode } & Omit<ComponentProps<typeof Badge>, 'variant'>) {
  return (
    <Badge variant={PILL_VARIANT[tone]} {...props}>
      {children}
    </Badge>
  )
}

// Linear's settings section title: 15px/500, inset 16px so it lines up with
// the rows of the card under it, 16px above that card and 48px below the
// previous section (block-flow margins collapse into exactly those gaps).
const SECTION_HEADING_CLASS =
  'not-first:mt-12 mb-4 flex min-h-[1.4375rem] items-center gap-2 px-4 text-[0.9375rem] leading-[1.4375rem] font-medium text-(--linear-text-primary)'

export function SectionHeading({
  aside,
  meta,
  page = false,
  title
}: {
  // Right-aligned trailing content on the heading row (e.g. a compact status +
  // action), so a single-item section needn't repeat its own label as a row.
  aside?: ReactNode
  meta?: string
  page?: boolean
  title: string
}) {
  const hasBreadcrumb = useContext(SettingsBreadcrumbContext)
  const showTitle = !page || !hasBreadcrumb

  if (!showTitle && !aside && !meta) {
    return null
  }

  return (
    <div className={SECTION_HEADING_CLASS}>
      {showTitle && <h2 className="min-w-0 truncate font-medium">{title}</h2>}
      {meta && <Pill>{meta}</Pill>}
      {aside && <div className="ml-auto flex min-w-0 items-center">{aside}</div>}
    </div>
  )
}

// A titled section: heading over one Linear card of rows. `card={false}` keeps
// the body free-form (galleries, plan grids) under the same heading rhythm.
export function SettingsSection({
  aside,
  card = true,
  children,
  meta,
  title
}: {
  aside?: ReactNode
  card?: boolean
  children: ReactNode
  meta?: string
  title: string
}) {
  return (
    <section className="not-first:mt-12">
      <SectionHeading aside={aside} meta={meta} title={title} />
      {card ? <SettingsCard>{children}</SettingsCard> : children}
    </section>
  )
}

// The label/control split every settings-style row keys on. Rows that cannot
// be a ListRow (expandable credential cards, the billing plan card with its
// tier art) still lay out on these exact columns so their controls line up.
// Keyed on the row's own width (`@lg` = 32rem) so a row in the 640px column
// keeps Linear's label-left / control-right split, the control at its own
// width like Linear's (capped so a long value never starves the label).
export const LIST_ROW_COLUMNS = '@lg:grid-cols-[minmax(0,1fr)_minmax(0,max-content)]'

// Linear's row type: label 13px/500 primary, description 12px/450 tertiary 3px
// under it.
const ROW_LABEL_CLASS = 'text-[0.8125rem] leading-[1.2] font-medium text-(--linear-text-primary)'
const ROW_DESCRIPTION_CLASS = 'mt-[3px] text-xs leading-[1.25] font-[450] text-(--linear-text-tertiary)'

// The one settings row. `action` is the row's control: beside the label on a
// wide pane, under the description on a narrow one — the row owns that
// alignment, so callers never wrap a control in `justify-end`/`items-end`.
// `wide` rows (galleries, editors) keep the control on the title line and give
// the full width to `below`.
export function ListRow({
  title,
  description,
  hint,
  action,
  below,
  'data-tour': dataTour,
  id,
  wide = false,
  className
}: {
  title: ReactNode
  description?: ReactNode
  hint?: ReactNode
  action?: ReactNode
  below?: ReactNode
  /** Durable handle for tours (see lib/tour) — usually the field's schema key. */
  'data-tour'?: string
  id?: string
  wide?: boolean
  className?: string
}) {
  const inCard = useContext(SettingsCardContext)

  return (
    // Container-queried, not viewport-queried: the label/control split keys on
    // the row's own pane width, so a narrow detail column (messaging, split
    // views) stacks instead of squishing the label against the control column.
    <div className={cn('@container', className)} data-tour={dataTour} id={id}>
      <div className={cn('grid gap-3', inCard ? 'py-4' : 'py-3', !wide && [LIST_ROW_COLUMNS, '@lg:items-center'])}>
        <div className="min-w-0">
          <div className={cn('flex items-center justify-between gap-3', ROW_LABEL_CLASS)}>
            <span className="min-w-0">{title}</span>
            {wide && action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
          </div>
          {description && <div className={ROW_DESCRIPTION_CLASS}>{description}</div>}
          {hint && <div className="mt-1 block font-mono text-[0.6875rem] text-(--linear-text-quaternary)">{hint}</div>}
          {below}
        </div>
        {!wide && action && (
          <div className="flex min-w-0 flex-wrap items-center gap-2 @lg:max-w-[22rem] @lg:justify-self-end @lg:justify-end">
            {action}
          </div>
        )}
      </div>
    </div>
  )
}

// The one boolean row: every on/off setting is a Switch in a ListRow (haptic
// baked in). Never a two-option SegmentedControl — that is for choices.
export function ToggleRow({
  checked,
  below,
  'data-tour': dataTour,
  description,
  disabled,
  hint,
  id,
  label,
  onChange,
  wide
}: {
  checked: boolean
  below?: ReactNode
  'data-tour'?: string
  description?: ReactNode
  disabled?: boolean
  hint?: ReactNode
  id?: string
  label: string
  onChange: (on: boolean) => void
  wide?: boolean
}) {
  return (
    <ListRow
      action={
        <Switch
          aria-label={label}
          checked={checked}
          disabled={disabled}
          onCheckedChange={on => {
            triggerHaptic('selection')
            onChange(on)
          }}
        />
      }
      below={below}
      data-tour={dataTour}
      description={description}
      hint={hint}
      id={id}
      title={label}
      wide={wide}
    />
  )
}

// A quiet follow-up under a row's description ("Show 9 tips again", "Reset")
// — the one place a row's secondary action lives, so it never floats beside
// or under the control.
export function RowFootnoteAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <div className="mt-1.5">
      <Button
        onClick={() => {
          triggerHaptic('selection')
          onClick()
        }}
        size="inline"
        variant="text"
      >
        {children}
      </Button>
    </div>
  )
}

// Skeleton primitives mirroring the settings layout rhythm — a loading page keeps
// its shape (like ModelSettings) instead of collapsing to a centered spinner.
export function SectionHeadingSkeleton() {
  return (
    <div className={SECTION_HEADING_CLASS}>
      <Skeleton className="h-4 w-36 max-w-full" />
    </div>
  )
}

export function ListRowSkeleton({ wide = false }: { wide?: boolean }) {
  const inCard = useContext(SettingsCardContext)

  return (
    <div className="@container">
      <div className={cn('grid gap-3', inCard ? 'py-4' : 'py-3', !wide && [LIST_ROW_COLUMNS, '@lg:items-center'])}>
        <div className="min-w-0 space-y-1.5">
          <Skeleton className="h-3.5 w-40 max-w-full" />
          <Skeleton className="h-3 w-64 max-w-full" />
        </div>
        {!wide && <Skeleton className="h-8 w-full @lg:w-48 @lg:justify-self-end" />}
      </div>
    </div>
  )
}

// A full settings page in its loading shape: an optional leading search field
// over one or more sections, each an optional heading above a run of rows.
// `<SettingsSkeleton search sections={[{ heading, rows }]} />`.
export function SettingsSkeleton({
  search = false,
  sections = [{ rows: 4 }]
}: {
  search?: boolean
  sections?: { heading?: boolean; rows: number }[]
}) {
  return (
    <SettingsContent>
      {search && <Skeleton className="mb-4 h-8 w-full" />}
      {sections.map((section, i) => (
        <section className="not-first:mt-12" key={i}>
          {section.heading && <SectionHeadingSkeleton />}
          <SettingsCard>
            {Array.from({ length: section.rows }, (_, r) => (
              <ListRowSkeleton key={r} />
            ))}
          </SettingsCard>
        </section>
      ))}
    </SettingsContent>
  )
}

// Canonical implementation lives in components/ui; re-exported so the many
// settings call sites keep their import path.
export { EmptyState } from '@/components/ui/empty-state'
