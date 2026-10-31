/**
 * Desktop appearance context.
 *
 * Hermes Desktop has one look: Linear's, in light and dark (styles.css owns
 * every colour as static `--linear-*` tokens). The only appearance choice is
 * the mode — light, dark, or follow the system — stored per profile. This
 * module paints that mode (`.dark` on <html>), keeps the native window chrome
 * and the next window's first paint in step, and layers the optional chat
 * font in front of the Linear stack.
 */

import { useStore } from '@nanostores/react'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { matchesQuery, useMediaQuery } from '@/hooks/use-media-query'
import { persistString, persistStringRecord, storedString, storedStringRecord } from '@/lib/storage'
import { recordFeatureUse } from '@/store/desktop-metrics'
import { $activeGatewayProfile, normalizeProfileKey } from '@/store/profile'
import { $connection } from '@/store/session'

import { $chatFontFamily, resolveChatFontFamily } from './chat-font'
import { $pendingModeApply } from './request'

const MODE_KEY = 'hermes-desktop-mode-v1'
// Per-profile light/dark/system assignments: { [profileKey]: mode }. A profile
// inherits the global default until it's given its own.
const PROFILE_MODES_KEY = 'hermes-desktop-profile-modes-v1'
// Last active profile, recorded so the boot-time paint can pick that profile's
// mode before the gateway reports which profile actually launched.
const LAST_PROFILE_KEY = 'hermes-desktop-active-profile-v1'

// Appearance state from the retired multi-theme system (skins, user and VS Code
// themes, the backend skin cache, window glass, bubble tint). Nothing reads
// these any more; dropping them at boot is the whole migration to Linear.
export const RETIRED_APPEARANCE_KEYS = [
  'hermes-desktop-theme-v2',
  'hermes-desktop-profile-themes-v1',
  'hermes-desktop-user-themes-v1',
  'hermes-desktop-backend-themes-v1',
  'hermes.desktop.translucency.v1',
  'hermes.desktop.translucency.v2',
  'hermes.desktop.user-bubble-transparency.v1'
] as const

export type ThemeMode = 'light' | 'dark' | 'system'

/** Linear's window colour (sidebar / titlebar) and primary text, as hex for the native chrome. */
export const WINDOW_CHROME = {
  light: { background: '#efeff0', foreground: '#1b1b1b' },
  dark: { background: '#09090a', foreground: '#ffffff' }
} as const

const resolveMode = (mode: ThemeMode, systemDark = matchesQuery('(prefers-color-scheme: dark)')): 'light' | 'dark' =>
  mode === 'system' ? (systemDark ? 'dark' : 'light') : mode

/**
 * A stored mode, or `system` when there isn't one: a fresh profile follows the
 * OS rather than handing someone with a dark desktop a white window.
 */
const normalizeMode = (value: string | null): ThemeMode =>
  value === 'light' || value === 'dark' || value === 'system' ? value : 'system'

// "default" isn't a real profile — it *is* the legacy global slot, so it
// reads/writes the global directly. Named profiles get their own entry and fall
// back to that global until assigned. Named assigns also mirror into the global
// slot so a Bot Mode gateway hop onto a never-styled bot inherits the mode the
// user just picked (#101216).
export const modePref = {
  stored: (profile: string): string | null => storedStringRecord(PROFILE_MODES_KEY)[profile] ?? storedString(MODE_KEY),
  resolve: (profile: string): ThemeMode => normalizeMode(modePref.stored(profile)),
  assign: (profile: string, value: ThemeMode): void => {
    if (profile !== 'default') {
      persistStringRecord(PROFILE_MODES_KEY, { ...storedStringRecord(PROFILE_MODES_KEY), [profile]: value })
    }

    persistString(MODE_KEY, value)
  }
}

const BOOT_PROFILE_KEY =
  typeof window === 'undefined' ? 'default' : normalizeProfileKey(storedString(LAST_PROFILE_KEY))

/** Every key a peer window could change that this one has to repaint for. */
const APPEARANCE_KEYS = new Set([MODE_KEY, PROFILE_MODES_KEY])

function applyMode(mode: 'light' | 'dark', chatFontFamily = $chatFontFamily.get()) {
  if (typeof document === 'undefined') {
    return
  }

  const root = document.documentElement
  const chrome = WINDOW_CHROME[mode]

  root.style.setProperty('color-scheme', mode)
  root.dataset.hermesMode = mode
  root.classList.toggle('dark', mode === 'dark')

  // The chat font sits in front of Linear's stack; empty is Linear's own.
  if (chatFontFamily) {
    root.style.setProperty('--dt-font-sans', resolveChatFontFamily(chatFontFamily, 'var(--linear-font-sans)'))
  } else {
    root.style.removeProperty('--dt-font-sans')
  }

  window.hermesDesktop?.setTitleBarTheme?.(chrome)

  // Raw (non-JSON) keys read by the inline pre-paint script in index.html, so
  // a brand-new window paints the right background on its very first frame.
  try {
    window.localStorage.setItem('hermes-boot-background', chrome.background)
    window.localStorage.setItem('hermes-boot-color-scheme', mode)
  } catch {
    // Storage may be unavailable; the inline script falls back to prefers-color-scheme.
  }
}

// Pin Electron's nativeTheme to the app's mode so the native window chrome
// matches. An explicit pick is forced; 'system' keeps tracking the OS.
const syncNativeTheme = (pref: ThemeMode, resolved: 'light' | 'dark') =>
  window.hermesDesktop?.setNativeTheme?.(pref === 'system' ? 'system' : resolved)

// Boot-time paint to avoid a flash before <ThemeProvider> mounts.
if (typeof window !== 'undefined') {
  for (const key of RETIRED_APPEARANCE_KEYS) {
    persistString(key, null)
  }

  const pref = modePref.resolve(BOOT_PROFILE_KEY)
  const resolved = resolveMode(pref)
  applyMode(resolved)
  syncNativeTheme(pref, resolved)
}

interface ThemeContextValue {
  mode: ThemeMode
  /** The light/dark actually painted (`system` resolved against the OS). */
  resolvedMode: 'light' | 'dark'
  setMode: (mode: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'system',
  resolvedMode: 'light',
  setMode: () => {}
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const activeGatewayProfile = useStore($activeGatewayProfile)
  const connection = useStore($connection)
  // Before a gateway descriptor exists, the bridge is the only authoritative
  // profile for this window. Once one arrives, follow the live route as usual.
  const profileKey = normalizeProfileKey(connection?.profile ?? (connection ? activeGatewayProfile : BOOT_PROFILE_KEY))

  const [mode, setModeState] = useState<ThemeMode>(() =>
    typeof window === 'undefined' ? 'system' : modePref.resolve(BOOT_PROFILE_KEY)
  )

  // Follow profile switches and remember the profile for the next boot's paint.
  useEffect(() => {
    persistString(LAST_PROFILE_KEY, profileKey)
    setModeState(modePref.resolve(profileKey))
  }, [profileKey])

  // Every desktop window is another renderer on the same origin, so a switch in
  // one window reaches the others through `storage`.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key && !APPEARANCE_KEYS.has(event.key)) {
        return
      }

      setModeState(modePref.resolve(normalizeProfileKey($activeGatewayProfile.get())))
    }

    window.addEventListener('storage', onStorage)

    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const systemDark = useMediaQuery('(prefers-color-scheme: dark)')
  const resolvedMode = resolveMode(mode, systemDark)
  const chatFontFamily = useStore($chatFontFamily)

  useEffect(() => applyMode(resolvedMode, chatFontFamily), [resolvedMode, chatFontFamily])
  useEffect(() => syncNativeTheme(mode, resolvedMode), [mode, resolvedMode])

  const setMode = useCallback((next: ThemeMode) => {
    recordFeatureUse('skins')
    setModeState(next)
    modePref.assign(normalizeProfileKey($activeGatewayProfile.get()), next)
  }, [])

  // Drain a mode switch requested from outside React (set_theme from the agent).
  const pendingMode = useStore($pendingModeApply)

  useEffect(() => {
    if (pendingMode) {
      setMode(pendingMode)
      $pendingModeApply.set(null)
    }
  }, [pendingMode, setMode])

  const value = useMemo(() => ({ mode, resolvedMode, setMode }), [mode, resolvedMode, setMode])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export const useTheme = (): ThemeContextValue => useContext(ThemeContext)
