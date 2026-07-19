import { decodeFilterSet, encodeFilterSet } from '@shared/filter/parse'
import type { FilterCondition } from '@shared/filter/types'
import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { ListParams } from '../api/hooks'

/** URL search keys owned by the list views. Anything else (tab, msg, ...) is preserved. */
const LIST_PARAM_KEYS = [
  'split',
  'step',
  'component',
  'status',
  'filters',
  'q',
  'sort',
  'order',
  'group',
  'groupAvgLt',
  'groupAvgGte',
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
    groupAvgLt: get('groupAvgLt'),
    groupAvgGte: get('groupAvgGte'),
    limit: Number.isNaN(limit) ? undefined : limit,
  }
}

/**
 * Components selected via the filters DSL, plus the legacy ?component param
 * (read-only back-compat for old deep links — the UI never writes it anymore).
 */
export function selectedComponents(params: ListParams): Set<string> {
  const selected = new Set<string>()
  if (params.component) selected.add(params.component)
  for (const c of decodeFilterSet(params.filters).conditions) {
    if (c.key !== 'component') continue
    if (Array.isArray(c.value)) for (const v of c.value) selected.add(String(v))
    else if (c.op === 'eq') selected.add(String(c.value))
  }
  return selected
}

/**
 * Patch that replaces the component.* conditions inside the filters DSL with
 * `next`, preserving every other condition. Always clears the legacy
 * ?component param so the DSL stays the single source of truth.
 */
export function componentSelectionPatch(
  params: ListParams,
  next: ReadonlySet<string>,
): ListParamPatch {
  const others = decodeFilterSet(params.filters).conditions.filter((c) => c.key !== 'component')
  const values = [...next].sort()
  const conditions: FilterCondition[] = [...others]
  if (values.length === 1 && values[0] !== undefined) {
    conditions.push({ key: 'component', op: 'eq', value: values[0] })
  } else if (values.length > 1) {
    conditions.push({ key: 'component', op: 'in', value: values })
  }
  return { filters: encodeFilterSet({ conditions }) || undefined, component: undefined }
}

/** Toggle one component in the DSL selection (dataset-row / checkbox click semantics). */
export function toggleComponentPatch(params: ListParams, component: string): ListParamPatch {
  const next = selectedComponents(params)
  if (next.has(component)) next.delete(component)
  else next.add(component)
  return componentSelectionPatch(params, next)
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
