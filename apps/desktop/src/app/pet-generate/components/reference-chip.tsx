import { useState } from 'react'

import { ImageLightbox } from '@/components/chat/zoomable-image'
import { useImageDownload } from '@/hooks/use-image-download'
import { useI18n } from '@/i18n'
import { X } from '@/lib/icons'

interface ReferenceChipProps {
  name: string
  onRemove: () => void
  src: string
}

// The reference photo as an attachment chip: filename + thumbnail that opens
// the shared image viewer (lightbox), with a remove affordance.
export function ReferenceChip({ name, onRemove, src }: ReferenceChipProps) {
  const { t } = useI18n()
  const { download, saving } = useImageDownload(src)
  const [viewing, setViewing] = useState(false)

  return (
    <div className="ml-auto flex h-6 items-center gap-1.5 self-start rounded-full border-[0.5px] border-(--linear-border-tertiary) bg-(--linear-bg-chip) pr-2 pl-1">
      <button aria-label={t.desktop.openImage} className="shrink-0" onClick={() => setViewing(true)} type="button">
        <img alt={name} className="size-4 rounded-full object-cover" src={src} />
      </button>

      <span className="max-w-40 truncate text-xs font-medium text-(--linear-text-chip)">{name || 'Reference'}</span>
      <button
        aria-label="Remove reference"
        className="cursor-pointer text-(--linear-text-tertiary) transition-colors duration-(--linear-speed-quick) hover:text-(--linear-text-primary) hover:transition-none"
        onClick={onRemove}
        type="button"
      >
        <X className="size-3.5" />
      </button>

      <ImageLightbox
        alt={name}
        copy={t.desktop}
        onClick={download}
        onOpenChange={setViewing}
        open={viewing}
        saving={saving}
        src={src}
      />
    </div>
  )
}
