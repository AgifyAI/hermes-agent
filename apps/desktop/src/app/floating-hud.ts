// Shared chrome for the top-center floating HUDs (command palette + session
// switcher). They pin just under the title bar, centered, and lean on a crisp
// border + shadow to separate from the app — no dimming/blurring backdrop.
// Each caller layers on its own z-index, width, and overflow.
//
// Narrow screens: the centered HUD widens toward full-width and its top-left
// corner slides under the macOS traffic lights. Below ~44rem (where the overlap
// begins) drop the whole surface beneath the titlebar band so the search row
// always clears the window controls. These HUDs portal to <body>, outside the
// app-shell subtree that defines --titlebar-height, so the var needs a fallback.
export const HUD_POSITION =
  'fixed left-1/2 top-3 -translate-x-1/2 max-[44rem]:top-[calc(var(--titlebar-height,34px)+0.375rem)]'

// Linear's command palette (docs/linear-design-reference.md § Command palette):
// radius 12, overlay surface + hairline, palette (dialog) shadow.
// `no-drag`: these HUDs overlap the titlebar's `[-webkit-app-region:drag]` band
// (app-shell.tsx), which wins hit-testing over DOM regardless of z-index — so
// without it the top of the surface (the search input) swallows clicks.
export const HUD_SURFACE =
  'rounded-(--linear-radius-overlay) border-[0.5px] border-(--linear-border-overlay) bg-(--linear-bg-overlay) text-(--linear-text-overlay) shadow-(--linear-shadow-dialog) [-webkit-app-region:no-drag]'

// One row/text size for both HUDs: Linear's palette rows, 13px/450.
export const HUD_TEXT = 'text-[0.8125rem] font-[450]'

// Shared item layout for both HUDs: Linear's palette item — 46px, 0 12px
// padding, 8px icon gap; overrides the shadcn `CommandItem` default.
export const HUD_ITEM = 'min-h-[2.875rem] gap-2 px-3 py-0'

// Section headings like Linear's sidebar section headers: 12px/500 tertiary,
// sentence case — plain text, no sticky chrome bar. Targets the cmdk group
// heading via the universal-descendant variant.
export const HUD_HEADING =
  '**:[[cmdk-group-heading]]:static **:[[cmdk-group-heading]]:bg-transparent **:[[cmdk-group-heading]]:px-3 **:[[cmdk-group-heading]]:pb-1 **:[[cmdk-group-heading]]:pt-2.5 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-(--linear-text-tertiary)'

// A short note trailing a row's label — a version, a count, a live state. Sits
// closer than the row's icon-to-label `gap-2` because it reads as a suffix of
// the label, not as another item in the row.
export const HUD_NOTE = '-ml-1'

// `state` marks a note the row will CHANGE (a toggle's on/off) rather than a
// passive fact. It keeps the label's own color so the pair reads as one phrase,
// and earns its separation from a faint underline instead of going muted.
//
// That underline needs room, so `state` skips `truncate`: flex items are
// blockified, which makes its `overflow: hidden` bite, and the app's global
// 0.25rem underline offset (styles.css) already sits at the bottom edge of a
// 13px line box — together they clip the rule away entirely. Pulling the
// offset to 2px keeps it inside the box; dropping truncate costs nothing
// because these notes are one word.
export const HUD_NOTE_VARIANT = {
  muted: 'truncate text-(--linear-text-tertiary)',
  state: 'shrink-0 underline decoration-current/50 underline-offset-2'
} as const
