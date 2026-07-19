import { evaluateFilter } from '../../shared/filter/evaluate'
import { getKeyValue } from '../../shared/filter/keys'
import { decodeFilterSet } from '../../shared/filter/parse'
import type { TraceSummary } from '../../shared/schema/types'
import { firstParam, type RouteCtx } from './context'

export interface ListParamDeps {
  /** Search-index membership for `q`, unioned with the summary-field substring match. */
  matchingIds?: (q: string) => Set<string>
}

function compareValues(a: string | number | boolean, b: string | number | boolean): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  const sa = String(a)
  const sb = String(b)
  return sa < sb ? -1 : sa > sb ? 1 : 0
}

/**
 * The one filtering/sorting pipeline shared by /api/traces, neighbors and
 * tiles: exact-match params, then filter DSL, then keyword, then sort.
 */
export function applyListParams(
  summaries: TraceSummary[],
  query: Record<string, unknown>,
  deps: ListParamDeps = {},
): TraceSummary[] {
  let items = summaries

  const split = firstParam(query.split)
  if (split) items = items.filter((s) => s.meta.split === split)
  const step = firstParam(query.step)
  if (step) {
    const stepNum = Number(step)
    items = items.filter((s) => s.meta.checkpointStep === stepNum)
  }
  const component = firstParam(query.component)
  if (component) items = items.filter((s) => s.meta.component === component)
  const status = firstParam(query.status)
  if (status) items = items.filter((s) => s.meta.status === status)

  const filter = decodeFilterSet(firstParam(query.filters))
  if (filter.conditions.length > 0) items = items.filter((s) => evaluateFilter(s, filter))

  const q = firstParam(query.q)?.trim()
  if (q) {
    const needle = q.toLowerCase()
    const indexIds = deps.matchingIds?.(q) ?? new Set<string>()
    items = items.filter(
      (s) =>
        s.meta.traceId.toLowerCase().includes(needle) ||
        s.meta.instanceId.toLowerCase().includes(needle) ||
        s.meta.component.toLowerCase().includes(needle) ||
        indexIds.has(s.meta.traceId),
    )
  }

  const sort = firstParam(query.sort) ?? 'time'
  const desc = (firstParam(query.order) ?? 'desc') !== 'asc'
  const value = (s: TraceSummary): string | number | boolean | undefined =>
    sort === 'time' ? s.meta.timestamp : getKeyValue(s, sort)

  return [...items].sort((a, b) => {
    const va = value(a)
    const vb = value(b)
    let cmp = 0
    if (va === undefined || vb === undefined) {
      // Undefined sorts last regardless of direction.
      if (va !== vb) return va === undefined ? 1 : -1
    } else {
      cmp = compareValues(va, vb)
      if (desc) cmp = -cmp
    }
    if (cmp !== 0) return cmp
    return a.meta.traceId < b.meta.traceId ? -1 : a.meta.traceId > b.meta.traceId ? 1 : 0
  })
}

/** applyListParams over the whole store with the search index wired in. */
export function appliedSummaries(ctx: RouteCtx, query: Record<string, unknown>): TraceSummary[] {
  return applyListParams(ctx.store.list(), query, {
    matchingIds: (q) => ctx.searchIndex.matchingIds(q),
  })
}
