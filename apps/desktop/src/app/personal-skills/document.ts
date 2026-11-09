import { CST, type Document, isMap, isScalar, type Node, type Pair, parseDocument, stringify } from 'yaml'

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

const FRONTMATTER_RE = /^(---[ \t]*\r?\n)([\s\S]*?)(?<=\n)(---[ \t]*(?:\r?\n|$))/

function frontmatterParts(content: string): FrontmatterParts | null {
  const header = FRONTMATTER_RE.exec(content)

  if (!header) {
    return null
  }

  return {
    body: content.slice(header[0].length),
    document: parseDocument(header[2], { keepSourceTokens: true }),
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

    return key ? [{ key, value: pairValue(pair, parts.header[2]) }] : []
  })
}

export function parseSkillDocument(content: string): ParsedSkillDocument {
  const parts = frontmatterParts(content)

  if (!parts) {
    return { body: content, metadata: [] }
  }

  return { body: parts.body, metadata: metadataFrom(parts) }
}

/** Edit the original YAML tokens so other fields, spacing and comments survive a save. */
export function updateSkillDocument(content: string, updates: Record<string, string>, body?: string): string {
  const parts = frontmatterParts(content)
  const newline = parts?.newline ?? (content.includes('\r\n') ? '\r\n' : '\n')
  const missing = { ...updates }

  if (!parts) {
    if (!Object.keys(missing).length) {
      return body ?? content
    }

    const yaml = stringify(missing).replace(/\n/g, newline)

    return `---${newline}${yaml}---${newline}${body ?? content}`
  }

  let yaml = parts.header[2]
  const map = parts.document.contents

  // Walk backwards to keep parser offsets valid when replacements change length.
  for (const pair of [...topLevelPairs(parts.document)].reverse()) {
    const key = pairKey(pair)

    if (key === null || !Object.hasOwn(missing, key)) {
      continue
    }

    const value = missing[key]
    delete missing[key]

    if (value === pairValue(pair, parts.header[2])) {
      continue
    }

    const token = pair.value?.srcToken

    if (token) {
      const start = token.offset
      const end = start + CST.stringify(token).length
      // A plain scalar such as "true" must stay a string when YAML is read again.
      const needsQuotes = token.type === 'scalar' && /^["']/.test(stringify(value))
      CST.setScalarValue(token, value, {
        afterKey: true,
        inFlow: isMap(map) && map.flow,
        type: needsQuotes ? 'QUOTE_DOUBLE' : undefined
      })
      yaml = yaml.slice(0, start) + CST.stringify(token).replace(/\r?\n/g, newline) + yaml.slice(end)
    } else {
      // Empty values have no token. Insert immediately after the key's colon,
      // keeping any following whitespace and comments in their original place.
      const colon = pair.srcToken?.sep?.find(token => token.type === 'map-value-ind')

      if (!colon) {
        throw new Error('Invalid skill metadata')
      }

      const offset = colon.offset + colon.source.length
      yaml = yaml.slice(0, offset) + ' ' + JSON.stringify(value) + yaml.slice(offset)
    }
  }

  if (Object.keys(missing).length) {
    if (parts.document.errors.length || (map && !isMap(map))) {
      throw new Error('Invalid skill metadata')
    }

    if (isMap(map) && map.flow && map.range) {
      const offset = map.range[0] + 1
      const pairs = Object.entries(missing).map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`)
      yaml = yaml.slice(0, offset) + pairs.join(', ') + (map.items.length ? ', ' : '') + yaml.slice(offset)
    } else {
      yaml += stringify(missing).replace(/\n/g, newline)
    }
  }

  return parts.header[1] + yaml + parts.header[3] + (body ?? parts.body)
}
