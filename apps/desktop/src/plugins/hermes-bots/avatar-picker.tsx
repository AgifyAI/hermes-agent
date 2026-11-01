/**
 * The avatar editor shared by Edit Profile and New Bot: shape grid + color
 * swatches, the Generate and Upload tabs, and the petdex Pet tab.
 */

import {
  Button,
  cn,
  Codicon,
  ColorSwatches,
  GlyphSpinner,
  host,
  PROFILE_SWATCHES,
  RowButton,
  SegmentedControl,
  Textarea,
  Tip,
  useValue
} from '@hermes/plugin-sdk'
import { useState } from 'react'

import {
  AVATAR_PICKER_SHAPES,
  avatarColor,
  BLOB_KINDS,
  blobatarSvg,
  blobShapeString,
  BotFace,
  defaultShapeFor,
  isBlobShape,
  parseBlobShape
} from './avatar'
import {
  $imagenAvailable,
  generateAvatarImage,
  type GeneratedImage,
  normalizeAvatarImage,
  pickImageFromDevice,
  probeImagen
} from './avatar-image'
import { useBots } from './i18n'

interface AvatarPickerProps {
  /** `null` = no explicit pick, i.e. the name's deterministic hue. */
  color: null | string
  /** Feeds the Generate tab when the user leaves the description blank. */
  generateSeed?: { description?: string; name?: string; title?: string } | null
  image: null | string
  onColor: (color: null | string) => void
  onImage: (image: null | string) => void
  onShape: (shape: string) => void
  shape: string
}

/** Shape grid + color swatches, shared by Edit Profile and New Bot. */
export function AvatarPicker({ shape, color, image, onShape, onColor, onImage, generateSeed }: AvatarPickerProps) {
  const b = useBots()
  const pickerName = generateSeed?.name || 'agent'
  const imagen = useValue($imagenAvailable)
  const [tab, setTab] = useState('bot')
  const [describe, setDescribe] = useState('')
  const [genBusy, setGenBusy] = useState(false)

  if (imagen === null) {
    void probeImagen()
  }

  // Re-check a stale "unavailable" whenever the user lands on the Generate
  // tab — the gateway may have restarted with image.generate since.
  const goTab = (id: string) => {
    setTab(id)

    if (id === 'generate' && $imagenAvailable.get() === false) {
      $imagenAvailable.set(null)
      void probeImagen()
    }
  }

  const upload = async () => {
    const raw = await pickImageFromDevice()

    if (raw) {
      onImage(await normalizeAvatarImage(raw))
    }
  }

  const generate = async () => {
    if (genBusy) {
      return
    }

    setGenBusy(true)

    try {
      const custom = describe.trim()

      const img = custom
        ? await (async () => {
            const res = await host.request<GeneratedImage>('image.generate', {
              prompt: `${custom}. Avatar for an AI agent: centered, bold flat vector style, solid color background, no text.`,
              aspect_ratio: 'square'
            })

            if (!res?.success) {
              throw new Error(res?.error || 'generation failed')
            }

            return res.image_data || res.image
          })()
        : await generateAvatarImage(generateSeed?.name || 'agent', generateSeed?.title, generateSeed?.description)

      if (img) {
        onImage(await normalizeAvatarImage(img))
      }
    } catch (err) {
      host.notifyError(err, b.avatar.generationFailed)
    } finally {
      setGenBusy(false)
    }
  }

  return (
    <div className="grid justify-items-center gap-3">
      <SegmentedControl
        onChange={goTab}
        options={[
          { id: 'bot', label: b.avatar.tabBot },
          { id: 'generate', label: b.avatar.tabGenerate },
          { id: 'upload', label: b.avatar.upload }
        ]}
        value={tab}
      />
      {image && tab !== 'generate' ? (
        <Button onClick={() => onImage(null)} size="sm" type="button" variant="ghost">
          {b.avatar.removeImage}
        </Button>
      ) : null}
      {tab === 'bot' ? (
        isBlobShape(shape) && blobatarSvg ? (
          (() => {
            const { seedPart, kind } = parseBlobShape(shape, pickerName)
            const locked = Boolean(seedPart)

            return (
              <div className="grid justify-items-center gap-3">
                {/* Silhouette pins: Auto (name decides) + the six blob kinds. */}
                <div className="grid grid-cols-4 justify-items-center gap-1.5">
                  {['', ...BLOB_KINDS].map(k => (
                    <Tip key={k || 'auto'} label={k || b.editor.autoHint}>
                      <RowButton
                        aria-label={k || b.editor.autoHint}
                        className={cn(
                          'flex size-11 items-center justify-center rounded-md transition-colors hover:bg-(--linear-hover-control)',
                          k === kind && !image && 'ring-1 ring-(--linear-accent)'
                        )}
                        onClick={() => {
                          onImage(null)
                          onShape(blobShapeString(seedPart, k))
                        }}
                      >
                        {k ? (
                          <BotFace
                            color={avatarColor(color, pickerName)}
                            name={pickerName}
                            shape={blobShapeString(seedPart, k)}
                            size={32}
                          />
                        ) : (
                          <span className="text-[0.6875rem] font-[450] text-(--linear-text-tertiary)">{b.editor.auto}</span>
                        )}
                      </RowButton>
                    </Tip>
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    onClick={() => {
                      onImage(null)
                      onShape(blobShapeString(Math.random().toString(36).slice(2, 10), kind))
                    }}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    <Codicon className="mr-1 text-[0.875rem]" name="refresh" />
                    {b.avatar.randomize}
                  </Button>
                  <Button
                    onClick={() => onShape(blobShapeString(locked ? '' : pickerName, kind))}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    <Codicon className="mr-1 text-[0.875rem]" name={locked ? 'unlock' : 'lock'} />
                    {locked ? b.editor.unlock : b.editor.lockFace}
                  </Button>
                </div>
                <div className="text-center text-[0.6875rem] font-[450] text-(--linear-text-quaternary)">
                  {locked ? b.editor.lockedHint : b.editor.unlockedHint}
                </div>
                <Button
                  className="text-(--linear-text-tertiary)"
                  onClick={() => onShape(defaultShapeFor(pickerName))}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {b.avatar.classicShapes}
                </Button>
              </div>
            )
          })()
        ) : (
          <div className="grid justify-items-center gap-3">
            <div className="grid grid-cols-4 justify-items-center gap-1.5">
              {(blobatarSvg ? ['blobatar', ...AVATAR_PICKER_SHAPES] : AVATAR_PICKER_SHAPES).map(s => (
                <Tip key={s} label={s === 'blobatar' ? b.avatar.blobFromName : undefined}>
                  <RowButton
                    aria-label={s === 'blobatar' ? b.avatar.blobFromName : s}
                    className={cn(
                      'flex size-11 items-center justify-center rounded-md transition-colors hover:bg-(--linear-hover-control)',
                      s === shape && !image && 'ring-1 ring-(--linear-accent)'
                    )}
                    onClick={() => {
                      onImage(null)
                      onShape(s)
                    }}
                  >
                    <BotFace color={avatarColor(color, pickerName)} name={pickerName} shape={s} size={32} />
                  </RowButton>
                </Tip>
              ))}
            </div>
            <ColorSwatches
              clearLabel={b.avatar.matchTheName}
              onChange={onColor}
              swatches={PROFILE_SWATCHES}
              value={color}
            />
          </div>
        )
      ) : null}
      {tab === 'generate' ? (
        imagen ? (
          <div className="grid w-full gap-2">
            <Textarea
              className="min-h-16"
              onChange={event => setDescribe(event.target.value)}
              placeholder={b.avatar.describePlaceholder}
              value={describe}
            />
            <Button
              className="w-full justify-center"
              disabled={genBusy}
              onClick={generate}
              type="button"
              variant="secondary"
            >
              {genBusy ? (
                <GlyphSpinner className="mr-1 text-[0.875rem]" spinner="breathe" />
              ) : (
                <Codicon className="mr-1 text-[0.875rem]" name="sparkle" />
              )}
              {genBusy ? b.avatar.generating : b.avatar.generate}
            </Button>
            {describe.trim() ? null : (
              <div className="text-center text-[0.6875rem] font-[450] text-(--linear-text-quaternary)">{b.bot.descriptionHint}</div>
            )}
          </div>
        ) : (
          <div className="px-2 py-3 text-center text-xs font-[450] leading-5 text-(--linear-text-tertiary)">
            {imagen === false ? b.editor.noImageModel : b.editor.checkingImage}
          </div>
        )
      ) : null}
      {tab === 'upload' ? (
        <Button className="w-full justify-center" onClick={upload} type="button" variant="secondary">
          <Codicon className="mr-1 text-[0.875rem]" name="device-camera" />
          {b.editor.chooseImage}
        </Button>
      ) : null}
    </div>
  )
}
