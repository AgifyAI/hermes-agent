import { describe, expect, it } from 'vitest'

import { compareSkillText } from './skill-version-comparison'

describe('skill version comparison', () => {
  it('highlights a new source line in a large skill while keeping the remaining instructions aligned', () => {
    const instructions = Array.from({ length: 900 }, (_, index) => `Instruction ${index + 1}`)
    const source = [...instructions.slice(0, 350), 'Nouvelle consigne', ...instructions.slice(350)]
    const compared = compareSkillText(source.join('\r\n'), instructions.join('\n'))

    expect(compared.source.filter(line => line.kind !== 'context')).toEqual([
      { kind: 'add', text: 'Nouvelle consigne' }
    ])
    expect(compared.installed[350]).toEqual({ kind: 'context', text: '' })
    expect(compared.source.slice(351)).toEqual(compared.installed.slice(351))
  })

  it('shows the installed instruction that would be replaced beside its new source text', () => {
    const compared = compareSkillText('Avant\nTexte source\nAprès', 'Avant\nTexte installé\nAprès')

    expect(compared.source[1]).toEqual({ kind: 'add', text: 'Texte source' })
    expect(compared.installed[1]).toEqual({ kind: 'remove', text: 'Texte installé' })
  })
})
