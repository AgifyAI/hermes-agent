import type { ReactElement } from 'react'

import { Button } from '@/components/ui/button'
import { CheckCircle2, Cpu, Loader2, Pause, Zap } from '@/lib/icons'
import { cn } from '@/lib/utils'
import type { LocalCatalogModel, LocalRuntimeJob } from '@/types/hermes'

import { downloadStatusText, LocalModelDownloadActions, ProgressBar } from './local-model-download-progress'
import { type LocalModelsActionScope, runQuickstart, useLocalModelsActionScope } from './local-models-actions'
import { SettingsContent } from './primitives'

export interface LocalModelsQuickstartProps {
  job: LocalRuntimeJob | null
  heroModel: LocalCatalogModel | null
  lastError: LocalRuntimeJob | undefined
  onConfigure: () => void
}

// ── Quickstart: the dummy-proof front door ──
// Until something is servable (runtime + at least one model), the pane
// leads with a hero that does everything in one click; the full pane
// stays one 'Let me choose' click away.
export function LocalModelsQuickstart({
  job: qJob,
  heroModel,
  lastError,
  onConfigure
}: LocalModelsQuickstartProps): ReactElement {
  const scope: LocalModelsActionScope = useLocalModelsActionScope()
  const { copy, owner } = scope
  // Stage rail derived from the job phase: engine -> model -> finish.
  const phase = qJob?.phase ?? ''

  const stageIndex = ['starting-server', 'setting-default'].includes(phase) ? 2 : phase === 'downloading' ? 1 : 0

  const stages = [copy.quickstartStageEngine, copy.quickstartStageModel, copy.quickstartStageFinish]

  return (
    <SettingsContent>
      <div className="flex min-h-[60dvh] items-center justify-center">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-(--linear-radius-card) bg-(--linear-accent)/10">
            {qJob ? (
              qJob.status === 'paused' ? (
                <Pause className="size-7 text-(--linear-text-tertiary)" />
              ) : (
                <Loader2 className="size-7 animate-spin text-(--linear-accent)" />
              )
            ) : (
              <Cpu className="size-7 text-(--linear-accent)" />
            )}
          </div>

          <h2 className="text-[0.9375rem] leading-[1.4375rem] font-medium text-(--linear-text-primary)">
            {qJob ? qJob.target : (heroModel?.display_name ?? '')}
          </h2>

          {qJob ? (
            <>
              {/* The shared status line: state · bytes · speed · ETA. Each
                  stage recomputes percent against ITS OWN download plan, so
                  the composer drops speed/ETA when bytes aren't moving —
                  showing a stale rate across a stage hand-off would read as
                  progress loss. A paused job keeps its frozen counter. */}
              <p className="mt-2 min-h-10 text-[0.8125rem] leading-5 text-(--linear-text-tertiary)">
                {downloadStatusText(qJob, copy)}
              </p>

              <div className="mt-5">
                <ProgressBar paused={qJob.status === 'paused'} percent={qJob.percent} />
              </div>

              {/* Pause / Resume — the backend's can_pause/can_resume gate
                  when controls exist (engine legs, server start report
                  false); the paused state always offers Resume. */}
              <div className="mt-5 flex items-center justify-center gap-3">
                <LocalModelDownloadActions job={qJob} owner={owner} />
              </div>

              {/* Stage rail: engine -> model -> finish. */}
              <div className="mt-5 flex items-center justify-center gap-5">
                {stages.map((label, i) => (
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 text-xs',
                      i < stageIndex && 'text-(--linear-text-tertiary)',
                      i === stageIndex && 'font-medium text-(--linear-text-primary)',
                      i > stageIndex && 'text-(--linear-text-tertiary) opacity-60'
                    )}
                    key={label}
                  >
                    {i < stageIndex ? (
                      <CheckCircle2 className="size-3.5 text-(--linear-accent)" />
                    ) : i === stageIndex ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <span className="size-1.5 rounded-full bg-current" />
                    )}
                    {label}
                  </span>
                ))}
              </div>
            </>
          ) : heroModel ? (
            <>
              <p className="mt-2 text-[0.8125rem] leading-5 text-(--linear-text-tertiary)">
                {heroModel.downloaded
                  ? copy.quickstartDetailReady(heroModel.display_name)
                  : copy.quickstartDetail(heroModel.display_name, heroModel.size_label)}
              </p>

              <div className="mt-6 flex items-center justify-center gap-3">
                <Button onClick={onConfigure} size="sm" variant="outline">
                  {copy.quickstartConfigure}
                </Button>
                <Button onClick={() => void runQuickstart(scope)} size="default">
                  <Zap />
                  {copy.quickstartAction}
                </Button>
              </div>
            </>
          ) : null}

          {lastError?.kind === 'quickstart' && !qJob && (
            <p className="mt-4 text-xs text-(--linear-red)">{lastError.error}</p>
          )}
        </div>
      </div>
    </SettingsContent>
  )
}
