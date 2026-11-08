import { type Document, isMap, isNode, isScalar, type Node, type Pair, parseDocument } from 'yaml'

export interface SkillMetadataField {
  key: string
  value: string
}

export interface ParsedSkillDocument {
  body: string
  metadata: SkillMetadataField[]
}

interface FrontmatterParts {
  body: string
  document: Document.Parsed
  header: RegExpExecArray
  newline: string
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

function frontmatterParts(content: string): FrontmatterParts | null {
  const header = FRONTMATTER_RE.exec(content)

  if (!header) {
    return null
  }

  return {
    body: content.slice(header[0].length),
    document: parseDocument(header[1], { keepSourceTokens: true }),
    header,
    newline: header[0].includes('\r\n') ? '\r\n' : '\n'
  }
}

function topLevelPairs(document: Document.Parsed): Pair<Node, Node | null>[] {
  return isMap<Node, Node | null>(document.contents) ? document.contents.items : []
}

function pairKey(pair: Pair<Node, Node | null>): string | null {
  return isScalar(pair.key) && typeof pair.key.value === 'string' ? pair.key.value : null
}

function pairValue(pair: Pair<Node, Node | null>, source: string): string {
  const value = pair.value

  if (!value) {
    return ''
  }

  if (isScalar(value)) {
    return value.value === null || value.value === undefined ? '' : String(value.value)
  }

  const range = value.range

  if (!range) {
    return value.toString().trim()
  }

  // Collection nodes stringify as flow YAML by default. Read their original
  // range instead, keeping the user's block layout while removing the one
  // indentation level belonging to the top-level field.
  return source
    .slice(range[0], range[2])
    .replace(/\r?\n {2}/g, '\n')
    .trim()
}

function metadataFrom(parts: FrontmatterParts): SkillMetadataField[] {
  return topLevelPairs(parts.document).flatMap(pair => {
    const key = pairKey(pair)

    return key ? [{ key, value: pairValue(pair, parts.header[1]) }] : []
  })
}

export function parseSkillDocument(content: string): ParsedSkillDocument {
  const parts = frontmatterParts(content)

  if (!parts) {
    return { body: content, metadata: [] }
  }

  return { body: parts.body, metadata: metadataFrom(parts) }
}

function preserveComments(previous: Node | null, next: Node): void {
  if (!previous) {
    return
  }

  next.comment = previous.comment
  next.commentBefore = previous.commentBefore
  next.spaceBefore = previous.spaceBefore

  if (isScalar(previous) && isScalar(next) && (previous.type === 'QUOTE_DOUBLE' || previous.type === 'QUOTE_SINGLE')) {
    next.type = previous.type
  }
}

/**
 * Rebuilds only the requested top-level fields and the instruction body. The
 * YAML document owns parsing and serialization, so special characters and
 * multiline values stay valid while comments and unknown fields remain intact.
 * The caller keeps the original skill name as the storage id when sending this
 * new document.
 */
export function updateSkillDocument(content: string, updates: Record<string, string>, body?: string): string {
  const parts = frontmatterParts(content)

  if (!parts || !isMap<Node, Node | null>(parts.document.contents)) {
    return body ?? content
  }

  for (const pair of parts.document.contents.items) {
    const key = pairKey(pair)
    const nextValue = key === null ? undefined : updates[key]

    if (nextValue === undefined) {
      continue
    }

    const previous = isNode(pair.value) ? pair.value : null
    const next = parts.document.createNode(nextValue)
    preserveComments(previous, next)
    pair.value = next as NonNullable<typeof pair.value>
  }

  const serialized = parts.document.toString({ lineWidth: 0 }).replace(/\r?\n$/, '')
  const normalized = serialized.replace(/\r?\n/g, parts.newline)
  const closingEnding = /\r?\n---(\r?\n?)$/.exec(parts.header[0])?.[1] ?? ''
  const nextHeader = `---${parts.newline}${normalized}${parts.newline}---${closingEnding}`

  return `${nextHeader}${body ?? parts.body}`
}
