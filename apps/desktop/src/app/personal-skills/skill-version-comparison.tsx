import { useMemo, useState } from 'react'

import { DiffBody, type DiffLine } from '@/components/chat/diff-lines'
import { Button } from '@/components/ui/button'
import type { SkillCopyDirection, SkillLocation } from '@/hermes'
import type { useI18n } from '@/i18n'

interface SideBySideDiff {
  installed: DiffLine[]
  source: DiffLine[]
}

function simpleSideBySideDiff(sourceLines: string[], installedLines: string[]): SideBySideDiff {
  const source: DiffLine[] = []
  const installed: DiffLine[] = []
  const length = Math.max(sourceLines.length, installedLines.length)

  for (let index = 0; index < length; index += 1) {
    const sourceLine = sourceLines[index]
    const installedLine = installedLines[index]

    if (sourceLine !== undefined && sourceLine === installedLine) {
      source.push({ kind: 'context', text: sourceLine })
      installed.push({ kind: 'context', text: installedLine })
    } else {
      source.push({ kind: sourceLine === undefined ? 'context' : 'add', text: sourceLine ?? '' })
      installed.push({ kind: installedLine === undefined ? 'context' : 'remove', text: installedLine ?? '' })
    }
  }

  return { installed, source }
}

function alignChangedLines(sourceLines: string[], installedLines: string[]): SideBySideDiff {
  if (!sourceLines.length || !installedLines.length || sourceLines.length * installedLines.length > 250_000) {
    return simpleSideBySideDiff(sourceLines, installedLines)
  }

  const rows = sourceLines.length + 1
  const columns = installedLines.length + 1
  const table = Array.from({ length: rows }, () => new Uint32Array(columns))

  for (let sourceIndex = sourceLines.length - 1; sourceIndex >= 0; sourceIndex -= 1) {
    for (let installedIndex = installedLines.length - 1; installedIndex >= 0; installedIndex -= 1) {
      table[sourceIndex][installedIndex] =
        sourceLines[sourceIndex] === installedLines[installedIndex]
          ? table[sourceIndex + 1][installedIndex + 1] + 1
          : Math.max(table[sourceIndex + 1][installedIndex], table[sourceIndex][installedIndex + 1])
    }
  }

  const sourceDiff: DiffLine[] = []
  const installedDiff: DiffLine[] = []
  let sourceIndex = 0
  let installedIndex = 0

  while (sourceIndex < sourceLines.length || installedIndex < installedLines.length) {
    if (
      sourceIndex < sourceLines.length &&
      installedIndex < installedLines.length &&
      sourceLines[sourceIndex] === installedLines[installedIndex]
    ) {
      sourceDiff.push({ kind: 'context', text: sourceLines[sourceIndex] })
      installedDiff.push({ kind: 'context', text: installedLines[installedIndex] })
      sourceIndex += 1
      installedIndex += 1
    } else if (
      sourceIndex < sourceLines.length &&
      installedIndex < installedLines.length &&
      table[sourceIndex + 1][installedIndex + 1] >=
        Math.max(table[sourceIndex + 1][installedIndex], table[sourceIndex][installedIndex + 1])
    ) {
      sourceDiff.push({ kind: 'add', text: sourceLines[sourceIndex] })
      installedDiff.push({ kind: 'remove', text: installedLines[installedIndex] })
      sourceIndex += 1
      installedIndex += 1
    } else if (
      sourceIndex < sourceLines.length &&
      (installedIndex >= installedLines.length ||
        table[sourceIndex + 1][installedIndex] >= table[sourceIndex][installedIndex + 1])
    ) {
      sourceDiff.push({ kind: 'add', text: sourceLines[sourceIndex] })
      installedDiff.push({ kind: 'context', text: '' })
      sourceIndex += 1
    } else {
      sourceDiff.push({ kind: 'context', text: '' })
      installedDiff.push({ kind: 'remove', text: installedLines[installedIndex] })
      installedIndex += 1
    }
  }

  return { installed: installedDiff, source: sourceDiff }
}

export function compareSkillText(sourceText: string, installedText: string): SideBySideDiff {
  const source = sourceText.split(/\r\n?|\n/)
  const installed = installedText.split(/\r\n?|\n/)
  const commonLength = Math.min(source.length, installed.length)
  let start = 0
  let end = 0

  while (start < commonLength && source[start] === installed[start]) {
    start += 1
  }
  while (end < commonLength - start && source[source.length - 1 - end] === installed[installed.length - 1 - end]) {
    end += 1
  }

  const before = source.slice(0, start).map(text => ({ kind: 'context' as const, text }))
  const after = source.slice(source.length - end).map(text => ({ kind: 'context' as const, text }))
  const changed = alignChangedLines(
    source.slice(start, source.length - end),
    installed.slice(start, installed.length - end)
  )

  return {
    installed: [...before, ...changed.installed, ...after],
    source: [...before, ...changed.source, ...after]
  }
}

export function SkillVersionComparison({
  installedContent,
  location,
  onSync,
  saving,
  sourceContent,
  t
}: {
  installedContent?: string
  location?: SkillLocation
  onSync: (direction: SkillCopyDirection) => Promise<void>
  saving: boolean
  sourceContent?: null | string
  t: ReturnType<typeof useI18n>['t']
}) {
  const different =
    location?.installation?.status === 'different' &&
    sourceContent !== undefined &&
    sourceContent !== null &&
    installedContent !== undefined

  const [expanded, setExpanded] = useState(false)
  const diff = useMemo(
    () => (different && expanded ? compareSkillText(sourceContent, installedContent) : undefined),
    [different, expanded, installedContent, sourceContent]
  )

  if (!different) {
    return null
  }

  const sourceEditable = location?.source?.editable ?? false
  const runtimeEditable = location?.runtime?.editable ?? location?.installation?.runtime_editable ?? false
  const versionsAvailable = Boolean(location?.installation?.runtime_version && location?.installation?.source_version)

  return (
    <details className="personal-skills-difference" onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary>
        {t.skills.personalPage.compareVersions}
        <span aria-hidden="true" className="personal-skills-difference-caret" />
      </summary>
      <div className="personal-skills-difference-columns">
        <section>
          <h3>{t.skills.personalPage.source}</h3>
          <pre className="personal-skills-difference-code">{diff && <DiffBody lines={diff.source} />}</pre>
          <Button
            disabled={!versionsAvailable || !runtimeEditable || saving}
            onClick={() => void onSync('source_to_installed').catch(() => undefined)}
            size="default"
            variant="secondary"
          >
            {t.skills.personalPage.keepSource}
          </Button>
          {!runtimeEditable && <p>{t.skills.personalPage.runtimeReadOnly}</p>}
        </section>
        <section>
          <h3>{t.skills.personalPage.installed}</h3>
          <pre className="personal-skills-difference-code">{diff && <DiffBody lines={diff.installed} />}</pre>
          <Button
            disabled={!versionsAvailable || !sourceEditable || saving}
            onClick={() => void onSync('installed_to_source').catch(() => undefined)}
            size="default"
            variant="secondary"
          >
            {t.skills.personalPage.keepInstalled}
          </Button>
          {!sourceEditable && <p>{t.skills.personalPage.sourceReadOnly}</p>}
        </section>
      </div>
    </details>
  )
}
