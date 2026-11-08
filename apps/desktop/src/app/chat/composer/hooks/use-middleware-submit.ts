import { useCallback } from 'react'

import { runComposerMiddleware } from '../contrib'
import type { ChatBarProps } from '../types'

export function useMiddlewareSubmit(onSubmitProp: ChatBarProps['onSubmit']) {
  // Every send (typed, queued, voice) passes through the contributed
  // middleware chain first — rewrite / pass-through / cancel. Empty chain =
  // exact pass-through, so surfaces without contributions are byte-identical.
  const onSubmit = useCallback<ChatBarProps['onSubmit']>(
    async (value, options) => {
      const draft = await runComposerMiddleware({ text: value, attachments: options?.attachments })

      if (!draft) {
        return false
      }

      return onSubmitProp(draft.text, { ...options, attachments: draft.attachments })
    },
    [onSubmitProp]
  )

  return { onSubmit }
}
