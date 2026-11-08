# Linear design reference (measured)

The values Hermes Desktop's design system is built on. Every number below was read from the
running **Linear desktop app 1.32.8** (macOS, Electron) on 2026-10-31, through its own Chrome
DevTools (View › Toggle Developer Tools) with `getComputedStyle` on live elements, in both the
Light and Dark themes. Nothing here is estimated. When a value is missing, measure it the same way;
never guess.

Method notes:

- Linear styles with StyleX (`sx-*` atomic classes, hashed `--sx-*` variables) plus a few named
  variables (`--color-*`, `--speed-*`, `--ease-*`). Colours are authored in **LCH**; we keep LCH.
- Linear ran at 110 % zoom while measuring, so a 1-device-pixel hairline reads as `0.45px`; Linear
  authors these as `0.5px` / `1px` hairlines. Hermes uses `1px` borders at 100 % zoom.
- "L" = Light theme, "D" = Dark theme. Hue 282 (light) / 272 (dark) is Linear's neutral tint.

## 1. Colour tokens

| Role | Linear name | Light | Dark |
|---|---|---|---|
| Window / sidebar bg | `--bg-color` | `lch(94.44% 0.5 282)` | `lch(2.595% 0.4 272)` |
| Content panel bg | `--color-bg-primary` | `lch(97.94% 0.5 282)` | `lch(5.52% 0.4 272)` |
| Bg secondary | `--color-bg-secondary` | `lch(92.44% 0.5 282)` | `lch(7.32% 0.85 272)` |
| Bg tertiary | `--color-bg-tertiary` | `lch(90.94% 0.5 282)` | `lch(8.22% 1.3 272)` |
| Bg quaternary | `--color-bg-quaternary` | `lch(94.44% 0.5 282)` | `lch(9.345% 0.85 272)` |
| Border primary | `--color-border-primary` | `lch(95.24% 0 282)` | `lch(9.84% 1.48 272)` |
| Border secondary | `--color-border-secondary` | `lch(88.49% 0 282)` | `lch(14.16% 1.48 272)` |
| Border tertiary | `--color-border-tertiary` | `lch(84.44% 0 282)` | `lch(16.32% 1.48 272)` |
| Text primary | `--color-text-primary` | `lch(9.794% 0 282)` | `lch(100% 0 272)` |
| Text secondary | `--color-text-secondary` | `lch(19.588% 1.25 282)` | `lch(90.451% 1.2 272)` |
| Text tertiary | `--color-text-tertiary` | `lch(39.176% 1.25 282)` | `lch(61.803% 1.2 272)` |
| Text quaternary | `--color-text-quaternary` | `lch(64.64% 1.25 282)` | `lch(36.975% 1.2 272)` |
| Scrollbar thumb | `--app-scrollbar-bg` | `lch(64.94% 1.25 282)` | `lch(37.275% 1.2 272)` |
| Overlay surface (menu, palette, tooltip, toast) | — | `lch(100% 0 282)` | `lch(12.72% 0.85 272)` |
| Overlay border | — | `lch(91.9% 0 282)` | `lch(25.68% 1.93 272)` |
| Overlay text | — | `lch(20% 1 282)` | `lch(91.178% 1.425 272)` |
| Overlay item highlight | — | `lch(95% 0 282)` | `lch(20.82% 1.3 272)` |
| Card / modal surface | — | `lch(100% 0 282)` | `lch(9.232% 0.85 272)` |
| Content-panel border | — | `lch(89.84% 0 282)` | `lch(13.08% 1.48 272)` |
| Accent (primary button) | — | `lch(53% 52.26 286.91)`, hover `lch(47% 50.26 286.91)` | `lch(47.918% 59.303 288.421)`, hover `lch(52.418% 61.103 288.421)` |
| On-accent text | — | `lch(100% 5 286.91)` | same |
| Focus ring | `--focus-ring-outline` | `1px solid #6d78d5` | same |
| Text selection | `--selection-bg` | `color-mix(in srgb, #5b5c5e 20%, transparent)` | same |
| Success (diff added) | `--diff-view-git-added-fg` | `lch(60% 64.37 141.95)` | same |
| Danger (diff deleted) | `--diff-view-git-deleted-fg` | `lch(50% 73 29)` | same |
| Info (diff modified) | `--diff-view-git-modified-fg` | `lch(72% 70 267)` | same |
| Warning | `--sx-91u3ar` | `lch(75% 90 85)` | same |

## 2. Typography

- `--font-regular`: `"Inter Variable", "SF Pro Display", -apple-system, system-ui, "Segoe UI",
  Roboto, …, sans-serif`. `--font-monospace`: `"Berkeley Mono", "SFMono Regular", Consolas, …`.
- Rendering: `-webkit-font-smoothing: antialiased`, `text-rendering: optimizeLegibility`; UI text
  uses `font-feature-settings: "calt"` and `letter-spacing: -0.1px`; kbd uses `"cv08", "zero"`.
- Sizes: micro `.6875rem` (11px), mini `.75rem` (12), small `.8125rem` (13), regular `.9375rem`
  (15), large `1.125rem` (18), title3 `1.25rem` (20), title2 `1.5rem` (24), title1 `2.25rem` (36).
- Weights: light 300, normal 450, medium 500, semibold 600, bold 700.
- Usage: body/rows/menus 13px/450; labels and nav 13px/500; buttons and chips 12px/500; hints and
  kbd 11px; settings section title 15px/500 (line-height 23px); page title 24px/500 (line-height
  32px, letter-spacing -0.16px); modal title 18px/600 (line-height 28.8px).

## 3. Radii, sizes, motion

- Radii: controls `--control-border-radius: 8px`; pills `9999px`; settings cards 10px; menus,
  palette, toast, content panel 12px; modal 21px; kbd keys 4px; avatar 8px (workspace) / round.
- Layout: `--sidebar-width: 220px`; header 44px (padding `0 12px 0 8px`, hairline bottom);
  content panel inset 8px right/bottom; `--scrollbar-width: 10px`.
- Motion: `--speed-quickTransition .1s`, `--speed-regularTransition .25s`,
  `--speed-slowTransition .35s`, `--speed-highlightFadeOut .15s`, highlight fade-in 0s.
  Easings: the standard set, e.g. `--ease-out-quad: cubic-bezier(.25,.46,.45,.94)`.

## 4. Elevation

| Surface | Light | Dark |
|---|---|---|
| Content panel, tooltip, tab | `lch(0 0 0/.02) 0 3px 6px -2px, lch(0 0 0/.04) 0 1px 1px` | `lch(0 0 0/.3) 0 .5px 1px 1px` |
| Menu / popover | `lch(0 0 0/.02) 0 6px 18px, lch(0 0 0/.04) 0 3px 9px, lch(0 0 0/.04) 0 1px 1px` | `lch(0 0 0/.125) 0 3px 8px, lch(0 0 0/.125) 0 2px 5px, lch(0 0 0/.125) 0 1px 1px` |
| Command palette / modal | `lch(0 0 0/.08) 0 9px 48px, lch(0 0 0/.1) 0 6px 24px, lch(0 0 0/.04) 0 1px 1px` | `lch(0 0 0/.1) 0 4px 40px, lch(0 0 0/.125) 0 3px 20px, lch(0 0 0/.125) 0 3px 12px, lch(0 0 0/.125) 0 2px 8px, lch(0 0 0/.125) 0 1px 1px` |
| Settings card | `lch(0 0 0/.088) 0 0 0 .5px, lch(0 0 0/.02) 0 3px 6px -2px, lch(0 0 0/.04) 0 1px 1px` | `lch(100 0 0/.083) 0 0 0 .5px, lch(0 0 0/.3) 0 .5px 1px 1px` |
| Modal overlay | `lch(0 0 0/.25)` | `lch(0 0 0/.4)` |

## 5. Components

**Sidebar.** Rows 28px high, radius 8, inner padding `0 9px 0 8px`, icon 14px + 6px gap, label
13px/500. Rest text L `lch(37.776% 1.25 282)` D `lch(60.621% 1.2 272)`; hover bg L
`lch(91.64% 0.5 282)` D `lch(8.445% 1.3 272)`; active bg L `lch(89.54% 0.5 282)` D
`lch(13.845% 1.3 272)` with primary text. Section headers 12px/500 tertiary, 28px, padding
`0 4px`, primary colour on hover. Workspace button 28px, radius 10, label 13px/550, avatar 20px.
Count badges 11px/450.

**Icon button.** 28×28 (24 and 32 variants), radius 9999, transparent hairline border, icon 14px
(16px inside modals). Colour L `lch(19.588% 1.25 282)` D `lch(90.155% 1.2 272)`; hover bg L
`lch(94.854% 0.5 282)` (sidebar `lch(0 0 0/.06)`) D `lch(10.149% .689 272)`; hover text primary;
disabled opacity .6.

**Buttons.** Primary 28px, padding `0 10px`, radius 9999, 12px/500, accent bg (§1). Secondary
32px, padding `0 12px`, 12px/500. Ghost 24px, padding `0 12px 0 6px`. Toolbar button 28px,
padding `0 10px 0 8px`, bg L `lch(99.99% .5 282)` hover `lch(95.883% .157 282)`. Property chip
24px, radius 9999, padding `0 8px 0 6px`, 12px/500, icon 14px; bg L `lch(100% 0 282)` hover
`lch(95.886% 0 282)`, D `lch(17.574% 1.589 272)` text `lch(91.2% 1.65 272)`.

**Segmented tabs.** 28px pills, padding `0 10px`, 12px/500. Selected L `lch(93.483% .5 282)`
D `lch(16.706% .979 272)`; unselected L `lch(99.997% .5 282)` tertiary text, D
`lch(10.149% .593 272)` text `lch(61.8% 1.2 272)`.

**Menu / dropdown.** Radius 12, hairline overlay border, overlay surface and shadow (§1, §4), text
13px/450, line-height 19.5px. Items 32px, padding `0 18px 0 14px`, icon 16px, gap 8; the highlight
is an inner layer inset 6px, radius 8, overlay-highlight bg, text L `lch(10% 0 282)` D white.
Shortcut hints 11px/500, L `lch(40% 1 282)` D `lch(64.714% 1.425 272)`. Separator 12px total
(6px padding each side). Filter input padding 10px top / 9px bottom.

**Command palette.** 720×450, radius 12, overlay surface, palette shadow, offset 80px from the top.
Context chip 22px, radius 10, 12px. Input 40px high, padding `11px 12px`, 13px. Items 46px, padding
`0 12px`, gap 8, icon 16px, 13px/450. Kbd keys 17px, padding 2px, hairline border (L
`lch(91.9% 0 282)` D `lch(20.28% 1.93 272)`), radius 4, 11px.

**Modal.** 750px wide, radius 21, card surface, palette shadow, overlay (§4), 80px from the top.
Title 18px/600; body 15px/450, line-height 22.5px; close/expand icon buttons 32px.

**List row.** 44px, radius 8, title 13px/500. Chip 24px, radius 48, hairline tertiary border,
bg primary, 12px/450. Avatars 18px round.

**Settings.** Nav like the sidebar (rows 28px, icons 16px, padding-left 10px). Content column
640px. Page title 24px/500. Section title 15px/500, padding `0 16px`, 16px above the card, 48px
between sections. Card radius 10, card surface + card shadow (§4). Rows padding 16, gap 12, label
13px/500 (L `lch(10% 0 282)`), description 12px/450 (L `lch(40% 1 282)`), gap 3px. Switch 30×20
pill, accent when on (hover = accent hover); off track L `lch(82.484% .054 282)` hover
`lch(76.978% .076 282)`, D `lch(47.551% .913 272)` hover `lch(56.238% 1.008 272)`; thumb 14px
round, inset 3px (left 3 → 13 when on), L `lch(100% 5 286.91)` D `lch(100% 5 288.421)`, no
shadow; disabled opacity .5. Select button 30px, padding `1px 28px 1px 10px`, radius 8, 13px, bg L
`lch(100% 0 282)` hover `lch(95.886% 0 282)`, D `lch(13.861% 1.139 272)`.

**Text input.** 32px, padding `6px 12px`, radius 8, hairline border L `lch(86.5% 0 282)` D
`lch(30.83% 1.93 272)`, bg L `lch(100% 0 282)` D `lch(9.23% .85 272)`, 13px; disabled text
`lch(40% 1 282)`; focus = focus ring.

**Tooltip.** 28px high, radius 8, padding `5px 8px`, gap 8, overlay surface and border, small
shadow (§4), 11px/450, may carry kbd keys.

**Toast.** Bottom-right stack (Sonner), width 356, gap 8, radius 12, overlay surface, padding 12,
gap 8, 16px icon, 13px/500 tertiary text.

## Issue detail, 2026-11-08

Measured in the signed-in Linear web app in an isolated background tab. The
issue title is a textbox editable on click. While focused it retains Inter
Variable at 24px and weight 600. The status property button measures 28px high
with a 13px Inter Variable label, a 6px horizontal gap and a 9999px radius.

In an empty Linear chat composer, pressing ⌘E and then typing inserts text
inside an inline code span. This was checked in an unsent draft.
