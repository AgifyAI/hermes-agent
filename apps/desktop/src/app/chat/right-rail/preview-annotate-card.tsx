import { useEffect, useRef } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { ANNOTATE_CARD_HEIGHT, ANNOTATE_CARD_WIDTH, ANNOTATE_MARKER_SIZE } from '@/lib/preview-annotate'

const PAD = 12
const GAP = 8

interface AnnotateCardPlacement {
  left: number
  top: number
}

interface PlaceAnnotateCardInput {
  paneHeight: number
  paneWidth: number
  rect: { height: number; width: number; x: number; y: number }
}

interface PreviewAnnotateCardProps extends AnnotateCardPlacement {
  note: string
  number: number
  onCancel: () => void
  onChange: (note: string) => void
  onSave: () => void
  placeholder: string
  saveLabel: string
  title: string
}

export function placeAnnotateCard({ paneHeight, paneWidth, rect }: PlaceAnnotateCardInput): AnnotateCardPlacement {
  const width = Math.min(ANNOTATE_CARD_WIDTH, Math.max(0, paneWidth - PAD * 2))
  const maxLeft = Math.max(PAD, paneWidth - width - PAD)
  const maxTop = Math.max(PAD, paneHeight - ANNOTATE_CARD_HEIGHT - PAD)
  const pinRight = rect.x + ANNOTATE_MARKER_SIZE / 2
  const preferRight = pinRight + GAP
  const preferLeft = rect.x - ANNOTATE_MARKER_SIZE / 2 - GAP - width

  const left =
    preferRight + width + PAD <= paneWidth || preferLeft < PAD
      ? Math.min(Math.max(PAD, preferRight), maxLeft)
      : Math.min(Math.max(PAD, preferLeft), maxLeft)

  const top = Math.min(Math.max(PAD, rect.y - ANNOTATE_CARD_HEIGHT / 2), maxTop)

  return { left, top }
}

export function PreviewAnnotateCard({
  left,
  note,
  number,
  onCancel,
  onChange,
  onSave,
  placeholder,
  saveLabel,
  title,
  top
}: PreviewAnnotateCardProps) {
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    field.current?.focus()
  }, [number])

  return (
    <form
      aria-label={title}
      className="absolute z-20 flex h-11 w-[min(17.5rem,calc(100%-1.5rem))] items-center gap-1 rounded-(--linear-radius-overlay) border-[0.5px] border-(--linear-border-overlay) bg-(--linear-bg-overlay) pl-3 pr-2 text-(--linear-text-overlay) shadow-(--linear-shadow-menu)"
      data-annotate-card="true"
      data-annotate-number={number}
      onSubmit={event => {
        event.preventDefault()
        onSave()
      }}
      style={{ left, top }}
    >
      <input
        aria-label={placeholder}
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent text-[0.8125rem] leading-5 text-(--linear-text-overlay) outline-none placeholder:text-(--linear-text-quaternary)"
        onChange={event => onChange(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
        placeholder={placeholder}
        ref={field}
        spellCheck
        value={note}
      />
      <Button aria-label={saveLabel} size="icon" type="submit">
        <Codicon name="arrow-up" size="0.875rem" />
      </Button>
    </form>
  )
}
