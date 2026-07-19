import { FILTER_KEY_MAP } from './keys'
import type { FilterCondition, FilterOp, FilterSet } from './types'

const FILTER_OPS: ReadonlySet<string> = new Set([
  'eq',
  'neq',
  'lt',
  'lte',
  'gt',
  'gte',
  'contains',
  'in',
])

function isFilterOp(s: string): s is FilterOp {
  return FILTER_OPS.has(s)
}

/**
 * Compact codec shared by URLs and the API: `key.op.value` segments joined by
 * ';', values URI-encoded ('in' values joined by '|' before encoding).
 */
export function encodeFilterSet(fs: FilterSet): string {
  return fs.conditions
    .map((c) => {
      const raw = Array.isArray(c.value) ? c.value.map(String).join('|') : String(c.value)
      return `${c.key}.${c.op}.${encodeURIComponent(raw)}`
    })
    .join(';')
}

/**
 * Tolerant decoder: malformed segments, unknown keys/ops and empty values are
 * dropped silently. Values stay strings; `evaluateFilter` normalizes types.
 */
export function decodeFilterSet(s: string | null | undefined): FilterSet {
  const conditions: FilterCondition[] = []
  if (!s) return { conditions }
  for (const part of s.split(';')) {
    // Split on the first two dots only — values may contain dots (floats, component paths).
    const firstDot = part.indexOf('.')
    if (firstDot < 0) continue
    const secondDot = part.indexOf('.', firstDot + 1)
    if (secondDot < 0) continue
    const key = part.slice(0, firstDot)
    const op = part.slice(firstDot + 1, secondDot)
    const encoded = part.slice(secondDot + 1)
    if (!FILTER_KEY_MAP.has(key) || !isFilterOp(op) || encoded === '') continue
    let decoded: string
    try {
      decoded = decodeURIComponent(encoded)
    } catch {
      continue
    }
    if (decoded === '') continue
    if (op === 'in') {
      const values = decoded.split('|').filter((v) => v !== '')
      if (values.length === 0) continue
      conditions.push({ key, op, value: values })
    } else {
      conditions.push({ key, op, value: decoded })
    }
  }
  return { conditions }
}
