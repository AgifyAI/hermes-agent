import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

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

  it('quotes YAML-sensitive input and keeps comments and unknown fields intact', () => {
    const source = [
      '---',
      'name: sample',
      'description: Old text # keep this comment',
      'custom:',
      '  note: test',
      '# next field comment',
      'version: 1',
      '---',
      '',
      'Body'
    ].join('\n')

    const next = updateSkillDocument(source, { description: 'note: test\n# hash' })
    const header = /^---\n([\s\S]*?)\n---/.exec(next)
    const document = parseDocument(header?.[1] ?? '')

    expect(document.errors).toHaveLength(0)
    expect(document.get('description')).toBe('note: test\n# hash')
    expect(next).toContain('# keep this comment')
    expect(next).toContain('# next field comment')
    expect(next).toContain('custom:\n  note: test')
  })
})
