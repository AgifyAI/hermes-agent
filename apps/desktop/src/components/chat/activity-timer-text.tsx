import { cn } from '@/lib/utils'

import { formatElapsed } from './activity-timer'
import { StableText } from './stable-text'

interface ActivityTimerTextProps {
  'aria-hidden'?: boolean
  seconds: number
  className?: string
}

export function ActivityTimerText({ 'aria-hidden': ariaHidden, seconds, className }: ActivityTimerTextProps) {
  return (
    <StableText
      aria-hidden={ariaHidden}
      className={cn('shrink-0 text-[0.6875rem] leading-none text-(--linear-text-tertiary)', className)}
    >
      {formatElapsed(seconds)}
    </StableText>
  )
}
