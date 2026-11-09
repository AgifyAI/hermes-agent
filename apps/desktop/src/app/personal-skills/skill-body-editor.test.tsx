import { fireEvent, render } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { serializeSkillBody, SkillBodyEditor } from './skill-body-editor'

describe('SkillBodyEditor', () => {
  it('keeps the exact Markdown source when it is only focused or read', () => {
    const body =
      '#  Heading  ##\r\n\r\nA **bold** [link](https://example.test)\r\n\r\n| A | B |\r\n| :- | -: |\r\n| 1 | 2 |\r\n\r\n```ts\r\n  const value = 1\r\n```'

    const onChange = vi.fn()
    const { container } = render(<SkillBodyEditor body={body} onChange={onChange} />)
    const editor = container.querySelector('[data-md-editor="skill-body"]') as HTMLElement

    fireEvent.focus(editor)

    expect(onChange).not.toHaveBeenCalled()
    expect(serializeSkillBody(editor, body)).toBe(body)
  })

  it('replaces only the changed heading text and preserves its Markdown spacing', () => {
    const body = '#  Heading  ##\n\nParagraph with  two spaces.'
    const onChange = vi.fn()
    const { container } = render(<SkillBodyEditor body={body} onChange={onChange} />)
    const editor = container.querySelector('[data-md-editor="skill-body"]') as HTMLElement
    const headingText = editor.querySelector('h1 [data-md-leaf="true"]') as HTMLElement

    headingText.textContent = 'Updated'
    fireEvent.input(editor)

    expect(onChange).toHaveBeenLastCalledWith('#  Updated  ##\n\nParagraph with  two spaces.')
  })

  it('keeps inline-code delimiters when the code text changes', () => {
    const body = 'Use `` exact `syntax` `` in this sentence.'
    const onChange = vi.fn()
    const { container } = render(<SkillBodyEditor body={body} onChange={onChange} />)
    const editor = container.querySelector('[data-md-editor="skill-body"]') as HTMLElement
    const code = editor.querySelector('code[data-md-leaf="true"]') as HTMLElement

    code.textContent = 'updated'
    fireEvent.input(editor)

    expect(onChange).toHaveBeenLastCalledWith('Use ``updated`` in this sentence.')
  })

  it('does not replace the live DOM when the parent stores each input immediately', () => {
    const initial = '# Title\n\nParagraph'

    function ControlledEditor() {
      const [body, setBody] = useState(initial)

      return <SkillBodyEditor body={body} onChange={setBody} />
    }

    const { container } = render(<ControlledEditor />)
    const editor = container.querySelector('[data-md-editor="skill-body"]') as HTMLElement
    const title = editor.querySelector('h1 [data-md-leaf="true"]') as HTMLElement

    title.textContent = 'Changed'
    fireEvent.input(editor)

    expect(editor.querySelector('h1')?.textContent).toBe('Changed')
  })

  it('does not load Markdown images and keeps unsafe link URLs as source data', () => {
    const body = '![preview](https://example.test/image.png) [safe](https://example.test) [unsafe](javascript:alert(1))'
    const { container } = render(<SkillBodyEditor body={body} onChange={vi.fn()} />)
    const editor = container.querySelector('[data-md-editor="skill-body"]') as HTMLElement

    expect(editor.querySelector('img')).toBeNull()
    expect(editor.querySelector('[data-md-kind="image"]')?.getAttribute('data-md-image-url')).toBe(
      'https://example.test/image.png'
    )
    expect(editor.querySelector('a[href="https://example.test"]')).not.toBeNull()
    expect(editor.querySelector('a[href^="javascript:"]')).toBeNull()
  })

  it('accepts a first paragraph in an empty skill and preserves pasted line breaks', () => {
    const onChange = vi.fn()
    const { container } = render(<SkillBodyEditor body="" onChange={onChange} />)
    const editor = container.querySelector('[data-md-editor="skill-body"]') as HTMLElement

    editor.textContent = 'First line\nSecond line'
    fireEvent.input(editor)

    expect(onChange).toHaveBeenLastCalledWith('First line\nSecond line')
  })

  it('handles paste as plain text even when the clipboard also exposes HTML', () => {
    const body = 'Before'
    const onChange = vi.fn()
    const { container } = render(<SkillBodyEditor body={body} onChange={onChange} />)
    const editor = container.querySelector('[data-md-editor="skill-body"]') as HTMLElement
    const leaf = editor.querySelector('[data-md-leaf="true"]') as HTMLElement
    const selection = window.getSelection()!
    const range = globalThis.document.createRange()
    range.selectNodeContents(leaf)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)

    const clipboardData = {
      getData: (type: string) => (type === 'text/plain' ? ' pasted\ntext' : '<strong>pasted</strong>')
    }

    fireEvent.paste(editor, { clipboardData })

    expect(onChange).toHaveBeenLastCalledWith('Before pasted\ntext')
    expect(editor.querySelector('strong')).toBeNull()
  })

  it('falls back to the visible blocks when Enter or a multi-block selection changes structure', () => {
    const onChange = vi.fn()
    const { container } = render(<SkillBodyEditor body="First paragraph\n\nSecond paragraph" onChange={onChange} />)
    const editor = container.querySelector('[data-md-editor="skill-body"]') as HTMLElement

    editor.innerHTML = '<p>First paragraph</p><p>Inserted paragraph</p>'
    fireEvent.input(editor)
    expect(onChange).toHaveBeenLastCalledWith('First paragraph\n\nInserted paragraph')

    editor.innerHTML = '<p>Only paragraph remains</p>'
    fireEvent.input(editor)
    expect(onChange).toHaveBeenLastCalledWith('Only paragraph remains')
  })

  it('keeps a structured document and paragraph formatting after Enter creates a duplicated block', () => {
    const body = '## Lire le document\nIdentifier sa thèse.\n\n## Étape suivante\nComparer les sources.'
    const onChange = vi.fn()
    const { container, unmount } = render(<SkillBodyEditor body={body} onChange={onChange} />)
    const editor = container.querySelector('[data-md-editor="skill-body"]') as HTMLElement
    const paragraph = editor.querySelectorAll('p')[0]
    const inserted = paragraph.cloneNode(true) as HTMLElement
    inserted.querySelector('[data-md-leaf="true"]')!.textContent = 'Texte ajouté'
    paragraph.after(inserted)

    fireEvent.input(editor)

    const next = onChange.mock.lastCall?.[0] as string
    expect(next).toBe(
      '## Lire le document\nIdentifier sa thèse.\n\nTexte ajouté\n\n## Étape suivante\nComparer les sources.'
    )

    unmount()
    const reopened = render(<SkillBodyEditor body={next} onChange={onChange} />)
    const reopenedEditor = reopened.container.querySelector('[data-md-editor="skill-body"]') as HTMLElement
    expect(Array.from(reopenedEditor.children).map(element => element.tagName)).toEqual(['H2', 'P', 'P', 'H2', 'P'])
    expect(reopenedEditor.textContent).toContain('Texte ajouté')
    expect(serializeSkillBody(reopenedEditor, next)).toBe(next)
  })

  it('keeps untouched CRLF blocks, task markers, ordered starts and four-backtick metadata after an insertion', () => {
    const body =
      '# Stable\r\n\r\nBefore  **unchanged**\r\n\r\n````python {#example}\r\n    keep_indentation()\r\n````\r\n\r\n- [ ] todo\r\n- [x] done\r\n\r\n7. seven\r\n8. eight\r\n\r\n![preview](data:image/png;base64,AAAA)\r\n\r\nAfter'

    const onChange = vi.fn()
    const { container } = render(<SkillBodyEditor body={body} onChange={onChange} />)
    const editor = container.querySelector('[data-md-editor="skill-body"]') as HTMLElement
    const code = editor.querySelector('pre[data-md-kind="code"]') as HTMLElement
    const inserted = globalThis.document.createElement('p')
    inserted.textContent = 'Inserted with Enter'
    code.before(inserted)
    code.querySelector('code')!.textContent = '    changed_indentation()'

    fireEvent.input(editor)

    const next = onChange.mock.lastCall?.[0] as string
    expect(next).toBe(
      '# Stable\r\n\r\nBefore  **unchanged**\r\n\r\nInserted with Enter\r\n\r\n````python {#example}\r\n    changed_indentation()\r\n````\r\n\r\n- [ ] todo\r\n- [x] done\r\n\r\n7. seven\r\n8. eight\r\n\r\n![preview](data:image/png;base64,AAAA)\r\n\r\nAfter'
    )
  })

  it('edits table cells and fenced code without rewriting delimiters or indentation', () => {
    const body = '| A  | B |\r\n| :- | -: |\r\n| 1  | 2 |\r\n\r\n```python\r\n    indented()\r\n```'
    const onChange = vi.fn()
    const { container } = render(<SkillBodyEditor body={body} onChange={onChange} />)
    const editor = container.querySelector('[data-md-editor="skill-body"]') as HTMLElement
    const cell = editor.querySelector('tbody td [data-md-leaf="true"]') as HTMLElement
    const code = editor.querySelector('pre code[data-md-leaf="true"]') as HTMLElement

    cell.textContent = 'changed'
    fireEvent.input(editor)
    expect(onChange).toHaveBeenLastCalledWith(
      '| A  | B |\r\n| :- | -: |\r\n| changed  | 2 |\r\n\r\n```python\r\n    indented()\r\n```'
    )

    code.textContent = '  changed()'
    fireEvent.input(editor)
    expect(onChange).toHaveBeenLastCalledWith(
      '| A  | B |\r\n| :- | -: |\r\n| changed  | 2 |\r\n\r\n```python\r\n  changed()\r\n```'
    )
  })
})
