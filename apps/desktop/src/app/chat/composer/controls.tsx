import { useStore } from '@nanostores/react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip, TipKeybindLabel } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { iconSize, Layers3 } from '@/lib/icons'
import { isBrowserHostedDesktop } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { recordAction } from '@/store/desktop-metrics'
import { $hudMode, closeHud, resetHudLayout } from '@/store/hud'

import { GHOST_ICON_BTN, PRIMARY_ICON_BTN } from './control-classes'
import { ModelPill } from './model-pill'
import { ReasoningPill } from './reasoning-pill'
import type { ChatBarState } from './types'

// Re-exported: `context-menu.tsx` and other row neighbours have always reached
// for these here, and the row is where they read as belonging.
export { ACTIVE_ICON_BTN, GHOST_ICON_BTN, ICON_BTN, PRIMARY_ICON_BTN } from './control-classes'

// iOS fires mousedown after touchend, and its default blurs the editor before
// submit runs. The browser-hosted Desktop keeps focus where it was so a send
// leaves the keyboard as it was. Native Desktop keeps the press's blur, which
// closes an open completion list and clears a composition the IME never ended.
const keepEditorFocus = (event: { preventDefault: () => void }) => {
  if (isBrowserHostedDesktop()) {
    event.preventDefault()
  }
}

export function ComposerControls({
  busy,
  busyAction,
  canSubmit,
  cardWaiting = false,
  compactModelPill = false,
  disabled,
  hasComposerPayload,
  hideModelPill = false,
  minimal = false,
  state,
  onQueue,
  onSteer
}: {
  busy: boolean
  busyAction: 'interrupt' | 'steer' | 'queue' | 'stop'
  canSubmit: boolean
  /** A card parked on the session takes typed text as its answer, so queueing that text would leave the card waiting. */
  cardWaiting?: boolean
  compactModelPill?: boolean
  disabled: boolean
  hasComposerPayload: boolean
  hideModelPill?: boolean
  minimal?: boolean
  state: ChatBarState
  onQueue: () => void
  onSteer?: () => void
}) {
  const { t } = useI18n()
  const c = t.composer
  const hudMode = useStore($hudMode)

  // Steer is just send: a payload keeps the Send affordance mid-turn (it answers
  // a waiting card). Stop only when the composer is empty and a turn is running.
  const showStop = busy && !hasComposerPayload

  const showQueueButton = queueButtonVisible(busy, busyAction, hasComposerPayload, cardWaiting)

  // A waiting card takes the draft as its answer through Send, whatever the busy action.
  const sendLabel = composerSendLabel(busy && !cardWaiting, busyAction, c)

  // The browser host's touch-size controls can outgrow a minimal row, so there
  // they pack to the end and wrap. Native Desktop keeps main's single row.
  const browserHost = isBrowserHostedDesktop()

  return (
    <div
      className={cn('flex min-w-0 shrink items-center gap-(--composer-control-gap)', browserHost && 'justify-end')}
      style={{ flexWrap: browserHost && minimal ? 'wrap' : undefined }}
    >
      {minimal ? null : (
        <>
          {hideModelPill ? null : (
            <>
              <ModelPill compact={compactModelPill} disabled={disabled} model={state.model} />
              {compactModelPill ? null : <ReasoningPill disabled={disabled} model={state.model} />}
            </>
          )}
        </>
      )}
      {renderSteerButton(busy, busyAction, onSteer, disabled, c.steer)}
      {showQueueButton ? (
        <Tip label={<TipKeybindLabel actionId="composer.queue" text={c.queueMessage} />} placement="control">
          <Button
            aria-label={c.queueMessage}
            className={GHOST_ICON_BTN}
            disabled={disabled}
            onClick={onQueue}
            onMouseDown={keepEditorFocus}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Layers3 className={iconSize.sm} />
          </Button>
        </Tip>
      ) : null}
      <Tip
        label={
          showStop ? (
            <TipKeybindLabel actionId="composer.send" text={c.stop} />
          ) : (
            <TipKeybindLabel actionId="composer.send" text={sendLabel} />
          )
        }
        placement="control"
      >
        <Button
          aria-label={showStop ? c.stop : sendLabel}
          className={PRIMARY_ICON_BTN}
          disabled={disabled || !canSubmit}
          onClick={() => recordAction(showStop ? 'composer.cancel' : 'composer.send', 'click')}
          onMouseDown={keepEditorFocus}
          type="submit"
        >
          {showStop ? (
            <span className="block size-2.5 rounded-[0.1875rem] bg-current" />
          ) : (
            <Codicon name="arrow-up" size="0.875rem" />
          )}
        </Button>
      </Tip>
      {/* The way out of HUD mode, riding the controls row rather than floating
          above the bar. The old chip lived in a 26px transparent strip reserved
          over the composer (--hud-chip-strip), which under glass is bare
          untinted material with a hidden button in it — a band of chrome above
          the surface, paid for in every state, for a control that is invisible
          until hovered. Here it costs no reserved space and sits with the other
          things you can press. */}
      {hudMode ? <HudWindowButtons /> : null}
    </div>
  )
}

// Queue is the secondary mid-turn action: never while the primary button already queues or stops, and
// never while a card waits (its Send answers the card).
function queueButtonVisible(
  busy: boolean,
  busyAction: 'interrupt' | 'steer' | 'queue' | 'stop',
  hasPayload: boolean,
  cardWaiting: boolean
): boolean {
  return busy && busyAction !== 'stop' && busyAction !== 'queue' && hasPayload && !cardWaiting
}

function composerSendLabel(
  busy: boolean,
  busyAction: 'interrupt' | 'steer' | 'queue' | 'stop',
  c: { redirect: string; queueMessage: string; send: string; steer: string; stop: string }
): string {
  return busy ? { interrupt: c.redirect, queue: c.queueMessage, steer: c.steer, stop: c.stop }[busyAction] : c.send
}

function renderSteerButton(
  busy: boolean,
  busyAction: 'interrupt' | 'steer' | 'queue' | 'stop',
  onSteer: (() => void) | undefined,
  disabled: boolean,
  label: string
) {
  return busy && busyAction !== 'steer' && onSteer ? (
    <Tip label={label}>
      <Button
        aria-label={label}
        className={GHOST_ICON_BTN}
        disabled={disabled}
        onClick={onSteer}
        size="icon"
        type="button"
        variant="ghost"
      >
        <Codicon name="debug-step-over" size="0.875rem" />
      </Button>
    </Tip>
  ) : null
}

function HudWindowButtons() {
  const { t } = useI18n()

  return (
    <>
      <Tip label={t.titlebar.resetHudLayout} placement="toolbar">
        <Button
          aria-label={t.titlebar.resetHudLayout}
          className={cn(GHOST_ICON_BTN, 'p-0')}
          onClick={resetHudLayout}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Codicon name="discard" size="0.875rem" />
        </Button>
      </Tip>
      <Tip label={t.titlebar.exitHud} placement="toolbar">
        <Button
          aria-label={t.titlebar.exitHud}
          className={cn(GHOST_ICON_BTN, 'p-0')}
          onClick={closeHud}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Codicon name="screen-normal" size="0.875rem" />
        </Button>
      </Tip>
    </>
  )
}
