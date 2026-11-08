import { describe, expect, it } from 'vitest'

import { en } from '@/i18n/en'

import { defaultBindings, KEYBIND_ACTIONS, keybindAction, keybindActionAllowedInEditableTarget } from './actions'

// Relationship checks between the action table and its consumers, not the
// specific chord or wording any one action ships with.
describe('KEYBIND_ACTIONS', () => {
  it('has unique ids (a duplicate would shadow a row in the shortcuts panel)', () => {
    const ids = KEYBIND_ACTIONS.map(action => action.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every built-in action an English label so it renders in the shortcuts panel', () => {
    const labels = en.keybinds.actions as Record<string, string>
    const missing = KEYBIND_ACTIONS.filter(action => !labels[action.id]).map(action => action.id)

    expect(missing).toEqual([])
  })

  it('keeps session archive registered and unbound by default', () => {
    const action = keybindAction('session.archive')

    expect(action).toMatchObject({ category: 'session', defaults: [] })
    expect(defaultBindings()['session.archive']).toEqual([])
    expect(en.keybinds.actions['session.archive']).toBe('Archive current session')
    expect(KEYBIND_ACTIONS.filter(candidate => candidate.id === 'session.archive')).toHaveLength(1)
  })

  it('does not register Desktop voice actions', () => {
    expect(keybindAction('composer.voice')).toBeUndefined()
    expect(keybindAction('composer.dictate')).toBeUndefined()
    expect(defaultBindings()).not.toHaveProperty('composer.voice')
    expect(defaultBindings()).not.toHaveProperty('composer.dictate')
  })

  // #71627: reasoning level up/down ship unbound (users pick their own chord)
  // and opt into firing from an editable target on MODIFIED combos only.
  it('registers reasoning level actions unbound, editable on modified combos only', () => {
    for (const id of ['composer.reasoningUp', 'composer.reasoningDown'] as const) {
      expect(keybindAction(id)).toMatchObject({ category: 'composer', defaults: [], editableTargetPolicy: 'modified' })
      expect(defaultBindings()[id]).toEqual([])
      expect(en.keybinds.actions[id]).toBeTruthy()
    }

    expect(keybindActionAllowedInEditableTarget('composer.reasoningUp', 'alt+.')).toBe(true)
    expect(keybindActionAllowedInEditableTarget('composer.reasoningDown', 'mod+alt+down')).toBe(true)
    // Bare / shift-only rebinds must never hijack typing.
    expect(keybindActionAllowedInEditableTarget('composer.reasoningUp', '.')).toBe(false)
    expect(keybindActionAllowedInEditableTarget('composer.reasoningUp', 'shift+.')).toBe(false)
    // Actions without the policy never qualify, modified combo or not.
    expect(keybindActionAllowedInEditableTarget('appearance.toggleMode', 'alt+x')).toBe(false)
  })
})

describe('view.tabSlot.N layers over profile.switch.N on ⌘1…⌘9 (#92569)', () => {
  it('both actions ship on mod+N; the tab slot passes through, the profile switch does not', () => {
    // Over a tab strip the chord is "tab N"; with no eligible strip the tab
    // action declines and the same chord is "profile N". Two actions, one
    // chord: rebinding either changes only that one.
    for (let slot = 1; slot <= 9; slot += 1) {
      expect(defaultBindings()[`view.tabSlot.${slot}`]).toEqual([`mod+${slot}`])
      expect(defaultBindings()[`profile.switch.${slot}`]).toEqual([`mod+${slot}`])
      expect(keybindAction(`view.tabSlot.${slot}`)).toMatchObject({ category: 'view', passthrough: true })
      expect(keybindAction(`profile.switch.${slot}`)?.passthrough).toBeUndefined()
    }
  })

  it('tab-slot actions precede profile switchers so the chord reaches the tab first', () => {
    // The combo index is built in KEYBIND_ACTIONS order; the passthrough
    // action must sit ahead of the one it hands off to.
    const ids = KEYBIND_ACTIONS.map(action => action.id)
    const firstTabSlot = ids.indexOf('view.tabSlot.1')
    const firstProfileSwitch = ids.indexOf('profile.switch.1')

    expect(firstTabSlot).toBeGreaterThanOrEqual(0)
    expect(firstProfileSwitch).toBeGreaterThan(firstTabSlot)
  })
})
