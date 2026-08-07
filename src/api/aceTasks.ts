import type {
  AceTaskCatalogSource,
  AceTaskDetail,
  AceTaskQuery,
  AceTaskScoringContract,
  AceTasksResponse,
} from '@shared/schema/aceTasks'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from './client'

export type AceTaskDetailResponse = AceTaskDetail & {
  source: AceTaskCatalogSource
  scoring?: AceTaskScoringContract
}

function queryString(filters: AceTaskQuery): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value?.trim()) search.set(key, value.trim())
  }
  const value = search.toString()
  return value ? `?${value}` : ''
}

export function useAceTasks(filters: AceTaskQuery) {
  const search = queryString(filters)
  return useQuery({
    queryKey: ['ace-tasks', search],
    queryFn: () => apiGet<AceTasksResponse>(`/api/ace/tasks${search}`),
    placeholderData: (previous) => previous,
  })
}

export function useAceTask(scenarioId: string | undefined) {
  return useQuery({
    queryKey: ['ace-task', scenarioId],
    queryFn: () =>
      apiGet<AceTaskDetailResponse>(`/api/ace/tasks/${encodeURIComponent(scenarioId ?? '')}`),
    enabled: Boolean(scenarioId),
  })
}
