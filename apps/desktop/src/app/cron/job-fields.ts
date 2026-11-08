import type { CronJob } from '@/types/hermes'

const asText = (value: unknown): string => (typeof value === 'string' ? value : '')

export function jobName(job: CronJob): string {
  return asText(job.name).trim()
}

export function jobPrompt(job: CronJob): string {
  return asText(job.prompt)
}

export function jobScheduleExpr(job: CronJob): string {
  return asText(job.schedule?.expr) || asText(job.schedule_display) || ''
}

export function jobDeliver(job: CronJob): string {
  return asText(job.deliver)
}

export function jobModel(job: CronJob): string {
  return asText(job.model).trim()
}

export function jobProvider(job: CronJob): string {
  return asText(job.provider).trim()
}
