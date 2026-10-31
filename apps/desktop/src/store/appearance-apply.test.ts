import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { registerLayoutPresets } from '@/app/contrib/layout-presets'
import { $activePresetId } from '@/components/pane-shell/tree/store'
import { $pendingModeApply } from '@/themes/request'

import { applyAppearance } from './appearance-apply'
import { $interfaceMode, setInterfaceMode } from './interface-mode'

describe('applyAppearance', () => {
  beforeAll(() => {
    registerLayoutPresets()
  })

  afterEach(() => {
    $pendingModeApply.set(null)
  })

  it('applies every value and reports the ids the agent reads', () => {
    setInterfaceMode('simple')

    expect(applyAppearance({ accent: 'theme', layout: 'terminal-deck', mode: 'dark' })).toEqual({
      applied: { layout: 'terminal-deck', mode: 'dark' },
      success: true
    })
    expect($pendingModeApply.get()).toBe('dark')
    expect($activePresetId.get()).toBe('terminal-deck')
    expect($interfaceMode.get()).toBe('advanced')
  })

  it('refuses an accent colour without touching the mode: the look is Linear only', () => {
    const answer = applyAppearance({ accent: 'violet', mode: 'dark' })

    expect(answer).toMatchObject({ available: ['theme'], success: false })
    expect($pendingModeApply.get()).toBeNull()
  })

  it('applies nothing when one value is unknown, and names what exists', () => {
    const answer = applyAppearance({ layout: 'cockpit', mode: 'dark' })

    expect(answer.success).toBe(false)
    expect(!answer.success && answer.available).toEqual(expect.arrayContaining(['sidebar-left', 'terminal-deck']))
    expect($pendingModeApply.get()).toBeNull()
  })
})
