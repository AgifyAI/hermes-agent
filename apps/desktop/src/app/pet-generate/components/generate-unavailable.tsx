import { Button } from '@/components/ui/button'
import { ExternalLink } from '@/lib/external-link'
import { PawPrint, Settings2 } from '@/lib/icons'

interface GenerateUnavailableProps {
  onSetup: () => void
}

// Shown when no reference-capable image backend is configured: generation is
// impossible, so we replace the prompt entirely with a friendly path to set one
// up (in-app) plus where to grab a key.
export function GenerateUnavailable({ onSetup }: GenerateUnavailableProps) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-[color-mix(in_srgb,var(--linear-accent)_10%,transparent)] text-(--linear-accent)">
        <PawPrint className="size-5" />
      </span>
      <div className="space-y-1.5">
        <p className="text-[1.125rem] leading-[1.8rem] font-semibold text-(--linear-text-primary)">
          Add an image backend to generate
        </p>
        <p className="mx-auto max-w-[19rem] text-[0.8125rem] leading-5 text-(--linear-text-tertiary)">
          Hatching a custom pet needs a provider that can ground on a reference image.
        </p>
      </div>
      <Button onClick={onSetup}>
        <Settings2 />
        Set up image generation
      </Button>
      <p className="flex flex-wrap items-center justify-center gap-x-1.5 text-[0.6875rem] text-(--linear-text-tertiary)">
        <span>Grab a key from</span>
        <ExternalLink href="https://portal.nousresearch.com" showExternalIcon={false}>
          Nous Portal
        </ExternalLink>
        <span>·</span>
        <ExternalLink
          className="opacity-40 transition-opacity hover:opacity-100"
          href="https://openrouter.ai/keys"
          showExternalIcon={false}
        >
          OpenRouter
        </ExternalLink>
        <span>·</span>
        <ExternalLink
          className="opacity-40 transition-opacity hover:opacity-100"
          href="https://platform.openai.com/api-keys"
          showExternalIcon={false}
        >
          OpenAI
        </ExternalLink>
      </p>
    </div>
  )
}
