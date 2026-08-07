import type {
  CalibrationStatsResponse,
  ReviewDraft,
  ReviewPayload,
  ReviewQueueResponse,
  ReviewRecord,
  ReviewSubject,
  ReviewWorkspaceResponse,
  SaveReviewDraftRequest,
  SubmitReviewRequest,
} from '@shared/reviews/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiGet, apiPost } from './client'

export interface ReviewQueueFilters {
  annotator: string
  rubricVersion: string
  mode: ReviewSubject['mode']
  state?: 'unreviewed' | 'draft' | 'submitted'
  priority?: ReviewPayload['priority']
  corpusId?: string
  runId?: string
  q?: string
  tags?: string[]
  disagreement?: boolean
  limit?: number
  offset?: number
}

export interface CalibrationFilters {
  annotator?: string
  rubricVersion?: string
  corpusId?: string
  runId?: string
}

export interface SubmitReviewResponse {
  record: ReviewRecord
  visibility: 'revealed'
  automatic?: ReviewRecord['automaticSnapshot']
}

function queryString(values: object): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  const serialized = search.toString()
  return serialized ? `?${serialized}` : ''
}

function subjectQuery(subject: ReviewSubject): string {
  return queryString({
    annotator: subject.annotator,
    rubricVersion: subject.rubricVersion,
    mode: subject.mode,
  })
}

async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    let message = response.statusText
    try {
      message = await response.text()
    } catch {
      // Keep the HTTP status text if the response body cannot be read.
    }
    throw new ApiError(response.status, message)
  }
  return response.json() as Promise<T>
}

export function useReviewQueue(filters: ReviewQueueFilters) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries({
    annotator: filters.annotator,
    rubricVersion: filters.rubricVersion,
    mode: filters.mode,
    state: filters.state,
    priority: filters.priority,
    corpusId: filters.corpusId,
    runId: filters.runId,
    q: filters.q,
    disagreement: filters.disagreement,
    limit: filters.limit,
    offset: filters.offset,
  })) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  for (const tag of filters.tags ?? []) search.append('tag', tag)
  const serialized = search.toString()
  return useQuery({
    queryKey: ['review-queue', serialized],
    queryFn: () => apiGet<ReviewQueueResponse>(`/api/reviews/queue?${serialized}`),
  })
}

export function useReviewWorkspace(subject: ReviewSubject | undefined) {
  return useQuery({
    queryKey: ['review-workspace', subject],
    queryFn: () =>
      apiGet<ReviewWorkspaceResponse>(
        `/api/reviews/${encodeURIComponent(subject?.traceUid ?? '')}/draft${subjectQuery(
          subject as ReviewSubject,
        )}`,
      ),
    enabled: subject !== undefined,
  })
}

export function useSaveReviewDraft() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: SaveReviewDraftRequest) =>
      apiPut<ReviewDraft>(
        `/api/reviews/${encodeURIComponent(request.subject.traceUid)}/draft`,
        request,
      ),
    onSuccess: (_draft, request) => {
      void queryClient.invalidateQueries({ queryKey: ['review-workspace', request.subject] })
      void queryClient.invalidateQueries({ queryKey: ['review-queue'] })
    },
  })
}

export function useSubmitReview() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: SubmitReviewRequest) =>
      apiPost<SubmitReviewResponse>(
        `/api/reviews/${encodeURIComponent(request.subject.traceUid)}/submit`,
        request,
      ),
    onSuccess: (_record, request) => {
      void queryClient.invalidateQueries({ queryKey: ['review-workspace', request.subject] })
      void queryClient.invalidateQueries({ queryKey: ['review-queue'] })
      void queryClient.invalidateQueries({ queryKey: ['review-calibration'] })
    },
  })
}

export function useCalibrationStats(filters: CalibrationFilters = {}) {
  const query = queryString(filters)
  return useQuery({
    queryKey: ['review-calibration', query],
    queryFn: () => apiGet<CalibrationStatsResponse>(`/api/reviews/calibration${query}`),
  })
}
