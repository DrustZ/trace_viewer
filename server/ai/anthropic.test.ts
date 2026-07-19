import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { type EmitFilterClient, nlToFilter } from './anthropic'

const CTX = { components: ['code/leetcode', 'swe/swebench-verified-mini'], steps: [100, 200] }

type CreateMock = Mock<EmitFilterClient['messages']['create']>

function fakeClient(create: CreateMock): EmitFilterClient {
  return { messages: { create } }
}

function toolUseResponse(input: unknown) {
  return { content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit_filter', input }] }
}

describe('nlToFilter', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('passes a valid tool_use result through as an llm filter', async () => {
    const create: CreateMock = vi.fn().mockResolvedValue(
      toolUseResponse({
        conditions: [
          { key: 'score', op: 'gt', value: 0.5 },
          { key: 'component', op: 'eq', value: 'code/leetcode' },
        ],
        explanation: 'High-scoring leetcode traces',
      }),
    )
    const result = await nlToFilter('good leetcode runs', CTX, fakeClient(create))

    expect(create).toHaveBeenCalledTimes(1)
    const [params, options] = create.mock.calls[0]
    expect(params.tool_choice).toEqual({ type: 'tool', name: 'emit_filter' })
    expect(options?.signal).toBeInstanceOf(AbortSignal)
    expect(result.source).toBe('llm')
    expect(result.explanation).toBe('High-scoring leetcode traces')
    expect(result.filter.conditions).toEqual([
      { key: 'score', op: 'gt', value: 0.5 },
      { key: 'component', op: 'eq', value: 'code/leetcode' },
    ])
  })

  it('accepts groupByInstance for group-average queries and advertises it in the tool schema', async () => {
    const create: CreateMock = vi.fn().mockResolvedValue(
      toolUseResponse({
        conditions: [{ key: 'step', op: 'eq', value: 125 }],
        groupByInstance: true,
        explanation: 'Step-125 traces grouped by instance; averages appear on the group rows',
      }),
    )
    const result = await nlToFilter(
      'at step 125, the groups with avg rollout reward < 0.5',
      CTX,
      fakeClient(create),
    )

    expect(result.source).toBe('llm')
    expect(result.groupByInstance).toBe(true)
    // Only the truly per-trace condition — no per-trace score.lt masquerading as an average.
    expect(result.filter.conditions).toEqual([{ key: 'step', op: 'eq', value: 125 }])

    const [params] = create.mock.calls[0]
    const tool = params.tools?.[0] as { input_schema: { properties: Record<string, unknown> } }
    expect(tool.input_schema.properties).toHaveProperty('groupByInstance')
    expect(String(params.system)).toContain('groupByInstance')
  })

  it('omits groupByInstance when the model does not set it', async () => {
    const create: CreateMock = vi.fn().mockResolvedValue(
      toolUseResponse({
        conditions: [{ key: 'score', op: 'gt', value: 0.5 }],
        explanation: 'per-trace',
      }),
    )
    const result = await nlToFilter('score above 0.5', CTX, fakeClient(create))
    expect(result.source).toBe('llm')
    expect(result.groupByInstance).toBeUndefined()
    expect('groupByInstance' in result).toBe(false)
  })

  it('falls back to rules when the tool_use input has an unknown key', async () => {
    const create: CreateMock = vi.fn().mockResolvedValue(
      toolUseResponse({
        conditions: [{ key: 'bogusKey', op: 'eq', value: 1 }],
        explanation: 'nope',
      }),
    )
    const result = await nlToFilter('score > 0.5', CTX, fakeClient(create))

    expect(create).toHaveBeenCalledTimes(1)
    expect(result.source).toBe('rules')
    expect(result.filter.conditions).toEqual([{ key: 'score', op: 'gt', value: 0.5 }])
  })

  it('falls back to rules when the API call throws', async () => {
    const create: CreateMock = vi.fn().mockRejectedValue(new Error('boom'))
    const result = await nlToFilter('failed traces', CTX, fakeClient(create))

    expect(create).toHaveBeenCalledTimes(1)
    expect(result.source).toBe('rules')
    expect(result.filter.conditions).toEqual([{ key: 'status', op: 'eq', value: 'failed' }])
  })

  it('skips straight to rules when ANTHROPIC_API_KEY is unset', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    const create: CreateMock = vi.fn().mockResolvedValue(
      toolUseResponse({
        conditions: [{ key: 'score', op: 'eq', value: 0 }],
        explanation: 'should never be used',
      }),
    )
    const result = await nlToFilter('truncated traces', CTX, fakeClient(create))

    expect(create).not.toHaveBeenCalled()
    expect(result.source).toBe('rules')
    expect(result.filter.conditions).toEqual([{ key: 'truncated', op: 'eq', value: true }])
  })
})
