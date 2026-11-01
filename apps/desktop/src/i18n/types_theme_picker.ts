/** The set_theme picker cards in the chat and their settled receipt. */
export interface ThemePickerCopy {
  layout: string
  mode: string
  basic: string
  basicDetail: string
  elite: string
  eliteDetail: string
  /** The card closed without a pick: dismissed, timed out, or answered in the composer. */
  noPick: string
}
