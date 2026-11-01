import { useStore } from '@nanostores/react'

import { LanguageSwitcher } from '@/components/language-switcher'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { saveHermesConfig } from '@/hermes'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { $backdrop, setBackdrop } from '@/store/backdrop'
import { $chatTextScale, CHAT_TEXT_SCALE_PRESETS, setChatTextScale } from '@/store/chat-text-scale'
import { $composerPopoutGesturesEnabled, setComposerPopoutGesturesEnabled } from '@/store/composer-popout'
import { $embedAllowed, $embedMode, clearEmbedAllowed, type EmbedMode, setEmbedMode } from '@/store/embed-consent'
import {
  $interfaceMode,
  $modeShadowed,
  INTERFACE_MODES,
  type InterfaceMode,
  setInterfaceMode
} from '@/store/interface-mode'
import { $introSplash, setIntroSplash } from '@/store/intro-splash'
import { $fileBrowserOpen, setFileBrowserOpen } from '@/store/layout'
import { $showModelPricing, setShowModelPricing } from '@/store/model-pricing'
import { notifyError } from '@/store/notifications'
import { $activeGatewayProfile, $profiles, normalizeProfileKey } from '@/store/profile'
import { $reactionsEnabled, setReactionsEnabled } from '@/store/reactions-enabled'
import { $reasoningCollapsedByDefault, setReasoningCollapsedByDefault } from '@/store/reasoning-disclosure'
import { $sessionListDensity, type SessionListDensity, setSessionListDensity } from '@/store/session-list-density'
import { $tabStripDefault, setTabStripDefault, type TabStripDefault } from '@/store/tabstrip-prefs'
import { $textDirection, setTextDirection, TEXT_DIRECTIONS, type TextDirection } from '@/store/text-direction'
import { $hideThreadTimeline, setHideThreadTimeline } from '@/store/thread-timeline'
import { $spentTipCount, $tipsEnabled, resetTips, setTipsEnabled } from '@/store/tips'
import {
  $titlebarAppActionsSide,
  setTitlebarAppActionsSide,
  type TitlebarAppActionsSide
} from '@/store/titlebar-app-actions'
import { $hideCodeDiffs, $toolViewMode, setHideCodeDiffs, setToolViewMode } from '@/store/tool-view'
import { $toursEnabled, setToursEnabled } from '@/store/tours'
import { $vibeHeartsEnabled, setVibeHeartsEnabled } from '@/store/vibe-hearts-enabled'
import { $zoomPercent, setZoomPercent } from '@/store/zoom'
import { useTheme } from '@/themes/context'

import { setHermesConfigCache, useHermesConfigRecord } from '../hooks/use-config-record'

import { AppearanceExtraSlot } from './appearance-contrib'
import type { AppearanceSubpageId } from './appearance-subpages'
import { ChatFontSetting } from './chat-font-setting'
import { MODE_OPTIONS } from './constants'
import { setNested } from './helpers'
import { MinimizeToTraySetting } from './minimize-to-tray-setting'
import { ListRow, RowFootnoteAction, SectionHeading, SettingsCard, SettingsContent, ToggleRow } from './primitives'
import { SETTING_IDS, settingElementId } from './settings-manifest'
import { TerminalFontSetting } from './terminal-font-setting'
import { useSettingDeepLink } from './use-setting-deep-link'

// display.resume_last_session lives in the backend config record (shared with
// config.yaml and the cold-start restore in use-desktop-integrations), not a
// renderer store. Saves write through the shared react-query cache so the
// restore gate sees the new value on the next launch.
function ResumeLastSessionSetting() {
  const { t } = useI18n()
  const a = t.settings.appearance
  const configQuery = useHermesConfigRecord()
  const config = configQuery.data
  const writeScope = configQuery.writeScope
  const checked = (config?.display as { resume_last_session?: unknown } | undefined)?.resume_last_session !== false

  const update = (on: boolean) => {
    if (!config) {
      return
    }

    const next = setNested(config, 'display.resume_last_session', on)
    setHermesConfigCache(next)
    // Sparse patch: PUT /api/config deep-merges, and echoing the cached
    // snapshot would overwrite keys other surfaces changed since it loaded.
    void saveHermesConfig(setNested({}, 'display.resume_last_session', on), writeScope)
      .then(result => {
        if (!result.ok) {
          throw new Error(t.settings.config.autosaveFailed)
        }
      })
      .catch(error => {
        setHermesConfigCache(config)
        notifyError(error, t.settings.config.autosaveFailed)
      })
  }

  return (
    <ToggleRow
      checked={checked}
      description={a.resumeLastSessionDesc}
      disabled={!config}
      id={settingElementId(ids.resumeLastSession)}
      label={a.resumeLastSessionTitle}
      onChange={update}
    />
  )
}

const UI_SCALE_PRESETS = ['90', '100', '110', '125', '150', '175'] as const
const ids = SETTING_IDS.appearance
type UiScalePreset = (typeof UI_SCALE_PRESETS)[number]

function matchUiScalePreset(percent: number): UiScalePreset | null {
  return UI_SCALE_PRESETS.find(preset => Number(preset) === percent) ?? null
}

const compactNumber = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

interface AppearanceSettingsProps {
  subpage?: string
}

export function AppearanceSettings({ subpage }: AppearanceSettingsProps = {}) {
  const { t, isSavingLocale } = useI18n()
  const { mode, setMode } = useTheme()
  const toolViewMode = useStore($toolViewMode)
  const toolViewShadowed = useStore($modeShadowed('toolViewMode'))
  const hideCodeDiffs = useStore($hideCodeDiffs)
  const hideCodeDiffsShadowed = useStore($modeShadowed('hideCodeDiffs'))
  const hideThreadTimeline = useStore($hideThreadTimeline)
  const reasoningCollapsedByDefault = useStore($reasoningCollapsedByDefault)
  const reasoningCollapsedShadowed = useStore($modeShadowed('reasoningCollapsedByDefault'))
  const interfaceMode = useStore($interfaceMode)
  const sessionListDensity = useStore($sessionListDensity)
  const tabStripDefault = useStore($tabStripDefault)
  const titlebarAppActionsSide = useStore($titlebarAppActionsSide)
  const zoomPercent = useStore($zoomPercent)
  const chatTextScale = useStore($chatTextScale)
  const embedMode = useStore($embedMode)
  const embedAllowed = useStore($embedAllowed)
  const composerPopoutGesturesEnabled = useStore($composerPopoutGesturesEnabled)
  const fileBrowserOpen = useStore($fileBrowserOpen)
  const fileBrowserShadowed = useStore($modeShadowed('fileBrowserOpen'))
  const textDirection = useStore($textDirection)
  const reactionsEnabled = useStore($reactionsEnabled)
  const tipsEnabled = useStore($tipsEnabled)
  const toursEnabled = useStore($toursEnabled)
  const spentTips = useStore($spentTipCount)
  const vibeHeartsEnabled = useStore($vibeHeartsEnabled)
  const backdrop = useStore($backdrop)
  const introSplash = useStore($introSplash)
  const showModelPricing = useStore($showModelPricing)
  const profiles = useStore($profiles)
  const activeProfileKey = normalizeProfileKey(useStore($activeGatewayProfile))
  const a = t.settings.appearance

  const show = (id: AppearanceSubpageId) => subpage === undefined || subpage === id

  useSettingDeepLink('config:appearance', page => page !== undefined && show(page as AppearanceSubpageId))

  // The mode saves per profile. Surface that only when the user actually has more
  // than one profile (single-profile installs never see the distinction).
  const showProfileNote = profiles.length > 1

  const activeProfileName =
    profiles.find(profile => normalizeProfileKey(profile.name) === activeProfileKey)?.name ?? activeProfileKey

  const modeOptions = MODE_OPTIONS.map(({ id, icon }) => ({ icon, id, label: t.settings.modeOptions[id].label }))

  const toolOptions = [
    { id: 'product', label: a.product },
    { id: 'technical', label: a.technical }
  ] as const

  const sessionDensityOptions = [
    { id: 'compact', label: a.sessionDensityCompact },
    { id: 'comfortable', label: a.sessionDensityComfortable },
    { id: 'detailed', label: a.sessionDensityDetailed }
  ] as const satisfies readonly { id: SessionListDensity; label: string }[]

  const interfaceModeOptions = INTERFACE_MODES.map(id => ({
    id,
    label: t.interfaceMode[id].label
  })) satisfies readonly {
    id: InterfaceMode
    label: string
  }[]

  // A row whose value Simple mode currently decides says so where the
  // preference text would otherwise promise a persistence it cannot deliver.
  const withModeNote = (description: string, shadowed: boolean) =>
    shadowed ? `${description} ${t.interfaceMode.sessionNote}` : description

  const tabStripOptions = [
    { id: 'auto', label: a.tabStripAuto },
    { id: 'always', label: a.tabStripAlways },
    { id: 'never', label: a.tabStripNever }
  ] as const satisfies readonly { id: TabStripDefault; label: string }[]

  const appActionsOptions = [
    { id: 'right', label: a.appActionsRight },
    { id: 'left', label: a.appActionsLeft }
  ] as const satisfies readonly { id: TitlebarAppActionsSide; label: string }[]

  const textDirectionOptions = TEXT_DIRECTIONS.map(id => ({
    id,
    label: a.textDirection[id]
  })) satisfies readonly { id: TextDirection; label: string }[]

  const embedOptions = [
    { id: 'ask', label: a.embedsAsk },
    { id: 'always', label: a.embedsAlways },
    { id: 'off', label: a.embedsOff }
  ] as const satisfies readonly { id: EmbedMode; label: string }[]

  const uiScaleOptions = UI_SCALE_PRESETS.map(preset => ({ id: preset, label: `${preset}%` }))

  const matchedScalePreset = matchUiScalePreset(zoomPercent)

  return (
    <SettingsContent>
      <div>
        {subpage === undefined && (
          <>
            <SectionHeading title={a.title} />
            <p className="mb-4 px-4 text-xs text-(--linear-text-tertiary)">{a.intro}</p>
          </>
        )}

        <SettingsCard>
          {show('general') && (
            <ListRow
              action={<LanguageSwitcher />}
              description={isSavingLocale ? t.language.saving : t.language.description}
              id={settingElementId(ids.language)}
              title={t.language.label}
            />
          )}

          {show('theme') && (
            <ListRow
              action={
                <SegmentedControl
                  onChange={id => {
                    triggerHaptic('crisp')
                    setMode(id)
                  }}
                  options={modeOptions}
                  value={mode}
                />
              }
              description={
                showProfileNote ? `${a.colorModeDesc} ${a.themeProfileNote(activeProfileName)}` : a.colorModeDesc
              }
              id={settingElementId(ids.theme)}
              title={a.colorMode}
            />
          )}

          {show('typography') && (
            <>
              <ListRow
                action={
                  <SegmentedControl
                    onChange={id => {
                      triggerHaptic('selection')
                      setZoomPercent(Number(id))
                    }}
                    options={uiScaleOptions}
                    value={matchedScalePreset ?? ('' as UiScalePreset)}
                  />
                }
                description={a.uiScaleDesc(zoomPercent)}
                id={settingElementId(ids.uiScale)}
                title={a.uiScaleTitle}
              />

              <ListRow
                action={
                  <SegmentedControl
                    onChange={value => {
                      triggerHaptic('selection')
                      setChatTextScale(Number(value))
                    }}
                    options={CHAT_TEXT_SCALE_PRESETS.map(value => ({ id: String(value), label: `${value}%` }))}
                    value={String(chatTextScale)}
                  />
                }
                description={a.chatTextScaleDesc}
                id={settingElementId(ids.chatTextScale)}
                title={a.chatTextScaleTitle}
              />

              <div id={settingElementId(ids.chatFont)}>
                <ChatFontSetting />
              </div>

              <div id={settingElementId(ids.terminalFont)}>
                <TerminalFontSetting />
              </div>
            </>
          )}

          {show('window-layout') && (
            <ListRow
              action={
                <SegmentedControl
                  onChange={id => {
                    triggerHaptic('selection')
                    setInterfaceMode(id)
                  }}
                  options={interfaceModeOptions}
                  value={interfaceMode}
                />
              }
              description={t.interfaceMode.hint}
              id={settingElementId(ids.interfaceMode)}
              title={t.interfaceMode.title}
            />
          )}

          {show('window-layout') && (
            <ListRow
              action={
                <SegmentedControl
                  onChange={id => {
                    triggerHaptic('selection')
                    setSessionListDensity(id)
                  }}
                  options={sessionDensityOptions}
                  value={sessionListDensity}
                />
              }
              description={a.sessionDensityDesc}
              id={settingElementId(ids.sessionDensity)}
              title={a.sessionDensityTitle}
            />
          )}

          {show('window-layout') && (
            <ListRow
              action={
                <SegmentedControl
                  onChange={id => {
                    triggerHaptic('selection')
                    setTabStripDefault(id)
                  }}
                  options={tabStripOptions}
                  value={tabStripDefault}
                />
              }
              description={a.tabStripDesc}
              id={settingElementId(ids.tabStrip)}
              title={a.tabStripTitle}
            />
          )}

          {show('window-layout') && (
            <ListRow
              action={
                <SegmentedControl
                  onChange={id => {
                    triggerHaptic('selection')
                    setTitlebarAppActionsSide(id)
                  }}
                  options={appActionsOptions}
                  value={titlebarAppActionsSide}
                />
              }
              description={a.appActionsDesc}
              id={settingElementId(ids.appActions)}
              title={a.appActionsTitle}
            />
          )}

          {show('window-layout') && (
            <div id={settingElementId(ids.minimizeToTray)}>
              <MinimizeToTraySetting />
            </div>
          )}

          {show('chat-display') && (
            <ListRow
              action={
                <SegmentedControl
                  onChange={id => {
                    triggerHaptic('selection')
                    setTextDirection(id)
                  }}
                  options={textDirectionOptions}
                  value={textDirection}
                />
              }
              description={a.textDirectionDesc}
              id={settingElementId(ids.textDirection)}
              title={a.textDirectionTitle}
            />
          )}

          {show('window-layout') && (
            <ToggleRow
              checked={backdrop}
              description={a.backdropDesc}
              id={settingElementId(ids.backdrop)}
              label={a.backdropTitle}
              onChange={setBackdrop}
            />
          )}

          {show('chat-display') && (
            <ToggleRow
              checked={hideThreadTimeline}
              description={a.hideThreadTimelineDesc}
              id={settingElementId(ids.hideThreadTimeline)}
              label={a.hideThreadTimelineTitle}
              onChange={setHideThreadTimeline}
            />
          )}

          {show('general') && (
            <ToggleRow
              checked={introSplash}
              description={a.introSplashDesc}
              id={settingElementId(ids.introSplash)}
              label={a.introSplashTitle}
              onChange={setIntroSplash}
            />
          )}

          {show('general') && (
            <ToggleRow
              checked={showModelPricing}
              description={a.modelPricingDesc}
              id={settingElementId(ids.modelPricing)}
              label={a.modelPricingTitle}
              onChange={setShowModelPricing}
            />
          )}

          {/* The same state as the titlebar toggle / ⌘J, which persists across
              launches — so this is the file browser's standing default. Simple
              mode shadows it; a flip there only lasts the session, so say so. */}
          {show('window-layout') && (
            <ToggleRow
              checked={fileBrowserOpen}
              description={withModeNote(a.fileBrowserDesc, fileBrowserShadowed)}
              id={settingElementId(ids.fileBrowser)}
              label={a.fileBrowserTitle}
              onChange={setFileBrowserOpen}
            />
          )}

          {show('window-layout') && (
            <ToggleRow
              checked={composerPopoutGesturesEnabled}
              description={a.composerPopoutDesc}
              id={settingElementId(ids.composerPopout)}
              label={a.composerPopoutTitle}
              onChange={setComposerPopoutGesturesEnabled}
            />
          )}

          {show('general') && <ResumeLastSessionSetting />}

          {show('chat-display') && (
            <ToggleRow
              checked={reactionsEnabled}
              description={a.reactionsDesc}
              id={settingElementId(ids.reactions)}
              label={a.reactionsTitle}
              onChange={setReactionsEnabled}
            />
          )}

          {show('general') && (
            <ToggleRow
              below={
                // A tip shows once (✕ or timer), so this is the only way to a
                // second lap. It appears once there is something to bring back.
                spentTips > 0 && <RowFootnoteAction onClick={resetTips}>{a.tipsReset(spentTips)}</RowFootnoteAction>
              }
              checked={tipsEnabled}
              description={a.tipsDesc}
              id={settingElementId(ids.tips)}
              label={a.tipsTitle}
              onChange={setTipsEnabled}
            />
          )}

          {show('general') && (
            <ToggleRow
              checked={toursEnabled}
              description={a.toursDesc}
              id={settingElementId(ids.tours)}
              label={a.toursTitle}
              onChange={setToursEnabled}
            />
          )}

          {show('chat-display') && (
            <ToggleRow
              checked={vibeHeartsEnabled}
              description={a.vibeHeartsDesc}
              id={settingElementId(ids.vibeHearts)}
              label={a.vibeHeartsTitle}
              onChange={setVibeHeartsEnabled}
            />
          )}

          {show('chat-display') && (
            <ListRow
              action={
                <SegmentedControl
                  onChange={id => {
                    triggerHaptic('selection')
                    setToolViewMode(id)
                  }}
                  options={toolOptions}
                  value={toolViewMode}
                />
              }
              description={withModeNote(a.toolViewDesc, toolViewShadowed)}
              id={settingElementId(ids.toolView)}
              title={a.toolViewTitle}
            />
          )}

          {show('chat-display') && (
            <ToggleRow
              checked={hideCodeDiffs}
              description={withModeNote(a.hideCodeDiffsDesc, hideCodeDiffsShadowed)}
              id={settingElementId(ids.hideCodeDiffs)}
              label={a.hideCodeDiffsTitle}
              onChange={setHideCodeDiffs}
            />
          )}

          {show('chat-display') && (
            <ToggleRow
              checked={reasoningCollapsedByDefault}
              description={withModeNote(a.reasoningCollapsedDesc, reasoningCollapsedShadowed)}
              id={settingElementId(ids.reasoningCollapsed)}
              label={a.reasoningCollapsedTitle}
              onChange={setReasoningCollapsedByDefault}
            />
          )}

          {show('chat-display') && (
            <ListRow
              action={
                <SegmentedControl
                  onChange={id => {
                    triggerHaptic('selection')
                    setEmbedMode(id)
                  }}
                  options={embedOptions}
                  value={embedMode}
                />
              }
              below={
                embedAllowed.length > 0 && (
                  <RowFootnoteAction onClick={clearEmbedAllowed}>
                    {a.embedsReset(embedAllowed.length)}
                  </RowFootnoteAction>
                )
              }
              description={a.embedsDesc}
              id={settingElementId(ids.embeds)}
              title={a.embedsTitle}
            />
          )}
        </SettingsCard>
      </div>

      {/* Plugin-provided appearance controls — the sanctioned seam for a
          plugin that used to inject nodes into this page. Top-level page only:
          a deep-link subpage shows one built-in section, and a plugin card is
          not that section. */}
      {subpage === undefined && <AppearanceExtraSlot />}
    </SettingsContent>
  )
}
