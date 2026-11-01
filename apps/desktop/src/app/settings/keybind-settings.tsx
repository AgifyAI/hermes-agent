import { useStore } from '@nanostores/react'
import { useContext, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { DisclosureCaret } from '@/components/ui/disclosure-caret'
import { Kbd, KbdCombo } from '@/components/ui/kbd'
import { SearchField } from '@/components/ui/search-field'
import { Tip } from '@/components/ui/tooltip'
import { useContributions } from '@/contrib/react/use-contributions'
import { useI18n } from '@/i18n'
import {
  allKeybindActions,
  KEYBIND_CATEGORIES,
  KEYBIND_PANEL_ACTION,
  KEYBIND_READONLY,
  type KeybindActionMeta,
  type KeybindReadonly,
  KEYBINDS_AREA
} from '@/lib/keybinds/actions'
import { formatCombo } from '@/lib/keybinds/combo'
import { arraysEqual } from '@/lib/storage'
import { cn } from '@/lib/utils'
import {
  $bindings,
  $capture,
  beginCapture,
  bindingsFor,
  clearBinding,
  conflictsFor,
  endCapture,
  resetAllBindings,
  resetBinding
} from '@/store/keybinds'

import { HudModifierSettings } from './hud-modifier-settings'
import { SettingsBreadcrumbContext, SettingsCard, SettingsContent } from './primitives'
import { ScreenshotSettings } from './screenshot-settings'
import { useSettingDeepLink } from './use-setting-deep-link'

interface KeybindSettingsProps {
  subpage?: string
}

export function KeybindSettings({ subpage }: KeybindSettingsProps = {}) {
  useSettingDeepLink('keybinds', page => subpage === undefined || page === subpage)

  if (subpage === 'hud-gesture') {
    return (
      <SettingsContent>
        <SettingsCard>
          <HudModifierSettings />
        </SettingsCard>
      </SettingsContent>
    )
  }

  if (subpage === 'screen-capture') {
    return (
      <SettingsContent>
        <SettingsCard>
          <ScreenshotSettings />
        </SettingsCard>
      </SettingsContent>
    )
  }

  return <ShortcutSettings includeScreenshot={subpage === undefined} />
}

function ShortcutSettings({ includeScreenshot }: { includeScreenshot: boolean }) {
  const { t } = useI18n()
  const hasBreadcrumb = useContext(SettingsBreadcrumbContext)
  const bindings = useStore($bindings)
  const k = t.keybinds
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  // Subscribe so contributed actions appear/disappear live in the map. The
  // snapshot feeds the list: under React Compiler an independently called
  // allKeybindActions() stays memoized across that registration.
  const contributions = useContributions(KEYBINDS_AREA)
  const actionList = allKeybindActions(contributions)
  const [query, setQuery] = useState('')

  const openCombo = bindings[KEYBIND_PANEL_ACTION]?.[0]

  const toggleCategory = (category: string) =>
    setCollapsed(prev => {
      const next = new Set(prev)

      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }

      return next
    })

  // Filter actions and readonly shortcuts by label match against the query.
  // When searching, categories auto-expand (collapsed state is ignored).
  const isSearching = query.trim().length > 0

  const filteredActions = useMemo(() => {
    if (!isSearching) {
      return null
    }

    const lower = query.toLowerCase()

    return actionList.filter(action => {
      if (action.id === KEYBIND_PANEL_ACTION) {
        return false
      }

      const label = k.actions[action.id] ?? action.id

      return label.toLowerCase().includes(lower) || action.id.includes(lower)
    })
  }, [actionList, isSearching, query, k.actions])

  const filteredReadonly = useMemo(() => {
    if (!isSearching) {
      return null
    }

    const lower = query.toLowerCase()

    return KEYBIND_READONLY.filter(shortcut => {
      const label = k.actions[shortcut.id] ?? shortcut.id

      return label.toLowerCase().includes(lower) || shortcut.id.includes(lower)
    })
  }, [isSearching, query, k.actions])

  return (
    <SettingsContent>
      <div className="mb-8 flex items-center justify-between gap-3 px-4">
        <div className="min-w-0">
          {!hasBreadcrumb && (
            <h2 className="text-[0.9375rem] leading-[1.4375rem] font-medium text-(--linear-text-primary)">{k.title}</h2>
          )}
          <p className="mt-0.5 text-xs text-(--linear-text-tertiary)">
            {k.subtitle(openCombo ? formatCombo(openCombo) : '')}
          </p>
        </div>
        <Button className="shrink-0" onClick={resetAllBindings} size="sm" type="button" variant="text">
          <Codicon name="discard" size="0.8125rem" />
          {k.resetAll}
        </Button>
      </div>

      {includeScreenshot &&
        (!isSearching || t.settings.screenshot.enabledTitle.toLowerCase().includes(query.toLowerCase())) && (
          <SettingsCard className="mb-8">
            <ScreenshotSettings />
          </SettingsCard>
        )}

      <div className="mb-8 px-4">
        <SearchField
          aria-label={k.search}
          containerClassName="w-full"
          onChange={setQuery}
          placeholder={k.search}
          value={query}
        />
      </div>

      {isSearching ? (
        filteredActions?.length === 0 && filteredReadonly?.length === 0 ? (
          <p className="py-4 text-center text-[0.8125rem] text-(--linear-text-tertiary)">—</p>
        ) : (
          <SettingsCard>
            {filteredActions?.map(action => (
              <KeybindRow action={action} key={action.id} />
            ))}
            {filteredReadonly?.map(shortcut => (
              <ReadonlyRow key={shortcut.id} shortcut={shortcut} />
            ))}
          </SettingsCard>
        )
      ) : (
        <div>
          {KEYBIND_CATEGORIES.map(category => {
            const actions = actionList.filter(
              action => action.category === category && action.id !== KEYBIND_PANEL_ACTION
            )

            const readonly = KEYBIND_READONLY.filter(shortcut => shortcut.category === category)

            if (actions.length === 0 && readonly.length === 0) {
              return null
            }

            const sectionOpen = !collapsed.has(category)

            return (
              <section className="not-first:mt-12" key={category}>
                <CategoryHeader
                  label={k.categories[category] ?? category}
                  onToggle={() => toggleCategory(category)}
                  open={sectionOpen}
                />
                <SettingsCard>
                  {sectionOpen && actions.map(action => <KeybindRow action={action} key={action.id} />)}
                  {sectionOpen && readonly.map(shortcut => <ReadonlyRow key={shortcut.id} shortcut={shortcut} />)}
                </SettingsCard>
              </section>
            )
          })}
        </div>
      )}
    </SettingsContent>
  )
}

function CategoryHeader({ label, onToggle, open }: { label: string; onToggle: () => void; open: boolean }) {
  return (
    <button
      className="group/kbd-cat mb-4 flex w-fit min-w-0 cursor-pointer items-center gap-1 px-4 text-left text-[0.9375rem] leading-[1.4375rem] font-medium text-(--linear-text-primary)"
      onClick={onToggle}
      type="button"
    >
      <span className="min-w-0 truncate">{label}</span>
      <DisclosureCaret
        className="text-(--linear-text-tertiary) opacity-0 transition group-hover/kbd-cat:opacity-100"
        open={open}
        size="0.6875rem"
      />
    </button>
  )
}

// A shortcut row inside its category card: Linear's 44px list row.
const KEYBIND_ROW_CLASS = 'flex min-h-11 items-center gap-2.5'

function KeybindRow({ action }: { action: KeybindActionMeta }) {
  const { t } = useI18n()
  const k = t.keybinds
  const bindings = useStore($bindings)
  const capture = useStore($capture)

  // bindingsFor resolves stored overrides for late-registered (contributed)
  // actions too — $bindings only carries built-ins, so a raw lookup would show
  // the default instead of the user's rebinding for a plugin/contrib action.
  const combos = bindingsFor(action.id, bindings)
  const capturing = capture === action.id
  const label = k.actions[action.id] ?? action.label ?? action.id
  const isDefault = arraysEqual(combos, [...action.defaults])

  const conflict = combos
    .flatMap(combo => conflictsFor(action.id, combo).map(other => k.actions[other] ?? other))
    .find(Boolean)

  return (
    <div className={cn('group', KEYBIND_ROW_CLASS)}>
      <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium text-(--linear-text-primary)">
        {label}
      </span>

      {conflict && (
        <span className="flex size-4 items-center justify-center text-(--linear-orange)" title={k.conflictWith(conflict)}>
          <Codicon name="warning" size="0.8125rem" />
        </span>
      )}

      {/* Click the caps to rebind — the on-screen editor does the same thing. */}
      <Tip label={k.rebind}>
        <button
          aria-label={k.rebind}
          className="flex shrink-0 items-center gap-1 rounded-lg outline-none"
          onClick={() => (capturing ? endCapture() : beginCapture(action.id))}
          type="button"
        >
          {capturing ? (
            <Kbd variant="capturing">{k.pressKey}</Kbd>
          ) : combos.length > 0 ? (
            combos.map(combo => <KbdCombo combo={combo} key={combo} />)
          ) : (
            <Kbd variant="ghost">{k.set}</Kbd>
          )}
        </button>
      </Tip>

      {/* Reset shows once a binding diverges from its default. A shipped chord
          (sidebar mod+b) has no reset, so that same slot clears it instead. */}
      {isDefault ? (
        combos.length > 0 ? (
          <Tip label={k.clear}>
            <Button
              aria-label={k.clear}
              className="shrink-0 text-(--linear-text-tertiary) opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              onClick={() => clearBinding(action.id)}
              size="icon-xs"
              variant="ghost"
            >
              <Codicon name="close" size="0.8125rem" />
            </Button>
          </Tip>
        ) : (
          <span aria-hidden className="size-6 shrink-0" />
        )
      ) : (
        <Tip label={k.reset}>
          <Button
            aria-label={k.reset}
            className="shrink-0 text-(--linear-text-tertiary) opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            onClick={() => resetBinding(action.id)}
            size="icon-xs"
            variant="ghost"
          >
            <Codicon name="discard" size="0.8125rem" />
          </Button>
        </Tip>
      )}
    </div>
  )
}

// Fixed shortcut: same layout as KeybindRow but the caps aren't interactive and
// the trailing reset slot stays empty (spacer keeps the columns aligned).
function ReadonlyRow({ shortcut }: { shortcut: KeybindReadonly }) {
  const { t } = useI18n()
  const k = t.keybinds
  const label = k.actions[shortcut.id] ?? shortcut.id

  return (
    <div className={KEYBIND_ROW_CLASS}>
      <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium text-(--linear-text-secondary)">
        {label}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        {shortcut.keys.map(key => (
          <KbdCombo combo={key} key={key} />
        ))}
      </div>
      <span aria-hidden className="size-6 shrink-0" />
    </div>
  )
}
