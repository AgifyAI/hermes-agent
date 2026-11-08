import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ChatBarState } from '@/app/chat/composer/types'
import { I18nProvider } from '@/i18n'
import { $hudMode } from '@/store/hud'

import { ComposerControls } from './controls'

vi.mock('./model-pill', () => ({ ModelPill: () => null }))

const state: ChatBarState = {
  model: { canSwitch: false, model: '', provider: '' },
  tools: { enabled: false, label: '' },
  voice: { active: false, enabled: false }
}

function renderControls(overrides: Partial<React.ComponentProps<typeof ComposerControls>> = {}) {
  return render(
    <I18nProvider configClient={null} initialLocale="en">
      <ComposerControls
        busy={false}
        busyAction="stop"
        canSubmit={true}
        disabled={false}
        hasComposerPayload={true}
        onQueue={vi.fn()}
        state={state}
        {...overrides}
      />
    </I18nProvider>
  )
}

async function expectShortcutTooltip(label: string, shortcut: string) {
  fireEvent.pointerMove(screen.getByLabelText(label), { pointerType: 'mouse' })

  const tooltip = await screen.findByRole('tooltip')

  expect(tooltip.textContent).toContain(label)
  expect(tooltip.textContent).toContain(shortcut)
}

afterEach(() => {
  cleanup()
  $hudMode.set(false)
})

// Voice controls are intentionally absent from the composer. HUD controls stay
// available because they manage the window itself.
describe('HUD mode', () => {
  it('does not render voice controls in the docked composer', () => {
    renderControls()

    expect(screen.queryByLabelText('Voice dictation')).toBeNull()
    expect(screen.queryByLabelText('Read replies aloud')).toBeNull()
    expect(screen.queryByLabelText('Wake word "hey hermes"')).toBeNull()
    expect(screen.queryByLabelText('Exit HUD mode')).toBeNull()
    expect(screen.queryByLabelText('Reset HUD size and position')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Voice' })).toBeNull()
  })

  it('offers the way out in the HUD', () => {
    $hudMode.set(true)
    renderControls()

    expect(screen.getByLabelText('Reset HUD size and position')).toBeTruthy()
    expect(screen.getByLabelText('Exit HUD mode')).toBeTruthy()
  })
})

// A tile can be narrower than the controls cost, and the row is inside an
// overflow-hidden surface. The Send button remains reachable at every width.
describe('narrow tiles', () => {
  it('does not render voice controls without entering HUD mode', () => {
    renderControls()

    expect(screen.queryByLabelText('Voice dictation')).toBeNull()
    expect(screen.queryByLabelText('Read replies aloud')).toBeNull()

    // Folding is a width decision, not the HUD: no exit affordance appears.
    expect(screen.queryByLabelText('Exit HUD mode')).toBeNull()
  })

  it('keeps Send at the tightest width, with everything else dropped', () => {
    renderControls({ minimal: true })

    expect(screen.getByLabelText('Send')).toBeTruthy()
  })

  it('keeps Stop reachable mid-turn at the tightest width', () => {
    renderControls({ busy: true, busyAction: 'stop', hasComposerPayload: false, minimal: true })

    expect(screen.getByLabelText('Stop')).toBeTruthy()
  })
})

describe('ComposerControls shortcut tooltips', () => {
  it('labels busy Send with the effective configured action', async () => {
    renderControls({ busy: true, busyAction: 'steer' })

    await expectShortcutTooltip('Steer the current run', '↵')
  })

  it('shows Stop only when the composer is empty mid-turn', async () => {
    renderControls({ busy: true, busyAction: 'stop', canSubmit: true, hasComposerPayload: false })

    await expectShortcutTooltip('Stop', '↵')
  })

  it('answers a waiting card with Send when the draft has text, and offers no Queue', () => {
    renderControls({ busy: true, busyAction: 'queue', cardWaiting: true, hasComposerPayload: true })

    expect(screen.getByLabelText('Send')).toBeTruthy()
    expect(screen.queryByLabelText('Stop')).toBeNull()
    expect(screen.queryByLabelText('Queue message')).toBeNull()
  })

  it('keeps Stop enabled while a card waits and the draft is empty', () => {
    renderControls({ busy: true, busyAction: 'stop', canSubmit: true, cardWaiting: true, hasComposerPayload: false })

    expect(screen.getByLabelText('Stop').hasAttribute('disabled')).toBe(false)
  })

  it('shows Ctrl+Enter for Queue as the secondary mid-turn action', async () => {
    renderControls({ busy: true, busyAction: 'interrupt' })

    await expectShortcutTooltip('Queue message', 'Ctrl+↵')
  })

  it('hides Queue while idle even if the composer has a payload', () => {
    renderControls({ busy: false, busyAction: 'queue', hasComposerPayload: true })

    expect(screen.queryByLabelText('Queue message')).toBeNull()
    expect(screen.getByLabelText('Send')).toBeTruthy()
  })
})
