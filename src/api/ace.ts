import type {
  AceAnalysisSummary,
  AceBatchSummary,
  AceCapabilities,
  AceCheckpointResponse,
  AceDashboardSummary,
  AceRegressionCapability,
  AceRegressionResult,
  AceReplayRequest,
  AceRunRequest,
  AceSaveRegressionRequest,
  AceScenarioPack,
} from '@shared/schema/ace'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from './client'

export interface AceRunsResponse {
  total: number
  items: AceBatchSummary[]
}

export function useAceRuns() {
  return useQuery({
    queryKey: ['ace-runs'],
    queryFn: () => apiGet<AceRunsResponse>('/api/ace/runs'),
    // Covers a just-created batch before its first trace exists; trace changes arrive via SSE.
    refetchInterval: (query) =>
      query.state.data?.items.some((run) =>
        ['queued', 'running', 'paused', 'cancelling'].includes(run.lifecycle),
      )
        ? 2_000
        : false,
  })
}

export function aceDashboardPath(runIds?: readonly string[]): string {
  const normalized = [...new Set(runIds ?? [])].sort()
  if (normalized.length === 0) return '/api/ace/dashboard'
  const search = new URLSearchParams()
  for (const runId of normalized) search.append('runId', runId)
  return `/api/ace/dashboard?${search.toString()}`
}

export function useAceDashboard(runIds?: readonly string[]) {
  const normalized = [...new Set(runIds ?? [])].sort()
  return useQuery({
    queryKey: ['ace-dashboard', normalized],
    queryFn: () => apiGet<AceDashboardSummary>(aceDashboardPath(normalized)),
  })
}

export function useAceAnalysis() {
  return useQuery({
    queryKey: ['ace-analysis'],
    queryFn: () => apiGet<AceAnalysisSummary>('/api/ace/analysis'),
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
  })
}

export function useAceCapabilities() {
  return useQuery({
    queryKey: ['ace-capabilities'],
    queryFn: () => apiGet<AceCapabilities>('/api/ace/capabilities'),
  })
}

export function useAceScenarios() {
  return useQuery({
    queryKey: ['ace-scenarios'],
    queryFn: () => apiGet<{ items: AceScenarioPack[] }>('/api/ace/scenarios'),
  })
}

export function useAceRun(runId: string | undefined) {
  return useQuery({
    queryKey: ['ace-run', runId],
    queryFn: () => apiGet<AceBatchSummary>(`/api/ace/runs/${encodeURIComponent(runId ?? '')}`),
    enabled: Boolean(runId),
    refetchInterval: (query) => {
      // Stop polling on error (e.g. a stale shared URL naming a deleted run)
      // and on terminal lifecycles; otherwise a missing run is hit at 1 Hz forever.
      if (query.state.status === 'error') return false
      const lifecycle = query.state.data?.lifecycle
      if (!lifecycle) return 1_000
      return ['completed', 'cancelled', 'failed'].includes(lifecycle) ? false : 1_000
    },
  })
}

export function useStartAceRun() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (request: AceRunRequest) =>
      apiPost<{ runId: string; lifecycle: string }>('/api/ace/runs', request),
    onSuccess: () => client.invalidateQueries({ queryKey: ['ace-runs'] }),
  })
}

export function useControlAceRun(runId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (action: 'pause' | 'resume' | 'cancel') =>
      apiPost<{ runId: string; desiredState: string }>(
        `/api/ace/runs/${encodeURIComponent(runId)}/control`,
        { action },
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['ace-runs'] })
      void client.invalidateQueries({ queryKey: ['ace-run', runId] })
    },
  })
}

export function useAceCheckpoints(traceUid: string | undefined) {
  return useQuery({
    queryKey: ['ace-checkpoints', traceUid],
    queryFn: () =>
      apiGet<AceCheckpointResponse>(
        `/api/ace/traces/${encodeURIComponent(traceUid ?? '')}/checkpoints`,
      ),
    enabled: Boolean(traceUid),
  })
}

export function useAceReplay() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (request: AceReplayRequest & { forkMessageId?: string }) =>
      apiPost<Record<string, unknown>>('/api/ace/replays', request),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['ace-runs'] })
      void client.invalidateQueries({ queryKey: ['traces'] })
    },
  })
}

export function useAceRegressionCapability(traceUid: string | undefined) {
  return useQuery({
    queryKey: ['ace-regression-capability', traceUid],
    queryFn: () =>
      apiGet<AceRegressionCapability>(
        `/api/ace/traces/${encodeURIComponent(traceUid ?? '')}/regression-capability`,
      ),
    enabled: Boolean(traceUid),
  })
}

export function useSaveAceRegression() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (request: AceSaveRegressionRequest) =>
      apiPost<AceRegressionResult>('/api/ace/regressions', request),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['ace-scenarios'] })
      void client.invalidateQueries({ queryKey: ['ace-tasks'] })
    },
  })
}
