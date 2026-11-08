import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { getCronDeliveryTargets } from '@/api/cron'
import { Checkbox } from '@/components/ui/checkbox'
import { Codicon } from '@/components/ui/codicon'
import { Field, FieldHint } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { type Translations, useI18n } from '@/i18n'
import { AlertTriangle } from '@/lib/icons'
import { requestModelOptions } from '@/lib/model-options'
import { cn } from '@/lib/utils'
import type { CronDeliveryTarget, CronJob, CronJobUpdates } from '@/types/hermes'

import { PANEL_ERROR_NOTICE } from '../overlays/panel'

import {
  cronModelChoiceValue,
  jobIsScriptOnly,
  parseCronDeliveryTargets,
  parseCronModelChoiceValue,
  toggleCronDeliveryTarget
} from './cron-job-model'
import { jobDeliver, jobModel, jobName, jobPrompt, jobProvider, jobScheduleExpr } from './job-fields'

const DEFAULT_DELIVER = 'local'
const MODEL_DEFAULT_VALUE = '__default__'

const SCHEDULE_OPTIONS: ReadonlyArray<{ expr?: string; value: string }> = [
  { expr: '0 9 * * *', value: 'daily' },
  { expr: '0 9 * * 1-5', value: 'weekdays' },
  { expr: '0 9 * * 1', value: 'weekly' },
  { expr: '0 9 1 * *', value: 'monthly' },
  { expr: '0 * * * *', value: 'hourly' },
  { expr: '*/15 * * * *', value: 'every-15-minutes' },
  { value: 'custom' }
]

function schedulePresetForExpr(expr: string): string {
  const normalized = expr.trim().replace(/\s+/g, ' ')

  return SCHEDULE_OPTIONS.find(option => option.expr === normalized)?.value ?? 'custom'
}

function splitList(value: string): string[] {
  return [...new Set(value.split(/[,\n]/).map(item => item.trim()).filter(Boolean))]
}

function joinList(value: unknown): string {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string').join(', ') : ''
}

function formatRepeat(repeat: CronJob['repeat']): string {
  const times = repeat && typeof repeat === 'object' ? repeat.times : null

  return times === null || times === undefined ? '' : String(times)
}

function parseRepeat(value: string): null | number {
  const trimmed = value.trim().toLowerCase()

  if (!trimmed || trimmed === 'forever' || trimmed === 'infinite') {
    return null
  }

  const parsed = Number(trimmed)

  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export function CronJobInlineEditor({
  c,
  job,
  onUpdate
}: {
  c: Translations['cron']
  job: CronJob
  onUpdate: (updates: CronJobUpdates) => Promise<void>
}) {
  const { t } = useI18n()
  const scriptOnlyJob = jobIsScriptOnly(job)
  const [name, setName] = useState(() => jobName(job))
  const [prompt, setPrompt] = useState(() => jobPrompt(job))
  const [schedule, setSchedule] = useState(() => jobScheduleExpr(job))
  const [schedulePreset, setSchedulePreset] = useState(() => schedulePresetForExpr(jobScheduleExpr(job)))
  const [deliver, setDeliver] = useState(() => jobDeliver(job) || DEFAULT_DELIVER)

  const [modelChoice, setModelChoice] = useState(() =>
    jobModel(job) ? cronModelChoiceValue(jobProvider(job), jobModel(job)) : MODEL_DEFAULT_VALUE
  )

  const [repeat, setRepeat] = useState(() => formatRepeat(job.repeat))
  const [skills, setSkills] = useState(() => joinList(job.skills ?? (job.skill ? [job.skill] : [])))
  const [script, setScript] = useState(() => job.script ?? '')
  const [baseUrl, setBaseUrl] = useState(() => job.base_url ?? '')
  const [provider, setProvider] = useState(() => job.provider ?? '')
  const [contextFrom, setContextFrom] = useState(() => joinList(job.context_from))
  const [enabledToolsets, setEnabledToolsets] = useState(() => joinList(job.enabled_toolsets))
  const [workdir, setWorkdir] = useState(() => job.workdir ?? '')
  const [monitorScript, setMonitorScript] = useState(() => job.monitor_script ?? '')
  const [monitorUrl, setMonitorUrl] = useState(() => job.monitor_url ?? '')
  const [failureDeliver, setFailureDeliver] = useState(() => job.failure_deliver ?? '')
  const [interpreter, setInterpreter] = useState(() => job.interpreter ?? '')
  const [reasoningEffort, setReasoningEffort] = useState(() => job.reasoning_effort ?? '')
  const [noAgent, setNoAgent] = useState(() => Boolean(job.no_agent))
  const [attachToSession, setAttachToSession] = useState(() => Boolean(job.attach_to_session))
  const [savingField, setSavingField] = useState<null | string>(null)
  const [error, setError] = useState<null | string>(null)

  const deliveryTargets = useQuery({ queryKey: ['cron-delivery-targets'], queryFn: getCronDeliveryTargets })

  const modelOptions = useQuery({
    queryKey: ['model-options', 'global'],
    queryFn: () => requestModelOptions({}),
    enabled: !scriptOnlyJob
  })

  const modelProviders = (modelOptions.data?.providers ?? []).filter(
    option => option.authenticated !== false && (option.models ?? []).length > 0
  )

  const modelChoiceKnown =
    modelChoice === MODEL_DEFAULT_VALUE ||
    modelProviders.some(option =>
      (option.models ?? []).some(model => cronModelChoiceValue(option.slug, model) === modelChoice)
    )

  async function persist(field: string, updates: CronJobUpdates): Promise<void> {
    const nextPrompt = field === 'prompt' ? String(updates.prompt ?? '').trim() : prompt.trim()
    const nextSchedule = field === 'schedule' ? String(updates.schedule ?? '').trim() : schedule.trim()
    const nextScript = field === 'script' ? String(updates.script ?? '').trim() : script.trim()
    const nextSkills = field === 'skills' ? (updates.skills ?? []) : splitList(skills)

    if (!nextSchedule) {
      setError(c.scheduleRequired)

      return
    }

    if (['prompt', 'script', 'skills', 'no_agent'].includes(field) && !nextPrompt && !nextScript && !nextSkills.length) {
      setError(c.promptScheduleRequired)

      return
    }

    setSavingField(field)
    setError(null)

    try {
      await onUpdate(updates)
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : c.failedUpdate)
    } finally {
      setSavingField(null)
    }
  }

  function selectSchedule(nextPreset: string) {
    setSchedulePreset(nextPreset)
    const option = SCHEDULE_OPTIONS.find(candidate => candidate.value === nextPreset)

    if (option?.expr) {
      setSchedule(option.expr)
      void persist('schedule', { schedule: option.expr })
    }
  }

  function selectModel(next: string) {
    setModelChoice(next)
    const parsed = parseCronModelChoiceValue(next)
    setProvider(parsed?.provider ?? '')
    void persist('model', { model: parsed?.model ?? null, provider: parsed?.provider ?? null })
  }

  return (
    <section className="space-y-4" data-slot="cron-inline-editor">
      <div className="flex items-center justify-between gap-2">
        {savingField ? (
          <span className="flex items-center gap-1 text-xs text-(--linear-text-tertiary)" role="status">
            <Codicon name="loading" size="0.75rem" spinning />
            {t.common.saving}
          </span>
        ) : null}
      </div>

      <div className="grid gap-4">
        <Field htmlFor="cron-inline-name" label={c.nameLabel} optional optionalLabel={c.optional}>
          <Input id="cron-inline-name" onBlur={() => void persist('name', { name: name.trim() })} onChange={e => setName(e.target.value)} placeholder={c.namePlaceholder} value={name} />
        </Field>

        {!scriptOnlyJob ? (
          <Field htmlFor="cron-inline-prompt" label={c.promptLabel}>
            <Textarea id="cron-inline-prompt" onBlur={() => void persist('prompt', { prompt: prompt.trim() })} onChange={e => setPrompt(e.target.value)} placeholder={c.promptPlaceholder} value={prompt} />
          </Field>
        ) : null}

        <Field htmlFor="cron-inline-frequency" label={c.frequencyLabel}>
          <Select onValueChange={selectSchedule} value={schedulePreset}>
            <SelectTrigger id="cron-inline-frequency"><SelectValue /></SelectTrigger>
            <SelectContent>{SCHEDULE_OPTIONS.map(option => <SelectItem key={option.value} value={option.value}>{c.scheduleLabels[option.value]}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        {schedulePreset === 'custom' ? (
          <Field htmlFor="cron-inline-schedule" label={c.customScheduleLabel}>
            <Input className="font-mono" id="cron-inline-schedule" onBlur={() => void persist('schedule', { schedule: schedule.trim() })} onChange={e => setSchedule(e.target.value)} placeholder={c.customPlaceholder} value={schedule} />
            <FieldHint>{c.customHint}</FieldHint>
          </Field>
        ) : null}

        <InlineDeliveryField c={c} onChange={next => { setDeliver(next); void persist('deliver', { deliver: next }) }} targets={deliveryTargets.data ?? []} value={deliver} />

        <Field htmlFor="cron-inline-model" label={c.modelLabel} optional optionalLabel={c.optional}>
          <Select disabled={scriptOnlyJob} onValueChange={selectModel} value={modelChoice}>
            <SelectTrigger id="cron-inline-model"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={MODEL_DEFAULT_VALUE}>{c.modelDefault}</SelectItem>
              {!modelChoiceKnown ? <SelectItem className="font-mono" value={modelChoice}>{parseCronModelChoiceValue(modelChoice)?.model ?? modelChoice}</SelectItem> : null}
              {modelProviders.map(option => (
                <SelectGroup key={option.slug}>
                  <SelectLabel>{option.name}</SelectLabel>
                  {(option.models ?? []).map(model => {
                    const value = cronModelChoiceValue(option.slug, model)

                    return <SelectItem className="font-mono" key={value} value={value}>{model}</SelectItem>
                  })}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field htmlFor="cron-inline-provider" label={c.providerLabel} optional optionalLabel={c.optional}>
          <Input id="cron-inline-provider" onBlur={() => void persist('provider', { provider: provider.trim() || null })} onChange={e => setProvider(e.target.value)} value={provider} />
        </Field>
        <Field htmlFor="cron-inline-base-url" label={c.baseUrlLabel} optional optionalLabel={c.optional}>
          <Input className="font-mono" id="cron-inline-base-url" onBlur={() => void persist('base_url', { base_url: baseUrl.trim() || null })} onChange={e => setBaseUrl(e.target.value)} value={baseUrl} />
        </Field>
        <Field htmlFor="cron-inline-repeat" label={c.repeatLabel} optional optionalLabel={c.optional}>
          <Input id="cron-inline-repeat" onBlur={() => void persist('repeat', { repeat: parseRepeat(repeat) })} onChange={e => setRepeat(e.target.value)} placeholder={c.repeatPlaceholder} value={repeat} />
        </Field>
        <Field htmlFor="cron-inline-skills" label={c.skillsLabel} optional optionalLabel={c.optional}>
          <Textarea id="cron-inline-skills" onBlur={() => void persist('skills', { skills: splitList(skills) })} onChange={e => setSkills(e.target.value)} placeholder={c.skillsPlaceholder} value={skills} />
        </Field>
        <Field htmlFor="cron-inline-script" label={c.scriptLabel} optional optionalLabel={c.optional}>
          <Textarea className="font-mono" id="cron-inline-script" onBlur={() => void persist('script', { script: script.trim() || null })} onChange={e => setScript(e.target.value)} value={script} />
        </Field>
        <Field htmlFor="cron-inline-context" label={c.contextFromLabel} optional optionalLabel={c.optional}>
          <Textarea id="cron-inline-context" onBlur={() => void persist('context_from', { context_from: splitList(contextFrom) })} onChange={e => setContextFrom(e.target.value)} value={contextFrom} />
        </Field>
        <Field htmlFor="cron-inline-toolsets" label={c.enabledToolsetsLabel} optional optionalLabel={c.optional}>
          <Textarea id="cron-inline-toolsets" onBlur={() => void persist('enabled_toolsets', { enabled_toolsets: splitList(enabledToolsets) })} onChange={e => setEnabledToolsets(e.target.value)} value={enabledToolsets} />
        </Field>
        <Field htmlFor="cron-inline-workdir" label={c.workdirLabel} optional optionalLabel={c.optional}>
          <Input className="font-mono" id="cron-inline-workdir" onBlur={() => void persist('workdir', { workdir: workdir.trim() || null })} onChange={e => setWorkdir(e.target.value)} value={workdir} />
        </Field>
        <Field htmlFor="cron-inline-monitor-script" label={c.monitorScriptLabel} optional optionalLabel={c.optional}>
          <Textarea className="font-mono" id="cron-inline-monitor-script" onBlur={() => void persist('monitor_script', { monitor_script: monitorScript.trim() || null })} onChange={e => setMonitorScript(e.target.value)} value={monitorScript} />
        </Field>
        <Field htmlFor="cron-inline-monitor-url" label={c.monitorUrlLabel} optional optionalLabel={c.optional}>
          <Input className="font-mono" id="cron-inline-monitor-url" onBlur={() => void persist('monitor_url', { monitor_url: monitorUrl.trim() || null })} onChange={e => setMonitorUrl(e.target.value)} value={monitorUrl} />
        </Field>
        <Field htmlFor="cron-inline-failure-deliver" label={c.failureDeliveryLabel} optional optionalLabel={c.optional}>
          <Input id="cron-inline-failure-deliver" onBlur={() => void persist('failure_deliver', { failure_deliver: failureDeliver.trim() || null })} onChange={e => setFailureDeliver(e.target.value)} value={failureDeliver} />
        </Field>
        <Field htmlFor="cron-inline-interpreter" label={c.interpreterLabel} optional optionalLabel={c.optional}>
          <Input className="font-mono" id="cron-inline-interpreter" onBlur={() => void persist('interpreter', { interpreter: interpreter.trim() || null })} onChange={e => setInterpreter(e.target.value)} value={interpreter} />
        </Field>
        <Field htmlFor="cron-inline-reasoning" label={c.reasoningEffortLabel} optional optionalLabel={c.optional}>
          <Select onValueChange={next => { const value = next === '__default__' ? '' : next; setReasoningEffort(value); void persist('reasoning_effort', { reasoning_effort: value || null }) }} value={reasoningEffort || '__default__'}>
            <SelectTrigger id="cron-inline-reasoning"><SelectValue /></SelectTrigger>
            <SelectContent>{['__default__', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map(value => <SelectItem key={value} value={value}>{value === '__default__' ? c.reasoningDefault : value}</SelectItem>)}</SelectContent>
          </Select>
        </Field>

        <div className="grid gap-2">
          <InlineBooleanField checked={noAgent} id="cron-inline-no-agent" label={c.noAgentLabel} onChange={checked => { setNoAgent(checked); void persist('no_agent', { no_agent: checked }) }} />
          <InlineBooleanField checked={attachToSession} id="cron-inline-attach" label={c.attachToSessionLabel} onChange={checked => { setAttachToSession(checked); void persist('attach_to_session', { attach_to_session: checked }) }} />
        </div>
      </div>

      {error ? <div className={cn(PANEL_ERROR_NOTICE, 'flex items-start gap-2 px-3 py-2 text-xs')} role="alert"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /><span>{error}</span></div> : null}
    </section>
  )
}

function InlineBooleanField({ checked, id, label, onChange }: { checked: boolean; id: string; label: string; onChange: (checked: boolean) => void }) {
  return <label className="flex items-center gap-2 text-[0.8125rem]" htmlFor={id}><Checkbox checked={checked} id={id} onCheckedChange={value => onChange(value === true)} />{label}</label>
}

function InlineDeliveryField({ c, onChange, targets, value }: { c: Translations['cron']; onChange: (value: string) => void; targets: CronDeliveryTarget[]; value: string }) {
  const selected = parseCronDeliveryTargets(value)
  const known = new Set(targets.map(target => target.id))
  const options = [...targets, ...selected.filter(target => !known.has(target)).map(id => ({ id, name: id, home_target_set: true }))]

  return <Field htmlFor="cron-inline-deliver" label={c.deliverLabel}><div aria-label={c.deliverLabel} className="grid gap-2 rounded-(--linear-radius-control) border-[0.5px] border-(--linear-border-input) bg-(--linear-bg-input) px-3 py-2.5" id="cron-inline-deliver" role="group">{options.map((target, index) => { const checked = selected.includes(target.id); const checkboxId = `cron-inline-deliver-${index}`; const label = target.id === 'local' ? c.deliveryLabels.local : (c.deliveryLabels[target.id] ?? target.name);

 return <label className="flex items-center gap-2 text-[0.8125rem]" htmlFor={checkboxId} key={target.id}><Checkbox checked={checked} id={checkboxId} onCheckedChange={next => onChange(toggleCronDeliveryTarget(value, target.id, next === true))} /><span>{label}</span></label> })}</div></Field>
}
