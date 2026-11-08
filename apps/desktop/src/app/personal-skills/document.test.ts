import { describe, expect, it } from 'vitest'

import { parseSkillDocument, updateSkillDocument } from './document'

describe('personal skill documents', () => {
  it('separates instructions from frontmatter metadata', () => {
    const parsed = parseSkillDocument('---\nname: sample\ndescription: First line\n---\n\n# Instructions')

    expect(parsed.metadata).toEqual([
      { key: 'name', value: 'sample' },
      { key: 'description', value: 'First line' }
    ])
    expect(parsed.body).toBe('\n# Instructions')
  })

  it('updates one metadata value and the body without dropping unknown YAML', () => {
    const source = [
      '---',
      'name: sample',
      'description: First line',
      'author: Someone else',
      'custom:',
      '  keep: this',
      '---',
      '',
      '# Instructions',
      '',
      'Do the work.'
    ].join('\n')

    const next = updateSkillDocument(source, { description: 'Updated description' }, '\n# Updated instructions')

    expect(next).toContain('name: sample')
    expect(next).toContain('description: Updated description')
    expect(next).toContain('author: Someone else')
    expect(next).toContain('custom:\n  keep: this')
    expect(next.endsWith('\n# Updated instructions')).toBe(true)
  })

  it('keeps a quoted metadata field valid when its value changes', () => {
    const source = '---\nname: sample\ndescription: "First line"\n---\n\nBody'
    const next = updateSkillDocument(source, { description: 'A "quoted" description' })

    expect(next).toContain('description: "A \\"quoted\\" description"')
    expect(next).toContain('\n\nBody')
  })
})
