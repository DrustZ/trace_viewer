/**
 * Filter DSL — one encoding used by the URL, the filter-builder UI, the API
 * and the AI filter. Conditions AND together; `in` provides OR within a key.
 */

export type FilterOp = 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains' | 'in'

export type FilterValue = string | number | boolean | Array<string | number>

export interface FilterCondition {
  key: string
  op: FilterOp
  value: FilterValue
}

export interface FilterSet {
  conditions: FilterCondition[]
}

export type FilterKeyType = 'number' | 'string' | 'boolean' | 'enum'

/** Registry entry describing one filterable key (single source of truth for builder UI + evaluator + AI filter). */
export interface FilterKeyDef {
  id: string
  label: string
  type: FilterKeyType
  /** Where enum options come from, resolved by the server's /api/meta. */
  enumSource?: 'components' | 'steps' | 'splits' | 'statuses'
  description: string
}
