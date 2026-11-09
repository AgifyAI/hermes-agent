import { LAYOUT_KEYS } from '@/lib/layout-persistence'
import { type InterfaceMode, modeLayout } from '@/store/interface-mode'

import { isLayoutNode, type LayoutNode, migratePersistedTree, normalize } from './model'
import { stripRetiredPanes } from './preset-tree'

/** Decode one saved layout and remove panes retired by the application. */
export function decodePersistedLayoutTree(parsed: unknown, fallback: Record<InterfaceMode, LayoutNode | null>) {
  if (!isLayoutNode(parsed)) {
    return fallback[modeLayout.mode]
  }

  const migrated = normalize(migratePersistedTree(parsed))
  const cleaned = migrated ? stripRetiredPanes(migrated) : null

  if (cleaned !== migrated) {
    modeLayout.write(LAYOUT_KEYS.tree, cleaned ? JSON.stringify(cleaned) : null)
  }

  return cleaned ?? fallback[modeLayout.mode]
}
