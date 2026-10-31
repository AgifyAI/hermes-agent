import { atom } from 'nanostores'

/** Families users ask for by name; each surface otherwise uses its default face. */
export const CHAT_FONT_SUGGESTIONS = [
  'OpenDyslexic',
  'Atkinson Hyperlegible',
  'Lexend',
  'Inter',
  'IBM Plex Sans',
  'Source Sans 3',
  'Noto Sans',
  'Segoe UI',
  'SF Pro Text'
] as const

/** The profile-backed value in config.yaml. Empty restores each surface's default face. */
export const $chatFontFamily = atom('')

export function normalizeChatFontFamily(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function quoteSingleFamily(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

/**
 * Accept a friendly single family name or an authored CSS font stack; the
 * base stack stays behind it so missing glyphs (CJK, emoji) still resolve.
 */
export function resolveChatFontFamily(value: unknown, baseFontSans: string): string {
  const configured = normalizeChatFontFamily(value)

  if (!configured) {
    return baseFontSans
  }

  const preferred = configured.includes(',') || /['"]/.test(configured) ? configured : quoteSingleFamily(configured)

  return `${preferred}, ${baseFontSans}`
}

export function setChatFontFamilyFromConfig(value: unknown): void {
  $chatFontFamily.set(normalizeChatFontFamily(value))
}
