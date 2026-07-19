import type { Message } from '@shared/schema/types'
import { describe, expect, it } from 'vitest'
import { buildUnits, type StepUnit, stepHasToolCalls, stepScore, unitDurationMs } from './unitize'

let nextId = 0
function msg(over: Partial<Message>): Message {
  nextId += 1
  return { id: `m-${nextId}`, role: 'user', content: '', ...over }
}

function asStep(unit: ReturnType<typeof buildUnits>[number]): StepUnit {
  if (unit.kind !== 'step') throw new Error(`expected step unit, got ${unit.kind}`)
  return unit
}

describe('buildUnits', () => {
  it('groups analysis + commentary + final of one step into a single unit', () => {
    const analysis = msg({ role: 'assistant', channel: 'analysis', stepIndex: 1, content: 'think' })
    const commentary = msg({
      role: 'assistant',
      channel: 'commentary',
      stepIndex: 1,
      toolCalls: [{ id: 'c1', name: 'bash', arguments: '{"cmd":"ls"}' }],
    })
    const final = msg({ role: 'assistant', channel: 'final', stepIndex: 1, content: 'done' })
    const units = buildUnits([msg({ role: 'user', content: 'hi' }), analysis, commentary, final])

    expect(units).toHaveLength(2)
    expect(units[0].kind).toBe('single')
    const step = asStep(units[1])
    expect(step.stepIndex).toBe(1)
    expect(step.id).toBe(analysis.id) // keyed by first message id
    expect(step.messages).toEqual([analysis, commentary, final])
    expect(step.analysis).toEqual([analysis])
    expect(step.responses).toEqual([commentary, final])
  })

  it('keeps tool results standalone, carrying the invoking step index', () => {
    const tool = msg({
      role: 'tool',
      stepIndex: 1,
      content: 'ok',
      toolResult: { toolCallId: 'c1', isError: false },
    })
    const units = buildUnits([
      msg({ role: 'assistant', channel: 'analysis', stepIndex: 1 }),
      msg({
        role: 'assistant',
        channel: 'commentary',
        stepIndex: 1,
        toolCalls: [{ id: 'c1', name: 'bash', arguments: '{}' }],
      }),
      tool,
      msg({ role: 'assistant', channel: 'analysis', stepIndex: 2 }),
    ])

    expect(units.map((u) => u.kind)).toEqual(['step', 'single', 'step'])
    const toolUnit = units[1]
    expect(toolUnit.kind).toBe('single')
    if (toolUnit.kind === 'single') {
      expect(toolUnit.message).toBe(tool)
      expect(toolUnit.message.stepIndex).toBe(1) // attribution preserved, not nested
    }
  })

  it('splits directly adjacent assistant messages with different stepIndex into consecutive steps', () => {
    const units = buildUnits([
      msg({ role: 'assistant', channel: 'analysis', stepIndex: 1 }),
      msg({ role: 'assistant', channel: 'final', stepIndex: 1 }),
      msg({ role: 'assistant', channel: 'analysis', stepIndex: 2 }),
      msg({ role: 'assistant', channel: 'final', stepIndex: 2 }),
    ])

    expect(units.map((u) => u.kind)).toEqual(['step', 'step'])
    expect(asStep(units[0]).stepIndex).toBe(1)
    expect(asStep(units[0]).messages).toHaveLength(2)
    expect(asStep(units[1]).stepIndex).toBe(2)
    expect(asStep(units[1]).messages).toHaveLength(2)
  })

  it('emits only single units for traces with no assistant messages', () => {
    const units = buildUnits([
      msg({ role: 'system', content: 'sys' }),
      msg({ role: 'user', content: 'q' }),
      msg({ role: 'tool', content: 'out', toolResult: { toolCallId: 'x', isError: true } }),
    ])
    expect(units).toHaveLength(3)
    expect(units.every((u) => u.kind === 'single')).toBe(true)
  })

  it('groups contiguous assistant messages without stepIndex into one unnumbered step', () => {
    const units = buildUnits([
      msg({ role: 'assistant', channel: 'analysis' }),
      msg({ role: 'assistant', channel: 'final' }),
    ])
    expect(units).toHaveLength(1)
    const step = asStep(units[0])
    expect(step.stepIndex).toBeUndefined()
    expect(step.messages).toHaveLength(2)
  })

  it('separates an unnumbered assistant message from a numbered neighbor', () => {
    const units = buildUnits([
      msg({ role: 'assistant', channel: 'final' }),
      msg({ role: 'assistant', channel: 'final', stepIndex: 1 }),
    ])
    expect(units.map((u) => u.kind)).toEqual(['step', 'step'])
    expect(asStep(units[0]).stepIndex).toBeUndefined()
    expect(asStep(units[1]).stepIndex).toBe(1)
  })

  it('does not merge same-stepIndex assistant runs interrupted by a tool result', () => {
    const units = buildUnits([
      msg({ role: 'assistant', channel: 'commentary', stepIndex: 1 }),
      msg({ role: 'tool', stepIndex: 1, toolResult: { toolCallId: 'x', isError: false } }),
      msg({ role: 'assistant', channel: 'final', stepIndex: 1 }),
    ])
    expect(units.map((u) => u.kind)).toEqual(['step', 'single', 'step'])
  })

  it('returns an empty list for an empty trace', () => {
    expect(buildUnits([])).toEqual([])
  })
})

describe('unitDurationMs', () => {
  it('sums assistant durations across the step and ignores missing ones', () => {
    const step = asStep(
      buildUnits([
        msg({ role: 'assistant', channel: 'analysis', stepIndex: 1, durationMs: 700 }),
        msg({ role: 'assistant', channel: 'commentary', stepIndex: 1 }),
        msg({ role: 'assistant', channel: 'final', stepIndex: 1, durationMs: 300 }),
      ])[0],
    )
    expect(unitDurationMs(step)).toBe(1000)
  })

  it('is undefined when no message in the step has a duration', () => {
    const step = asStep(buildUnits([msg({ role: 'assistant', stepIndex: 1 })])[0])
    expect(unitDurationMs(step)).toBeUndefined()
  })

  it('passes through the message duration for single units', () => {
    const units = buildUnits([msg({ role: 'user', durationMs: 42 })])
    expect(unitDurationMs(units[0])).toBe(42)
  })
})

describe('stepScore', () => {
  it('returns the last defined per-message score', () => {
    const step = asStep(
      buildUnits([
        msg({ role: 'assistant', channel: 'analysis', stepIndex: 1, score: 0.2 }),
        msg({ role: 'assistant', channel: 'final', stepIndex: 1, score: 0.9 }),
      ])[0],
    )
    expect(stepScore(step)).toBe(0.9)
  })

  it('is undefined when no message is scored', () => {
    const step = asStep(buildUnits([msg({ role: 'assistant', stepIndex: 1 })])[0])
    expect(stepScore(step)).toBeUndefined()
  })
})

describe('stepHasToolCalls', () => {
  it('is true when any response carries tool calls', () => {
    const step = asStep(
      buildUnits([
        msg({ role: 'assistant', channel: 'analysis', stepIndex: 1 }),
        msg({
          role: 'assistant',
          channel: 'commentary',
          stepIndex: 1,
          toolCalls: [{ id: 'c', name: 'search', arguments: '{}' }],
        }),
      ])[0],
    )
    expect(stepHasToolCalls(step)).toBe(true)
  })

  it('is false for a pure final step', () => {
    const step = asStep(
      buildUnits([
        msg({ role: 'assistant', channel: 'final', stepIndex: 1, content: 'answer' }),
      ])[0],
    )
    expect(stepHasToolCalls(step)).toBe(false)
  })
})
