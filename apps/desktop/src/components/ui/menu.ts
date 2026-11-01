// The one floating-list look. DropdownMenu, Select, and every Popover + cmdk
// picker (`<PopoverContent variant="menu">` + `<Command variant="menu">`) paint
// through these, so a list reads the same wherever it opens. Change the menu
// here, never per call site.

// `dt-portal-scrollbar` reproduces the thin themed scrollbar from
// `.scrollbar-dt` for portaled overlays (Radix renders under document.body,
// outside #root's scope). See styles.css.
// Linear's menu (docs/linear-design-reference.md § Menu): 12px radius, overlay
// hairline + surface + menu shadow, 13px/450 text on 19.5px lines. The 6px
// padding is Linear's highlight inset.
export const menuSurfaceClass =
  'dt-portal-scrollbar rounded-(--linear-radius-overlay) border-[0.5px] border-(--linear-border-overlay) bg-(--linear-bg-overlay) p-1.5 text-[0.8125rem] leading-[1.21875rem] font-[450] text-(--linear-text-overlay) shadow-(--linear-shadow-menu)'

export const menuMotionClass =
  'data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95'

// Row shape only. Each primitive adds its own highlight/disabled selectors:
// Radix rows take real focus (`focus:`), cmdk rows stay behind the input and
// mark `data-selected="true"`.
// 32px rows; label at 14px from the menu edge (6px inset + 8px), 16px icons.
export const menuItemClass =
  "relative flex min-h-8 items-center gap-2 rounded-(--linear-radius-control) py-1.5 pr-3 pl-2 text-[0.8125rem] leading-[1.21875rem] outline-hidden select-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"

export const menuItemFocusClass = 'focus:bg-(--linear-hover-overlay) focus:text-(--linear-text-overlay-strong)'

export const menuLabelClass = 'px-2 py-1.5 text-xs font-medium text-(--linear-text-hint)'
