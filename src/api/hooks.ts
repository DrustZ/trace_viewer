import type {
  AiFilterResponse,
  GroupedTracesResponse,
  ImportResponse,
  MetaResponse,
  NeighborsResponse,
  RefreshResponse,
  SearchHit,
  TracesListResponse,
} from '@shared/schema/api'
import type {
  ComponentAggregate,
  EvolutionSeries,
  RewardCurves,
  StatTiles,
  Trace,
  TraceSummary,
} from '@shared/schema/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
// Type-only import — erased at build time, so the client bundle never pulls in server code.
import type { AnalysisResponse } from '../../server/ai/analyst'
import { apiGet, apiPost } from './client'

/** Canonical list-query params, serialized identically for every endpoint that filters. */
export interface ListParams {
  split?: string
  step?: string
  component?: string
  status?: string
  filters?: string
  q?: string
  sort?: string
  order?: string
  groupBy?: string
  limit?: number
  offset?: number
}

export function listQueryString(params: ListParams): string {
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') qs.set(key, String(value))
  }
  const s = qs.toString()
  return s ? `?${s}` : ''
}

export function useMeta() {
  return useQuery({ queryKey: ['meta'], queryFn: () => apiGet<MetaResponse>('/api/meta') })
}

export function useTraces(params: ListParams) {
  const qs = listQueryString(params)
  return useQuery({
    queryKey: ['traces', qs],
    queryFn: () => apiGet<TracesListResponse | GroupedTracesResponse>(`/api/traces${qs}`),
    placeholderData: (prev) => prev,
  })
}

export function useTrace(traceId: string | undefined) {
  return useQuery({
    queryKey: ['trace', traceId],
    queryFn: () => apiGet<Trace>(`/api/traces/${traceId}`),
    enabled: !!traceId,
  })
}

export function useTraceRaw(traceId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['trace-raw', traceId],
    queryFn: async () => {
      const res = await fetch(`/api/traces/${traceId}/raw`)
      if (!res.ok) throw new Error(`raw unavailable (${res.status})`)
      return res.text()
    },
    enabled: !!traceId && enabled,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function useNeighbors(traceId: string | undefined, params: ListParams) {
  const qs = listQueryString(params)
  return useQuery({
    queryKey: ['neighbors', traceId, qs],
    queryFn: () => apiGet<NeighborsResponse>(`/api/traces/${traceId}/neighbors${qs}`),
    enabled: !!traceId,
  })
}

export function useSiblings(traceId: string | undefined) {
  return useQuery({
    queryKey: ['siblings', traceId],
    queryFn: () => apiGet<TraceSummary[]>(`/api/traces/${traceId}/siblings`),
    enabled: !!traceId,
  })
}

export function useTiles(params: ListParams) {
  const qs = listQueryString(params)
  return useQuery({
    queryKey: ['tiles', qs],
    queryFn: () => apiGet<StatTiles>(`/api/aggregates/tiles${qs}`),
    placeholderData: (prev) => prev,
  })
}

export function useComponentAggregates(params: ListParams) {
  const qs = listQueryString({ split: params.split, step: params.step })
  return useQuery({
    queryKey: ['component-aggregates', qs],
    queryFn: () => apiGet<ComponentAggregate[]>(`/api/aggregates/components${qs}`),
    placeholderData: (prev) => prev,
  })
}

export function useRewardCurves(components?: string[]) {
  const qs = components?.length
    ? `?${components.map((c) => `component=${encodeURIComponent(c)}`).join('&')}`
    : ''
  return useQuery({
    queryKey: ['curves', qs],
    queryFn: () => apiGet<RewardCurves>(`/api/aggregates/curves${qs}`),
    placeholderData: (prev) => prev,
  })
}

export function useEvolution(instanceId: string | undefined) {
  return useQuery({
    queryKey: ['evolution', instanceId],
    queryFn: () =>
      apiGet<EvolutionSeries>(`/api/evolution/${encodeURIComponent(instanceId ?? '')}`),
    enabled: !!instanceId,
  })
}

export function useSearch(q: string) {
  return useQuery({
    queryKey: ['search', q],
    queryFn: () => apiGet<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
    placeholderData: (prev) => prev,
  })
}

export function useImportTrace() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { type: 'text' | 'url'; content?: string; url?: string; format?: string }) =>
      apiPost<ImportResponse>('/api/import', body),
    onSuccess: () => qc.invalidateQueries(),
  })
}

export function useAiFilter() {
  return useMutation({
    mutationFn: (query: string) => apiPost<AiFilterResponse>('/api/ai-filter', { query }),
  })
}

export function useAnalysis() {
  return useMutation({
    mutationFn: (query: string) => apiPost<AnalysisResponse>('/api/analysis', { query }),
  })
}

export function useRefresh() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiPost<RefreshResponse>('/api/refresh', {}),
    onSuccess: () => qc.invalidateQueries(),
  })
}
