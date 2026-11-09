import './skill-body-editor.css'

import type { PhrasingContent, Root, RootContent } from 'mdast'
import { type ClipboardEvent, memo, type ReactNode, useEffect, useMemo, useRef } from 'react'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

export interface SkillBodyEditorProps {
  ariaLabel?: string
  autoFocus?: boolean
  body: string
  className?: string
  onChange: (markdown: string) => void
  readOnly?: boolean
}

type MarkdownNode = Root | RootContent | PhrasingContent
type MarkdownRoot = Root

type SourceRange = { end: number; start: number }

const markdownParser = unified().use(remarkParse).use(remarkGfm)

function sourceRange(node: MarkdownNode): SourceRange | null {
  const start = node.position?.start.offset
  const end = node.position?.end.offset

  return Number.isInteger(start) && Number.isInteger(end) && start! <= end! ? { end: end!, start: start! } : null
}

function childrenOf(node: MarkdownNode): MarkdownNode[] {
  return 'children' in node ? node.children : []
}

function valueOf(node: MarkdownNode): string {
  return 'value' in node && typeof node.value === 'string' ? node.value : ''
}

function sourceOf(body: string, node: MarkdownNode): string {
  const range = sourceRange(node)

  return range ? body.slice(range.start, range.end) : valueOf(node)
}

function safeLinkHref(url: string | undefined): string | undefined {
  const value = url?.trim()

  return value && /^(?:https?:\/\/|\/|#)/i.test(value) ? value : undefined
}

function parseMarkdown(body: string): MarkdownRoot {
  return markdownParser.parse(body) as MarkdownRoot
}

function countPositionedNodes(node: MarkdownNode): number {
  return (sourceRange(node) ? 1 : 0) + childrenOf(node).reduce((count, child) => count + countPositionedNodes(child), 0)
}

function sourceNodeAttributes(node: MarkdownNode): Record<string, string> {
  const range = sourceRange(node)

  return range
    ? {
        'data-md-end': String(range.end),
        'data-md-source-node': 'true',
        'data-md-start': String(range.start)
      }
    : {}
}

function blockAttributes(body: string, node: MarkdownNode, index: number): Record<string, string> {
  const range = sourceRange(node)

  return {
    ...sourceNodeAttributes(node),
    'data-md-block-index': String(index),
    'data-md-block-node-count': String(countPositionedNodes(node)),
    'data-md-block-end': String(range?.end ?? 0),
    'data-md-block-start': String(range?.start ?? 0)
  }
}

function leafAttributes(
  node: MarkdownNode,
  value: string,
  range = sourceRange(node),
  includeSourceNode = true
): Record<string, string> {
  if (!range) {
    return {}
  }

  return {
    'data-md-end': String(range.end),
    'data-md-leaf': 'true',
    'data-md-source-value': value,
    ...(includeSourceNode ? { 'data-md-source-node': 'true' } : {}),
    'data-md-start': String(range.start)
  }
}

function fencedCodeRange(body: string, node: MarkdownNode): SourceRange | null {
  const range = sourceRange(node)

  if (!range) {
    return null
  }

  const source = body.slice(range.start, range.end)
  const openingEnd = source.indexOf('\n')
  const closingStart = source.lastIndexOf('\n')

  if (openingEnd < 0 || closingStart < openingEnd) {
    return null
  }

  return {
    // The newline before the closing fence is syntax, not part of the code
    // text shown in the editor. Leave it in the source so a normal word edit
    // cannot accidentally join the last line to the fence.
    end: range.start + closingStart - (source[closingStart - 1] === '\r' ? 1 : 0),
    start: range.start + openingEnd + 1
  }
}

function inlineCodeRange(body: string, node: MarkdownNode): SourceRange | null {
  const range = sourceRange(node)

  if (!range) {
    return null
  }

  const source = body.slice(range.start, range.end)
  const opening = /`+/.exec(source)

  if (!opening) {
    return null
  }

  const delimiterLength = opening[0].length

  if (source.length < delimiterLength * 2) {
    return null
  }

  return {
    end: range.end - delimiterLength,
    start: range.start + delimiterLength
  }
}

function fenceMetadata(body: string, node: MarkdownNode): Record<string, string> {
  const source = sourceOf(body, node)
  const lines = source.split(/\r?\n/)
  const newline = source.includes('\r\n') ? '\r\n' : '\n'

  if (!/^\s*(?:`{3,}|~{3,})/.test(lines[0] ?? '')) {
    return {}
  }

  return {
    'data-md-fence-close': lines.at(-1) ?? '```',
    'data-md-fence-newline': newline,
    'data-md-fence-open': lines[0] ?? '```'
  }
}

function listMarker(body: string, node: MarkdownNode): string {
  return /^\s*(\d+[.)]|[-+*])(?:[ \t]+)/.exec(sourceOf(body, node))?.[1] ?? '-'
}

function renderInline(body: string, nodes: MarkdownNode[] | undefined, keyPrefix: string): ReactNode[] {
  return (nodes ?? []).map((node, index) => {
    const key = `${keyPrefix}-${index}`

    if (node.type === 'text') {
      const value = valueOf(node)

      return (
        <span {...leafAttributes(node, value)} key={key}>
          {value}
        </span>
      )
    }

    if (node.type === 'inlineCode') {
      const value = valueOf(node)

      return (
        <code {...leafAttributes(node, value, inlineCodeRange(body, node))} key={key}>
          {value}
        </code>
      )
    }

    if (node.type === 'emphasis') {
      return (
        <em {...sourceNodeAttributes(node)} key={key}>
          {renderInline(body, node.children, key)}
        </em>
      )
    }

    if (node.type === 'strong') {
      return (
        <strong {...sourceNodeAttributes(node)} key={key}>
          {renderInline(body, node.children, key)}
        </strong>
      )
    }

    if (node.type === 'delete') {
      return (
        <del {...sourceNodeAttributes(node)} key={key}>
          {renderInline(body, node.children, key)}
        </del>
      )
    }

    if (node.type === 'link') {
      return (
        <a
          {...sourceNodeAttributes(node)}
          data-href={node.url ?? ''}
          draggable={false}
          href={safeLinkHref(node.url)}
          key={key}
          onClick={event => event.preventDefault()}
          rel="noreferrer"
          target="_blank"
        >
          {renderInline(body, node.children, key)}
        </a>
      )
    }

    if (node.type === 'break') {
      return <br {...sourceNodeAttributes(node)} key={key} />
    }

    if (node.type === 'image') {
      const alt = node.alt ?? ''

      return (
        <span
          {...sourceNodeAttributes(node)}
          aria-label={alt || 'Image Markdown'}
          data-md-image-alt={alt}
          data-md-image-url={node.url ?? ''}
          data-md-kind="image"
          key={key}
        >
          [{alt || 'image'}]
        </span>
      )
    }

    const value = sourceOf(body, node)

    return (
      <span {...leafAttributes(node, value)} key={key}>
        {value}
      </span>
    )
  })
}

function tableDelimiter(body: string, node: MarkdownNode): string {
  return sourceOf(body, node).split(/\r?\n/)[1] ?? '| --- |'
}

function renderTableRow(body: string, node: MarkdownNode, key: string, header: boolean): ReactNode {
  const Cell = header ? 'th' : 'td'

  return (
    <tr {...sourceNodeAttributes(node)} key={key}>
      {childrenOf(node).map((cell, index) => (
        <Cell {...sourceNodeAttributes(cell)} key={`${key}-${index}`}>
          {renderInline(body, childrenOf(cell), `${key}-${index}`)}
        </Cell>
      ))}
    </tr>
  )
}

type NodeOf<Type extends MarkdownNode['type']> = Extract<MarkdownNode, { type: Type }>
type NodeRenderer = (body: string, node: MarkdownNode, key: string, attrs: Record<string, string>) => ReactNode

function renderParagraph(body: string, node: MarkdownNode, key: string, attrs: Record<string, string>): ReactNode {
  return (
    <p {...attrs} data-md-kind="paragraph" key={key}>
      {renderInline(body, childrenOf(node), key)}
    </p>
  )
}

function renderHeading(body: string, node: MarkdownNode, key: string, attrs: Record<string, string>): ReactNode {
  const heading = node as NodeOf<'heading'>
  const depth = Math.min(6, Math.max(1, heading.depth ?? 1))
  const Tag = `h${depth}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'

  return (
    <Tag {...attrs} data-md-kind="heading" data-md-level={String(depth)} key={key}>
      {renderInline(body, childrenOf(heading), key)}
    </Tag>
  )
}

function renderBlockquote(body: string, node: MarkdownNode, key: string, attrs: Record<string, string>): ReactNode {
  return (
    <blockquote {...attrs} data-md-kind="blockquote" key={key}>
      {childrenOf(node).map((child, index) => renderNode(body, child, `${key}-${index}`))}
    </blockquote>
  )
}

function renderCode(body: string, node: MarkdownNode, key: string, attrs: Record<string, string>): ReactNode {
  const code = node as NodeOf<'code'>
  const value = valueOf(code)

  return (
    <pre {...attrs} {...fenceMetadata(body, code)} data-md-kind="code" data-md-language={code.lang ?? ''} key={key}>
      <code {...leafAttributes(code, value, fencedCodeRange(body, code), false)}>{value}</code>
    </pre>
  )
}

function renderList(body: string, node: MarkdownNode, key: string, attrs: Record<string, string>): ReactNode {
  const list = node as NodeOf<'list'>
  const Tag = list.ordered ? 'ol' : 'ul'

  return (
    <Tag
      {...attrs}
      data-md-kind="list"
      data-md-list-marker={listMarker(body, list)}
      data-md-list-start={String(list.start ?? 1)}
      data-md-ordered={String(Boolean(list.ordered))}
      key={key}
    >
      {childrenOf(list).map((child, index) => renderNode(body, child, `${key}-${index}`))}
    </Tag>
  )
}

function renderListItem(body: string, node: MarkdownNode, key: string, attrs: Record<string, string>): ReactNode {
  const item = node as NodeOf<'listItem'>
  const checked = item.checked === null || item.checked === undefined ? '' : String(item.checked)

  return (
    <li
      {...attrs}
      data-md-checked={checked}
      data-md-kind="list-item"
      data-md-list-marker={listMarker(body, item)}
      key={key}
    >
      {item.checked !== null && item.checked !== undefined && (
        <input aria-label="Élément terminé" checked={item.checked} disabled readOnly type="checkbox" />
      )}
      {childrenOf(item).map((child, index) => renderNode(body, child, `${key}-${index}`))}
    </li>
  )
}

function renderTable(body: string, node: MarkdownNode, key: string, attrs: Record<string, string>): ReactNode {
  const rows = childrenOf(node)

  return (
    <table {...attrs} data-md-delimiter={tableDelimiter(body, node)} data-md-kind="table" key={key}>
      {rows[0] && <thead>{renderTableRow(body, rows[0], `${key}-head`, true)}</thead>}
      {rows.length > 1 && (
        <tbody>{rows.slice(1).map((row, index) => renderTableRow(body, row, `${key}-row-${index}`, false))}</tbody>
      )}
    </table>
  )
}

function renderTableCell(body: string, node: MarkdownNode, key: string, attrs: Record<string, string>): ReactNode {
  return (
    <td {...attrs} key={key}>
      {renderInline(body, childrenOf(node), key)}
    </td>
  )
}

function renderRaw(body: string, node: MarkdownNode, key: string, attrs: Record<string, string>): ReactNode {
  return (
    <div {...attrs} data-md-kind="raw" key={key}>
      {sourceOf(body, node)}
    </div>
  )
}

const NODE_RENDERERS: Record<string, NodeRenderer> = {
  blockquote: renderBlockquote,
  code: renderCode,
  definition: renderRaw,
  footnoteDefinition: renderRaw,
  heading: renderHeading,
  html: renderRaw,
  list: renderList,
  listItem: renderListItem,
  paragraph: renderParagraph,
  table: renderTable,
  tableCell: renderTableCell,
  tableRow: (body, node, key) => renderTableRow(body, node, key, false),
  thematicBreak: (_body, _node, key, attrs) => <hr {...attrs} data-md-kind="thematicBreak" key={key} />,
  yaml: renderRaw
}

function renderNode(body: string, node: MarkdownNode, key: string, blockIndex?: number): ReactNode {
  const attrs = blockIndex === undefined ? sourceNodeAttributes(node) : blockAttributes(body, node, blockIndex)
  const renderer = NODE_RENDERERS[node.type] ?? renderRaw

  return renderer(body, node, key, attrs)
}

function renderRoot(body: string, root: MarkdownRoot): ReactNode[] {
  return root.children.map((node, index) => renderNode(body, node, `block-${index}`, index))
}

function integerAttribute(element: HTMLElement, name: string): number | null {
  const value = Number(element.dataset[name])

  return Number.isInteger(value) ? value : null
}

type SourceEdit = SourceRange & { value: string }

function sourceEdits(editor: HTMLElement): SourceEdit[] {
  return Array.from(editor.querySelectorAll<HTMLElement>('[data-md-leaf="true"]'))
    .map(element => {
      const start = integerAttribute(element, 'mdStart')
      const end = integerAttribute(element, 'mdEnd')
      const expected = element.dataset.mdSourceValue ?? ''
      const value = element.textContent ?? ''

      return start !== null && end !== null && value !== expected ? { end, start, value } : null
    })
    .filter((edit): edit is SourceEdit => edit !== null)
}

function updateSourceRanges(editor: HTMLElement, edit: SourceEdit, delta: number): void {
  for (const element of editor.querySelectorAll<HTMLElement>('[data-md-start][data-md-end]')) {
    const start = integerAttribute(element, 'mdStart')
    const end = integerAttribute(element, 'mdEnd')

    if (start === null || end === null) {
      continue
    }

    if (start >= edit.end) {
      element.dataset.mdStart = String(start + delta)
      element.dataset.mdEnd = String(end + delta)

      continue
    }

    if (end < edit.start) {
      continue
    }

    if (start === edit.start && end === edit.end && element.dataset.mdLeaf === 'true') {
      element.dataset.mdEnd = String(start + edit.value.length)
      element.dataset.mdSourceValue = edit.value

      continue
    }

    if (end >= edit.end) {
      element.dataset.mdEnd = String(end + delta)
    }
  }

  for (const element of editor.querySelectorAll<HTMLElement>('[data-md-block-start][data-md-block-end]')) {
    const start = integerAttribute(element, 'mdBlockStart')
    const end = integerAttribute(element, 'mdBlockEnd')

    if (start === null || end === null) {
      continue
    }

    if (start >= edit.end) {
      element.dataset.mdBlockStart = String(start + delta)
      element.dataset.mdBlockEnd = String(end + delta)
    } else if (end >= edit.end) {
      element.dataset.mdBlockEnd = String(end + delta)
    }
  }
}

function applySourceEdits(body: string, editor: HTMLElement, edits: SourceEdit[]): string {
  const ordered = [...edits].sort((left, right) => right.start - left.start)
  let next = body
  let boundary = body.length

  for (const edit of ordered) {
    if (edit.start < 0 || edit.end < edit.start || edit.end > body.length || edit.end > boundary) {
      continue
    }

    next = `${next.slice(0, edit.start)}${edit.value}${next.slice(edit.end)}`
    updateSourceRanges(editor, edit, edit.value.length - (edit.end - edit.start))
    boundary = edit.start
  }

  return next
}

function applyEditsToText(text: string, edits: SourceEdit[], offset: number): string {
  const ordered = [...edits].sort((left, right) => right.start - left.start)
  let next = text

  for (const edit of ordered) {
    const start = edit.start - offset
    const end = edit.end - offset

    if (start < 0 || end < start || end > text.length) {
      continue
    }

    next = `${next.slice(0, start)}${edit.value}${next.slice(end)}`
  }

  return next
}

function serializeInlineDom(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.nodeValue ?? ''
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return ''
  }

  const element = node as HTMLElement
  const value = Array.from(element.childNodes, serializeInlineDom).join('')

  switch (element.tagName) {
    case 'A':
      return `[${value}](${element.dataset.href ?? element.getAttribute('href') ?? ''})`

    case 'CODE':
      return `\`${value}\``

    case 'DEL':
      return `~~${value}~~`

    case 'EM':
      return `*${value}*`

    case 'STRONG':
      return `**${value}**`

    case 'BR':
      return '  \n'

    case 'IMG':
      return `![${element.getAttribute('alt') ?? ''}](${element.getAttribute('src') ?? ''})`

    default:
      if (element.dataset.mdKind === 'image') {
        return `![${element.dataset.mdImageAlt ?? ''}](${element.dataset.mdImageUrl ?? ''})`
      }

      return value
  }
}

function normalizeLineEndings(value: string, newline: string): string {
  return value.replace(/\r\n|\r|\n/g, newline)
}

function serializeBlockDom(element: HTMLElement): string {
  const kind = element.dataset.mdKind

  if (kind === 'raw') {
    return element.textContent ?? ''
  }

  if (kind === 'paragraph') {
    return Array.from(element.childNodes, serializeInlineDom).join('')
  }

  if (kind === 'heading') {
    return `${'#'.repeat(Number(element.dataset.mdLevel) || 1)} ${Array.from(element.childNodes, serializeInlineDom).join('')}`
  }

  if (kind === 'thematicBreak') {
    return '---'
  }

  if (kind === 'code') {
    const newline = element.dataset.mdFenceNewline ?? '\n'
    const opening = element.dataset.mdFenceOpen ?? `\`\`\`${element.dataset.mdLanguage ?? ''}`
    const closing = element.dataset.mdFenceClose ?? '```'
    const value = element.querySelector('code')?.textContent ?? ''

    return `${opening}${newline}${normalizeLineEndings(value, newline)}${newline}${closing}`
  }

  if (kind === 'blockquote') {
    return Array.from(element.children)
      .map(child =>
        serializeBlockDom(child as HTMLElement)
          .split('\n')
          .map(line => `> ${line}`)
          .join('\n')
      )
      .join('\n')
  }

  if (kind === 'list') {
    const ordered = element.dataset.mdOrdered === 'true'
    const firstNumber = Number(element.dataset.mdListStart)
    const marker = element.dataset.mdListMarker ?? (ordered ? '1.' : '-')

    return Array.from(element.children)
      .map((child, index) => {
        const item = child as HTMLElement

        const blocks = Array.from(item.children)
          .filter(block => block.tagName !== 'INPUT')
          .map(block => serializeBlockDom(block as HTMLElement))

        const value = blocks.length ? blocks.join('\n') : serializeInlineDom(item)

        const itemMarker = ordered
          ? `${(Number.isFinite(firstNumber) ? firstNumber : 1) + index}${marker.endsWith(')') ? ')' : '.'}`
          : item.dataset.mdListMarker || marker

        const checked = item.dataset.mdChecked === 'true' ? '[x] ' : item.dataset.mdChecked === 'false' ? '[ ] ' : ''

        return value
          .split('\n')
          .map((line, lineIndex) => (lineIndex === 0 ? `${itemMarker} ${checked}${line}` : `  ${line}`))
          .join('\n')
      })
      .join('\n')
  }

  if (kind === 'table') {
    const rows = Array.from(element.querySelectorAll('tr')).map(row => {
      const cells = Array.from(row.children).map(cell => Array.from(cell.childNodes, serializeInlineDom).join(''))

      return `| ${cells.join(' | ')} |`
    })

    const delimiter = element.dataset.mdDelimiter

    if (delimiter && rows.length > 0) {
      rows.splice(1, 0, delimiter)
    }

    return rows.join('\n')
  }

  return Array.from(element.childNodes, serializeInlineDom).join('')
}

type StructuralPart = {
  end: number | null
  index: number | null
  intact: boolean
  start: number | null
  value: string
}

function blockRange(element: HTMLElement): SourceRange | null {
  const start = integerAttribute(element, 'mdBlockStart')
  const end = integerAttribute(element, 'mdBlockEnd')

  return start !== null && end !== null && start <= end ? { end, start } : null
}

function sourceNodeCount(element: HTMLElement): number {
  return (
    (element.dataset.mdSourceNode === 'true' ? 1 : 0) + element.querySelectorAll('[data-md-source-node="true"]').length
  )
}

function intactBlock(element: HTMLElement): boolean {
  const expected = Number(element.dataset.mdBlockNodeCount)

  return Number.isInteger(expected) && expected === sourceNodeCount(element) && !hasUnmappedText(element)
}

function defaultSeparator(body: string): string {
  const newline = body.includes('\r\n') ? '\r\n' : '\n'

  return `${newline}${newline}`
}

function serializeStructure(editor: HTMLElement, body: string): string {
  const children = Array.from(editor.children)

  if (!children.length) {
    return Array.from(editor.childNodes, serializeInlineDom).join('')
  }

  const parts: StructuralPart[] = children.map(child => {
    const element = child as HTMLElement
    const range = blockRange(element)
    const index = integerAttribute(element, 'mdBlockIndex')
    const intact = range !== null && index !== null && intactBlock(element)
    const edits = range ? sourceEdits(editor).filter(edit => edit.start >= range.start && edit.end <= range.end) : []

    const value =
      intact && range
        ? applyEditsToText(body.slice(range.start, range.end), edits, range.start)
        : serializeBlockDom(element)

    return { end: range?.end ?? null, index, intact, start: range?.start ?? null, value }
  })

  const originalBlockCount = Number(editor.dataset.mdBlockCount)
  const separator = defaultSeparator(body)
  let result = parts[0]?.value ?? ''

  if (parts[0]?.intact && parts[0].index === 0 && parts[0].start !== null) {
    result = body.slice(0, parts[0].start) + result
  }

  for (let index = 1; index < parts.length; index += 1) {
    const previous = parts[index - 1]
    const current = parts[index]

    const keepSeparator =
      previous.intact &&
      current.intact &&
      previous.index !== null &&
      current.index === previous.index + 1 &&
      previous.end !== null &&
      current.start !== null

    result += (keepSeparator ? body.slice(previous.end!, current.start!) : separator) + current.value
  }

  const last = parts.at(-1)

  if (last?.intact && last.index === originalBlockCount - 1 && last.end !== null) {
    result += body.slice(last.end)
  }

  return result
}

function hasUnmappedText(editor: HTMLElement): boolean {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()

  while (node) {
    if (
      node.textContent &&
      !node.parentElement?.closest('[data-md-leaf="true"], [data-md-kind="raw"], [data-md-kind="image"]')
    ) {
      return true
    }

    node = walker.nextNode()
  }

  return false
}

function insertPlainTextAtSelection(editor: HTMLElement, text: string): boolean {
  const selection = window.getSelection()

  if (!selection || !selection.rangeCount) {
    return false
  }

  const range = selection.getRangeAt(0)

  if (!editor.contains(range.commonAncestorContainer)) {
    return false
  }

  range.deleteContents()
  const fragment = document.createDocumentFragment()
  const lines = text.replace(/\r\n|\r/g, '\n').split('\n')

  lines.forEach((line, index) => {
    if (index > 0) {
      fragment.append(document.createTextNode('\n'))
    }

    fragment.append(document.createTextNode(line))
  })
  range.insertNode(fragment)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
  editor.dispatchEvent(new Event('input', { bubbles: true }))

  return true
}

/** Apply exact source-range replacements and only use DOM Markdown serialization for structural edits. */
export function serializeSkillBody(editor: HTMLElement, body: string): string {
  const edits = sourceEdits(editor)
  const expectedNodes = Number(editor.dataset.mdNodeCount)
  const currentNodes = editor.querySelectorAll('[data-md-source-node="true"]').length

  if (expectedNodes === currentNodes && !hasUnmappedText(editor)) {
    return edits.length ? applySourceEdits(body, editor, edits) : body
  }

  return serializeStructure(editor, body)
}

export const SkillBodyEditor = memo(function SkillBodyEditor({
  ariaLabel = 'Instructions du skill',
  autoFocus = false,
  body,
  className,
  onChange,
  readOnly = false
}: SkillBodyEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const emittedBodyRef = useRef(body)
  const sourceBodyRef = useRef(body)
  const renderedBodyRef = useRef(body)

  // The parent stores each input as a draft. Keep the live DOM untouched for
  // that own update; replace it only when a different document arrives.
  if (body !== emittedBodyRef.current) {
    sourceBodyRef.current = body
    emittedBodyRef.current = body
    renderedBodyRef.current = body
  }

  const renderedBody = renderedBodyRef.current
  const root = useMemo(() => parseMarkdown(renderedBody), [renderedBody])

  useEffect(() => {
    if (autoFocus) {
      editorRef.current?.focus()
    }
  }, [autoFocus])

  const handleInput = () => {
    if (readOnly || !editorRef.current) {
      return
    }

    const next = serializeSkillBody(editorRef.current, sourceBodyRef.current)
    sourceBodyRef.current = next
    emittedBodyRef.current = next
    onChange(next)
  }

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (readOnly) {
      return
    }

    event.preventDefault()
    const text = event.clipboardData.getData('text/plain')

    if (text) {
      insertPlainTextAtSelection(event.currentTarget, text)
    }
  }

  return (
    <div
      aria-label={ariaLabel}
      aria-multiline="true"
      className={className ?? 'skill-body-editor'}
      contentEditable={!readOnly}
      data-md-block-count={root.children.length}
      data-md-editor="skill-body"
      data-md-node-count={countPositionedNodes(root) - (sourceRange(root) ? 1 : 0)}
      onClick={event => {
        if ((event.target as HTMLElement).closest('a')) {
          event.preventDefault()
        }
      }}
      onInput={handleInput}
      onPaste={handlePaste}
      ref={editorRef}
      role="textbox"
      spellCheck
      suppressContentEditableWarning
    >
      {renderRoot(renderedBody, root)}
    </div>
  )
})
