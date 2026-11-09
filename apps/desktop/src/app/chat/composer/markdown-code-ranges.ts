/** A half-open `[start, end)` span of the draft text. */
export interface TextRange {
  end: number
  start: number
}

export const containsIndex = (ranges: TextRange[], index: number) =>
  ranges.some(range => index >= range.start && index < range.end)

/** A backtick run preceded by an odd number of backslashes is escaped prose, not
 *  a code delimiter (`\`` reads literally). */
function isEscaped(text: string, index: number) {
  let backslashes = 0

  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    backslashes += 1
  }

  return backslashes % 2 === 1
}

/** Markdown fenced code blocks (``` or ~~~), including an unfinished block while
 *  the user is still composing one. */
function fencedCodeRanges(text: string) {
  const ranges: TextRange[] = []
  let opening: { marker: string; start: number } | undefined

  for (const match of text.matchAll(/^[ \t]{0,3}(`{3,}|~{3,})([^\r\n]*)(?:\r?\n|$)/gm)) {
    const marker = match[1]
    const tail = match[2]

    if (!opening) {
      // Backticks in a backtick fence's info string are invalid Markdown, so a
      // stray run must not turn the rest of the draft into protected code.
      if (marker[0] === '`' && tail.includes('`')) {
        continue
      }

      opening = { marker, start: match.index ?? 0 }

      continue
    }

    // A closing fence is the same character, at least as long, with nothing but
    // whitespace after it.
    if (marker[0] === opening.marker[0] && marker.length >= opening.marker.length && tail.trim() === '') {
      ranges.push({ end: (match.index ?? 0) + match[0].length, start: opening.start })
      opening = undefined
    }
  }

  if (opening) {
    ranges.push({ end: text.length, start: opening.start })
  }

  return ranges
}

/** Markdown inline code spans outside fences, including an unfinished span while
 *  the user is still composing one. Runs pair up by matching backtick length, so
 *  `` `a ` b` `` stays one span. */
function inlineCodeRanges(text: string, fenced: TextRange[], includeUnclosed = true) {
  const ranges: TextRange[] = []

  const markers = Array.from(text.matchAll(/`+/g)).filter(marker => {
    const index = marker.index ?? 0

    return !containsIndex(fenced, index) && !isEscaped(text, index)
  })

  let markerIndex = 0

  while (markerIndex < markers.length) {
    const opening = markers[markerIndex]

    const closingIndex = markers.findIndex(
      (candidate, index) => index > markerIndex && candidate[0].length === opening[0].length
    )

    if (closingIndex === -1) {
      if (includeUnclosed) {
        ranges.push({ end: text.length, start: opening.index ?? 0 })
      }

      break
    }

    const closing = markers[closingIndex]

    ranges.push({ end: (closing.index ?? 0) + closing[0].length, start: opening.index ?? 0 })
    markerIndex = closingIndex + 1
  }

  return ranges
}

/** The spans of `text` Markdown renders as code — fenced blocks plus inline
 *  spans. A URL inside one is verbatim payload (a stack trace, a log line, a
 *  command), not prose to chip, so the recognizer must leave it alone. */
export function markdownCodeRanges(text: string) {
  const fenced = fencedCodeRanges(text)

  return [...fenced, ...inlineCodeRanges(text, fenced)]
}

/** Complete single-line marks that can be painted when reopening a draft. */
export function completedInlineCodeRanges(text: string) {
  return inlineCodeRanges(text, fencedCodeRanges(text), false).filter(
    span => !text.slice(span.start, span.end).includes('\n')
  )
}
