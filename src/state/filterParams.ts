import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { ListParams } from '../api/hooks'

/** URL search keys owned by the list views. Anything else (tab, msg, ...) is preserved. */
export const LIST_PARAM_KEYS = [
  'split',
  'step',
  'component',
  'status',
  'filters',
  'q',
  'sort',
  'order',
  'group',
  'limit',
] as const

export type ListParamKey = (typeof LIST_PARAM_KEYS)[number]

export type ListParamPatch = Partial<Record<ListParamKey, string | undefined>>

export function searchToListParams(search: URLSearchParams): ListParams {
  const get = (key: string) => search.get(key) ?? undefined
  const rawLimit = search.get('limit')
  const limit = rawLimit !== null ? Number.parseInt(rawLimit, 10) : Number.NaN
  return {
    split: get('split'),
    step: get('step'),
    component: get('component'),
    status: get('status'),
    filters: get('filters'),
    q: get('q'),
    sort: get('sort'),
    order: get('order'),
    groupBy: search.get('group') === 'instance' ? 'instance' : undefined,
    limit: Number.isNaN(limit) ? undefined : limit,
  }
}

export function useListParams() {
  const [search, setSearch] = useSearchParams()
  const params = useMemo(() => searchToListParams(search), [search])

  // Batch setter: sequential setSearchParams calls in one tick see stale state.
  const setParams = useCallback(
    (patch: ListParamPatch) => {
      setSearch(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [key, value] of Object.entries(patch)) {
            if (value === undefined || value === '') next.delete(key)
            else next.set(key, value)
          }
          return next
        },
        { replace: true },
      )
    },
    [setSearch],
  )

  const setParam = useCallback(
    (key: ListParamKey, value: string | undefined) => setParams({ [key]: value }),
    [setParams],
  )

  const clearAll = useCallback(() => {
    setSearch(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const key of LIST_PARAM_KEYS) next.delete(key)
        return next
      },
      { replace: true },
    )
  }, [setSearch])

  return { params, setParam, setParams, clearAll }
}
