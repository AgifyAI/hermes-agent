import { cn } from '@/lib/utils'

/** Linear's 16px disclosure glyph, shared by section and pane headers. */
export function LinearDisclosure({ className, open }: { className?: string; open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={cn(
        'size-4 shrink-0 text-(--linear-text-tertiary) transition-transform duration-[150ms] ease-[ease] motion-reduce:transition-none',
        open && 'rotate-90',
        className
      )}
      focusable="false"
      viewBox="0 0 16 16"
    >
      <path
        d="M6.75194 10.6239C6.41861 10.8183 6 10.5779 6 10.192V5.80802C6 5.42212 6.41861 5.18169 6.75194 5.37613L10.5096 7.56811C10.8404 7.76105 10.8404 8.23895 10.5096 8.43189L6.75194 10.6239Z"
        fill="currentColor"
      />
    </svg>
  )
}
