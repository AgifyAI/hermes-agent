'use client'

import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

/** Block wheel until ⌘/Ctrl so map embeds don't hijack transcript scroll. */
export function ScrollGate() {
  const [active, setActive] = useState(false)

  useEffect(() => {
    const sync = (event: KeyboardEvent) => setActive(event.metaKey || event.ctrlKey)
    const clear = () => setActive(false)

    window.addEventListener('keydown', sync)
    window.addEventListener('keyup', sync)
    window.addEventListener('blur', clear)

    return () => {
      window.removeEventListener('keydown', sync)
      window.removeEventListener('keyup', sync)
      window.removeEventListener('blur', clear)
    }
  }, [])

  return (
    <div className={cn('group/gate absolute inset-0', active ? 'pointer-events-none' : 'pointer-events-auto')}>
      <span className="pointer-events-none absolute bottom-2 left-2 rounded-(--linear-radius-control) border-[0.5px] border-(--linear-border-overlay) bg-(--linear-bg-overlay) px-1.5 py-0.5 text-[0.6875rem] font-[450] text-(--linear-text-overlay) opacity-0 transition-opacity group-hover/embed:opacity-100">
        Hold ⌘ to zoom
      </span>
    </div>
  )
}
