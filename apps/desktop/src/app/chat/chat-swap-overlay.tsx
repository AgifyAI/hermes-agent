import { useEffect, useState } from 'react'

import { useOnboardingChatActive } from '@/components/onboarding/first-run/assembly'
import { GlyphSpinner } from '@/components/ui/glyph-spinner'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

// Shown over the conversation while the live gateway swaps to another profile's
// backend (lazily spawned). Keeps the last profile name through the fade-out so
// the label doesn't blank. Purely visual — pointer-events-none.
export function ChatSwapOverlay({ profile }: { profile: string | null }) {
  const { t } = useI18n()
  const onboarding = useOnboardingChatActive()
  const [label, setLabel] = useState<null | string>(profile)

  useEffect(() => {
    if (profile) {
      setLabel(profile)
    }
  }, [profile])

  // The first run may swap into the default profile, which the user did not ask for.
  // "Waking up default…" over the greeting reads as a stall in the moment that has to feel instant.
  if (onboarding) {
    return null
  }

  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 z-50 flex items-center justify-center transition-opacity duration-150 ease-out',
        profile ? 'opacity-100' : 'opacity-0'
      )}
    >
      <div className="flex items-center gap-2 rounded-(--linear-radius-overlay) border-[0.5px] border-(--linear-border-overlay) bg-(--linear-bg-overlay) p-3 text-[0.8125rem] font-medium text-(--linear-text-primary) shadow-(--linear-shadow-menu)">
        {/* Was a local 80ms setInterval + setState braille ticker — the same
            mechanism class (per-tick DOM mutation scheduling style recalc)
            that GlyphSpinner was rewritten to remove. `braille` is exactly the
            frame set and 80ms cadence this used. `justify-start` keeps the
            glyph left-aligned in its w-3 box the way the bare span was, and
            `paused` restores the old "no ticking once the swap is done"
            behaviour while the overlay fades out still mounted. */}
        <GlyphSpinner className="w-3 justify-start text-(--linear-accent)" paused={!profile} spinner="braille" />
        {t.composer.wakingProfile(label ?? '')}
      </div>
    </div>
  )
}

// Subtle corner badge for a PAINT-FIRST wake (#89843): the stored transcript
// is already on screen and usable, but the active-profile gate hasn't caught
// up yet (shared-remote serves every profile through the primary socket).
// Deliberately quiet — a pill in the corner, not an overlay — because the
// content is real; only the background profile sync is still settling.
export function ChatSyncBadge({ profile }: { profile: string | null }) {
  const { t } = useI18n()

  if (!profile) {
    return null
  }

  return (
    <div
      aria-live="polite"
      className="pointer-events-none absolute right-3 top-2 z-30 flex items-center gap-1.5 rounded-full border-[0.5px] border-(--linear-border-overlay) bg-(--linear-bg-overlay) px-2 py-0.5 text-[0.6875rem] font-[450] text-(--linear-text-tertiary) shadow-(--linear-shadow-low)"
    >
      <GlyphSpinner className="w-3 justify-start text-(--linear-accent)" spinner="braille" />
      {t.desktop.hydrationSyncing(profile)}
    </div>
  )
}
