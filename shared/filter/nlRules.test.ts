import { describe, expect, it } from 'vitest'
import { parseNlQuery } from './nlRules'
import type { FilterCondition } from './types'

const COMPONENTS = ['swe/swebench-verified-mini', 'agentic_coding/terminal-bench', 'math/aime-2025']

function sorted(conditions: FilterCondition[]): FilterCondition[] {
  return [...conditions].sort((a, b) => `${a.key}.${a.op}`.localeCompare(`${b.key}.${b.op}`))
}

describe('parseNlQuery', () => {
  const cases: Array<{ query: string; expected: FilterCondition[] }> = [
    { query: 'score < 0.2', expected: [{ key: 'score', op: 'lt', value: 0.2 }] },
    { query: 'reward above 0.8', expected: [{ key: 'score', op: 'gt', value: 0.8 }] },
    { query: 'score at least 0.5', expected: [{ key: 'score', op: 'gte', value: 0.5 }] },
    { query: 'reward under 1', expected: [{ key: 'score', op: 'lt', value: 1 }] },
    { query: '分数低于0.3', expected: [{ key: 'score', op: 'lt', value: 0.3 }] },
    { query: 'failed traces', expected: [{ key: 'status', op: 'eq', value: 'failed' }] },
    { query: 'failures', expected: [{ key: 'status', op: 'eq', value: 'failed' }] },
    { query: 'successful rollouts', expected: [{ key: 'score', op: 'gt', value: 0 }] },
    { query: 'traces that passed', expected: [{ key: 'score', op: 'gt', value: 0 }] },
    { query: 'wrong answers', expected: [{ key: 'score', op: 'eq', value: 0 }] },
    { query: 'zero score', expected: [{ key: 'score', op: 'eq', value: 0 }] },
    { query: 'truncated traces', expected: [{ key: 'truncated', op: 'eq', value: true }] },
    { query: 'traces with errors', expected: [{ key: 'hasError', op: 'eq', value: true }] },
    { query: 'still executing', expected: [{ key: 'status', op: 'eq', value: 'executing' }] },
    { query: 'train split', expected: [{ key: 'split', op: 'eq', value: 'train' }] },
    { query: '测试', expected: [{ key: 'split', op: 'eq', value: 'test' }] },
    { query: 'at step 150', expected: [{ key: 'step', op: 'eq', value: 150 }] },
    { query: 'checkpoint 150', expected: [{ key: 'step', op: 'eq', value: 150 }] },
    { query: 'after step 100', expected: [{ key: 'step', op: 'gt', value: 100 }] },
    { query: 'before step 100', expected: [{ key: 'step', op: 'lt', value: 100 }] },
    { query: 'more than 8 turns', expected: [{ key: 'turns', op: 'gt', value: 8 }] },
    { query: 'long traces', expected: [{ key: 'turns', op: 'gte', value: 10 }] },
    { query: 'over 5000 tokens', expected: [{ key: 'totalTokens', op: 'gt', value: 5000 }] },
    { query: 'slow traces', expected: [{ key: 'durationMs', op: 'gt', value: 60000 }] },
    {
      query: 'swebench traces',
      expected: [{ key: 'component', op: 'eq', value: 'swe/swebench-verified-mini' }],
    },
    {
      query: 'bench traces',
      expected: [{ key: 'component', op: 'contains', value: 'bench' }],
    },
    {
      query: 'failed swe traces with score < 0.2 after step 100',
      expected: [
        { key: 'component', op: 'eq', value: 'swe/swebench-verified-mini' },
        { key: 'score', op: 'lt', value: 0.2 },
        { key: 'status', op: 'eq', value: 'failed' },
        { key: 'step', op: 'gt', value: 100 },
      ],
    },
    {
      query: 'truncated aime traces with errors',
      expected: [
        { key: 'component', op: 'eq', value: 'math/aime-2025' },
        { key: 'hasError', op: 'eq', value: true },
        { key: 'truncated', op: 'eq', value: true },
      ],
    },
  ]

  it.each(cases)('parses "$query"', ({ query, expected }) => {
    const { filter, explanation } = parseNlQuery(query, { components: COMPONENTS })
    expect(sorted(filter.conditions)).toEqual(sorted(expected))
    expect(explanation.startsWith('Filtering:')).toBe(true)
  })

  it('returns an empty filter and says so for unrecognized queries', () => {
    const { filter, explanation } = parseNlQuery('purple elephants dancing', {
      components: COMPONENTS,
    })
    expect(filter.conditions).toEqual([])
    expect(explanation).toContain('No filters recognized')
    expect(explanation).toContain('purple elephants dancing')
  })

  it('mentions every recognized clause in the explanation', () => {
    const { explanation } = parseNlQuery('failed traces with score < 0.2', {
      components: COMPONENTS,
    })
    expect(explanation).toContain('status = failed')
    expect(explanation).toContain('score < 0.2')
  })

  it('does not fuzzy-match components when no token qualifies', () => {
    const { filter } = parseNlQuery('show me all traces', { components: COMPONENTS })
    expect(filter.conditions).toEqual([])
  })
})
