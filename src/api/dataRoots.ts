import type {
  AddDataRootRequest,
  AddDataRootResponse,
  DataRootsResponse,
} from '@shared/schema/dataRoots'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from './client'

export function useDataRoots() {
  return useQuery({
    queryKey: ['data-roots'],
    queryFn: () => apiGet<DataRootsResponse>('/api/data-roots'),
  })
}

export function useAddDataRoot() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: AddDataRootRequest) =>
      apiPost<AddDataRootResponse>('/api/data-roots', request),
    onSuccess: () => queryClient.invalidateQueries(),
  })
}
