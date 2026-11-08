export interface SkillMetadataField {
  key: string
  value: string
}

export interface ParsedSkillDocument {
  body: string
  metadata: SkillMetadataField[]
}

interface FrontmatterField extends SkillMetadataField {
  endLine: number
  firstValue: string
  startLine: number
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
const TOP_LEVEL_FIELD_RE = /^(\w[\w-]*):(?:[ \t]?(.*))?$/

function frontmatterParts(content: string): { body: string; header: RegExpExecArray; newline: string } | null {
  const header = FRONTMATTER_RE.exec(content)

  if (!header) {
    return null
  }

  return {
    body: content.slice(header[0].length),
    header,
    newline: header[0].includes('\r\n') ? '\r\n' : '\n'
  }
}

function frontmatterFields(frontmatter: string): FrontmatterField[] {
  const lines = frontmatter.split(/\r?\n/)
  const fields: FrontmatterField[] = []
  let current: FrontmatterField | null = null

  const flush = (endLine: number) => {
    if (current) {
      current.endLine = endLine
      fields.push(current)
    }
  }

  lines.forEach((line, lineNumber) => {
    const match = TOP_LEVEL_FIELD_RE.exec(line)

    if (match) {
      flush(lineNumber)
      current = {
        endLine: lines.length,
        firstValue: match[2] ?? '',
        key: match[1],
        startLine: lineNumber,
        value: match[2] ?? ''
      }

      return
    }

    if (current) {
      current.value = `${current.value}\n${line.replace(/^ {2}/, '')}`.trim()
    }
  })

  flush(lines.length)

  return fields
}

export function parseSkillDocument(content: string): ParsedSkillDocument {
  const parts = frontmatterParts(content)

  if (!parts) {
    return { body: content, metadata: [] }
  }

  return {
    body: parts.body,
    metadata: frontmatterFields(parts.header[1]).map(({ key, value }) => ({ key, value }))
  }
}

function quoteUpdatedValue(value: string, original: string): string {
  const trimmed = original.trim()

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return JSON.stringify(value)
  }

  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return `'${value.replaceAll("'", "''")}'`
  }

  return value
}

function replacementLines(field: FrontmatterField, value: string): string[] {
  const lines = value.replace(/\r\n/g, '\n').split('\n')
  const scalar = lines.length === 1

  if (scalar) {
    return [`${field.key}: ${quoteUpdatedValue(lines[0], field.firstValue)}`.trimEnd()]
  }

  return [`${field.key}:`, ...lines.map(line => `  ${line}`)]
}

/**
 * Rebuilds only the requested top-level fields and the instruction body. Any
 * other YAML field, comment, or ordering remains untouched. The caller keeps
 * the original skill name as the storage id when sending this new document.
 */
export function updateSkillDocument(content: string, updates: Record<string, string>, body?: string): string {
  const parts = frontmatterParts(content)

  if (!parts) {
    return body ?? content
  }

  const lines = parts.header[1].split(/\r?\n/)
  const fields = frontmatterFields(parts.header[1])
  const nextLines: string[] = []
  let lineNumber = 0

  for (const field of fields) {
    nextLines.push(...lines.slice(lineNumber, field.startLine))
    const nextValue = updates[field.key]
    nextLines.push(...(nextValue === undefined ? lines.slice(field.startLine, field.endLine) : replacementLines(field, nextValue)))
    lineNumber = field.endLine
  }

  nextLines.push(...lines.slice(lineNumber))
  const closing = /\r?\n---(\r?\n?)$/.exec(parts.header[0])
  const closingEnding = closing?.[1] ?? parts.newline
  const nextHeader = `---${parts.newline}${nextLines.join(parts.newline)}${parts.newline}---${closingEnding}`

  return `${nextHeader}${body ?? parts.body}`
}
