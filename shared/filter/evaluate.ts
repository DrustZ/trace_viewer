import type { TraceSummary } from '../schema/types'
import { getKeyValue } from './keys'
import type { FilterCondition, FilterSet } from './types'

type Scalar = string | number | boolean

function toNumber(v: Scalar): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '') return Number(v)
  return Number.NaN
}

/** Loose-typed equality: the key's value type wins, the operand is normalized to it. */
function looseEquals(value: Scalar, operand: Scalar): boolean {
  if (typeof value === 'boolean') {
    if (typeof operand === 'boolean') return value === operand
    if (operand === 'true') return value
    if (operand === 'false') return !value
    return false
  }
  if (typeof value === 'number') {
    const n = toNumber(operand)
    return !Number.isNaN(n) && value === n
  }
  return value === String(operand)
}

function compareNumeric(op: 'lt' | 'lte' | 'gt' | 'gte', value: Scalar, operand: Scalar): boolean {
  if (typeof value === 'boolean' || typeof operand === 'boolean') return false
  const left = toNumber(value)
  const right = toNumber(operand)
  if (Number.isNaN(left) || Number.isNaN(right)) return false
  switch (op) {
    case 'lt':
      return left < right
    case 'lte':
      return left <= right
    case 'gt':
      return left > right
    case 'gte':
      return left >= right
  }
}

function evaluateCondition(summary: TraceSummary, cond: FilterCondition): boolean {
  const value = getKeyValue(summary, cond.key)
  if (value === undefined) return false
  switch (cond.op) {
    case 'eq':
      return !Array.isArray(cond.value) && looseEquals(value, cond.value)
    case 'neq':
      return !Array.isArray(cond.value) && !looseEquals(value, cond.value)
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte':
      return !Array.isArray(cond.value) && compareNumeric(cond.op, value, cond.value)
    case 'contains':
      return String(value).toLowerCase().includes(String(cond.value).toLowerCase())
    case 'in': {
      const list = Array.isArray(cond.value) ? cond.value : [cond.value]
      return list.some((v) => looseEquals(value, v))
    }
  }
}

export function evaluateFilter(summary: TraceSummary, filter: FilterSet): boolean {
  return filter.conditions.every((c) => evaluateCondition(summary, c))
}

export function filterSummaries(items: TraceSummary[], filter: FilterSet): TraceSummary[] {
  if (filter.conditions.length === 0) return items
  return items.filter((s) => evaluateFilter(s, filter))
}
