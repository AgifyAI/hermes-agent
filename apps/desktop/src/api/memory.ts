import { capabilityScoped, type ProfileScope } from './client'

export interface PendingMemoryWrite {
  created_at: number
  id: string
  origin: string
  payload: Record<string, unknown>
  summary: string
}

export interface PendingMemoryResponse {
  approval_enabled: boolean
  pending: PendingMemoryWrite[]
}

export function getPendingMemoryWrites(scope?: ProfileScope): Promise<PendingMemoryResponse> {
  return window.hermesDesktop.api<PendingMemoryResponse>({
    ...capabilityScoped(scope),
    path: '/api/memory/pending'
  })
}

export function approvePendingMemoryWrite(id: string, scope?: ProfileScope): Promise<{ id: string; ok: boolean }> {
  return window.hermesDesktop.api<{ id: string; ok: boolean }>({
    ...capabilityScoped(scope),
    path: `/api/memory/pending/${encodeURIComponent(id)}/approve`,
    method: 'POST'
  })
}

export function rejectPendingMemoryWrite(id: string, scope?: ProfileScope): Promise<{ id: string; ok: boolean }> {
  return window.hermesDesktop.api<{ id: string; ok: boolean }>({
    ...capabilityScoped(scope),
    path: `/api/memory/pending/${encodeURIComponent(id)}/reject`,
    method: 'POST'
  })
}

export function editPendingMemoryWrite(id: string, content: string, scope?: ProfileScope): Promise<{ id: string; ok: boolean }> {
  return window.hermesDesktop.api<{ id: string; ok: boolean }>({
    ...capabilityScoped(scope),
    path: `/api/memory/pending/${encodeURIComponent(id)}`,
    method: 'PATCH',
    body: { content }
  })
}
