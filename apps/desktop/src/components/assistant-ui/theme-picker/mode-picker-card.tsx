'use client'

import { useI18n } from '@/i18n'
import { THEME_MODES } from '@/store/appearance-apply'
import type { ThemeMode } from '@/themes'

import { OptionsCard } from '../setup-beat/beat-cards'

export interface ModePickerCardProps {
  /** Answers with the picked mode; true once sent. */
  onPick: (mode: ThemeMode) => boolean
}

/** Light, Dark or System: the one appearance choice Hermes Desktop has (its look is Linear's). */
export function ModePickerCard({ onPick }: ModePickerCardProps) {
  const { t } = useI18n()

  return (
    <OptionsCard
      onPick={option => onPick(option.id as ThemeMode)}
      options={THEME_MODES.map(mode => ({ id: mode, label: t.settings.modeOptions[mode].label }))}
    />
  )
}
