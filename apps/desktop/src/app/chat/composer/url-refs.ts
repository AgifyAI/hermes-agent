/**
 * Bare-link recognition for the composer. A link the user pastes or types is the
 * same thing the "+ → Add URL" dialog inserts, so it becomes an `@url:`
 * directive: a chip that truncates instead of a wall of URL text, and a
 * reference the gateway resolves.
 */
import type { KeyboardEvent } from 'react'

import { containsIndex, markdownCodeRanges, type TextRange } from './markdown-code-ranges'
import { quoteRefValue, REF_RE, refChipElement, replaceBeforeCaret } from './rich-editor'
import { textBeforeCaret } from './text-utils'

// An explicit scheme only — `example.com` bare is too easy to hit by accident
// (a filename, a version, a sentence). Brackets and quotes fence a URL in prose;
// parens don't, so they stay in and an unbalanced tail is trimmed below.
const URL_RE = /https?:\/\/[^\s<>[\]{}"'`]+/gi
// Anchored, non-global twin for the whole-payload check: `exec` on the shared
// global `URL_RE` would leave its `lastIndex` past the match, and `matchAll`
// inherits that offset, so the `linkifyUrls` call later in the same paste
// handler would start scanning after the link and chip nothing.
const EXACT_URL_RE = /^https?:\/\/[^\s<>[\]{}"'`]+$/i
const TYPED_URL_RE = /(?:^|\s)(https?:\/\/[^\s<>[\]{}"'`]+)$/i

/** True when a `[` that nothing has closed precedes the `]` at `index` on the
 *  same line, so the `](` there really ends a link label. Brackets pair by
 *  depth, so `[a [b] c](` reads as one label. */
function hasLabelOpenerBefore(text: string, index: number) {
  let depth = 0

  for (let cursor = index - 1; cursor >= 0 && text[cursor] !== '\n'; cursor -= 1) {
    const char = text[cursor]

    if (char === ']') {
      depth += 1
    } else if (char === '[') {
      if (depth === 0) {
        return true
      }

      depth -= 1
    }
  }

  return false
}

/** Markdown inline link destinations — the `(dest)` of `[label](dest)`. A
 *  destination is link syntax the user wrote or pasted, not prose to chip:
 *  rewriting it into an `@url:` reference leaves the link pointing at a
 *  reference marker instead of the href, and the rendered link breaks. An
 *  unclosed `](` still being composed takes the rest of the line, so a link
 *  typed by hand isn't chipped mid-destination either. */
function markdownLinkDestinationRanges(text: string) {
  const ranges: TextRange[] = []

  for (const match of text.matchAll(/\]\(/g)) {
    const open = (match.index ?? 0) + 1

    if (!hasLabelOpenerBefore(text, match.index ?? 0)) {
      continue
    }

    // Parentheses pair inside the destination, so a Wikipedia-style URL keeps
    // its own `(b)` and the span still ends at the link's closing paren.
    let depth = 1
    let cursor = open + 1

    while (cursor < text.length && text[cursor] !== '\n' && depth > 0) {
      depth += text[cursor] === '(' ? 1 : text[cursor] === ')' ? -1 : 0
      cursor += 1
    }

    ranges.push({ end: cursor, start: open + 1 })
  }

  return ranges
}

/** A URL at the end of a sentence carries the punctuation that ended it. */
function splitUrlTail(raw: string) {
  let url = raw.replace(/[,.;:!?]+$/, '')

  while (url.endsWith(')') && url.split(')').length > url.split('(').length) {
    url = url.slice(0, -1)
  }

  return { trailing: raw.slice(url.length), url }
}

/** A URL needs a valid HTTP(S) authority and host to be worth treating as a URL reference. */
export const hasHttpUrlHost = (url: string) => {
  try {
    const parsed = new URL(splitUrlTail(url).url)

    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.hostname)
  } catch {
    return false
  }
}

/** Rewrite bare links in `text` as `@url:` directives, leaving links that are
 *  already part of a directive alone. Returns `text` unchanged when there are
 *  none. */
export function linkifyUrls(text: string) {
  REF_RE.lastIndex = 0

  // URLs inside an existing `@url:` directive, a Markdown code span, or a
  // Markdown link destination are not prose to chip — the directive is already
  // a reference, code is verbatim payload the user pasted (a stack trace, a
  // command, a log line), and a link destination is the href of a link the
  // user wrote.
  const protectedRanges = Array.from(text.matchAll(REF_RE)).map(match => {
    const start = match.index ?? 0

    return { end: start + match[0].length, start }
  })

  protectedRanges.push(...markdownCodeRanges(text))
  protectedRanges.push(...markdownLinkDestinationRanges(text))

  let out = ''
  let cursor = 0

  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0
    const { url } = splitUrlTail(match[0])

    if (!hasHttpUrlHost(url) || containsIndex(protectedRanges, start)) {
      continue
    }

    out += `${text.slice(cursor, start)}@url:${quoteRefValue(url)}`
    cursor = start + url.length
  }

  return out + text.slice(cursor)
}

/** The href to apply when a clipboard payload is exactly ONE supported link —
 *  a bare or `<…>`-wrapped `http(s)` URL with a host and nothing else. Null for
 *  anything that isn't a lone link (prose, multiple links, trailing text), so
 *  callers fall through to the normal paste pipeline. Ported from
 *  block/buzz#6684's `resolveExactLinkPaste`. */
export function resolveExactLinkPaste(raw: string): string | null {
  const text = raw.trim()
  const unwrapped = text.startsWith('<') && text.endsWith('>') && text.length > 2 ? text.slice(1, -1).trim() : text

  if (!EXACT_URL_RE.test(unwrapped)) {
    return null
  }

  const { trailing, url } = splitUrlTail(unwrapped)

  // Trailing sentence punctuation means the user copied prose, not a link.
  if (trailing || !hasHttpUrlHost(url)) {
    return null
  }

  return url
}

/** The selected composer text a link paste should hyperlink, or null when the
 *  selection can't take a link mark: collapsed, outside `editor`, spanning
 *  chips or line breaks, or whitespace-only. */
export function selectionLinkLabel(editor: HTMLElement): string | null {
  const selection = window.getSelection()

  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null
  }

  const range = selection.getRangeAt(0)

  if (!editor.contains(range.commonAncestorContainer)) {
    return null
  }

  const probe = document.createElement('div')

  probe.append(range.cloneContents())

  // A chip inside the selection is a directive, not prose — linking over it
  // would destroy the reference. Multi-line selections don't read as a label.
  if (probe.querySelector('[data-ref-text], br')) {
    return null
  }

  const label = probe.textContent?.replace(/\s+/g, ' ').trim() ?? ''

  return label || null
}

/** Markdown link for a paste-over-selection: the label the user selected, the
 *  URL they pasted. Square brackets in the label are escaped so the link
 *  survives markdown parsing downstream. */
export function markdownLinkFor(label: string, url: string): string {
  return `[${label.replace(/([[\]])/g, '\\$1')}](${url})`
}

/** A plain space finishing a typed link commits it as a chip (followed by
 *  whatever punctuation ended it, then the space). Returns whether it ran, so a
 *  keydown handler can fall through on anything else. */
export function chipTypedUrlOnSpace(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== ' ' || event.metaKey || event.ctrlKey || event.altKey) {
    return false
  }

  const editor = event.currentTarget

  // Runs on every space, so bail on the cheap native read before paying for the
  // caret range walk (same guard shape as the trigger detector).
  if (!editor.textContent?.includes('://')) {
    return false
  }

  const before = textBeforeCaret(editor)

  if (!before) {
    return false
  }

  const match = TYPED_URL_RE.exec(before)
  const token = match?.[1]

  if (!token) {
    return false
  }

  // A link typed inside a code block or span is verbatim payload, not prose —
  // chipping it would rewrite code the user is authoring. Same for a URL being
  // typed into a link destination the user is still composing.
  if (containsIndex(markdownCodeRanges(before), before.length - token.length)) {
    return false
  }

  if (containsIndex(markdownLinkDestinationRanges(before), before.length - token.length)) {
    return false
  }

  const { trailing, url } = splitUrlTail(token)

  if (!hasHttpUrlHost(url)) {
    return false
  }

  const fragment = document.createDocumentFragment()

  fragment.append(refChipElement('url', quoteRefValue(url)))

  if (trailing) {
    fragment.append(document.createTextNode(trailing))
  }

  fragment.append(document.createTextNode(' '))

  return replaceBeforeCaret(editor, token.length, fragment)
}
