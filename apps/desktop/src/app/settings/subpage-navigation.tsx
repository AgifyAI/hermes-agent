import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

import { PAGE_INSET_NEG_X, PAGE_INSET_X } from '../layout-constants'
import { OverlayBreadcrumbHeader } from '../overlays/overlay-breadcrumb-header'
import type { OverlayNavGroup, OverlayNavLink } from '../overlays/overlay-split-layout'

import { SETTINGS_COLUMN } from './primitives'

export function SettingsSubpageHeader({ group, child }: { group: OverlayNavGroup; child?: OverlayNavLink }) {
  const { t } = useI18n()

  // A third rail level (a plugin's sub-page under Settings ▸ Plugins).
  const grandchild = child?.children?.find(link => link.active)

  // The breadcrumb pads itself with the page gutter; cancel that inside the
  // content column so it starts on the same edge as the page title and cards.
  return (
    <div className={cn('shrink-0', PAGE_INSET_X)}>
      <div className={SETTINGS_COLUMN}>
        <div className={PAGE_INSET_NEG_X}>
          <OverlayBreadcrumbHeader
            child={child}
            grandchild={grandchild}
            group={group}
            rootLabel={t.commandCenter.settings}
          />
        </div>
      </div>
    </div>
  )
}

/** The page title Settings shows over the active page: its deepest active nav label. */
export function settingsPageTitle(group?: OverlayNavGroup, child?: OverlayNavLink): string | undefined {
  return child?.children?.find(link => link.active)?.label ?? child?.label ?? group?.label
}
