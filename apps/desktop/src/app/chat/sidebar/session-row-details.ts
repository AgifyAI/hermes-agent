import type { SessionListDensity } from '@/store/session-list-density'

export const sessionRowEstimate = (density: SessionListDensity) =>
  ({ compact: 28, comfortable: 45, detailed: 63 })[density]

/** Virtual-list placement estimate for the Inbox-style card. A full card
 *  stacks four text lines (header, title, preview, model/size) where the
 *  tallest inline density stacks three, plus the card's own padding — and a
 *  title that wraps to two lines on a narrow sidebar adds one more title
 *  line (#88473). Deliberately at or ABOVE that worst case: an oversized
 *  estimate paints a brief gap that self-measurement closes, while an
 *  undersized one paints rows over their neighbours (and the divider below)
 *  on a cold start, before any measurement can correct it. */
export const SESSION_CARD_ROW_ESTIMATE_PX = 96
