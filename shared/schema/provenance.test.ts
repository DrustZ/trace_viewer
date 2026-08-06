import { describe, expect, it } from 'vitest'
import {
  hasRecordedCheckpoint,
  recordedCheckpoint,
  withDefaultCheckpointProvenance,
} from './provenance'
import type { TraceMeta } from './types'

function meta(checkpointStep: number, normalization?: unknown): TraceMeta {
  return {
    traceId: 't',
    instanceId: 'i',
    component: 'c',
    status: 'unknown',
    timestamp: '2026-01-01T00:00:00.000Z',
    checkpointStep,
    split: 'unknown',
    sourceFormat: 'test',
    ...(normalization !== undefined ? { extra: { normalization } } : {}),
  }
}

describe('checkpoint provenance', () => {
  it('keeps a source-recorded zero checkpoint', () => {
    const value = meta(0)
    expect(hasRecordedCheckpoint(value)).toBe(true)
    expect(recordedCheckpoint(value)).toBe(0)
  })

  it('hides a compatibility default even though its stored value is zero', () => {
    const value = meta(0, { checkpointStep: 'default' })
    expect(hasRecordedCheckpoint(value)).toBe(false)
    expect(recordedCheckpoint(value)).toBeNull()
  })

  it('does not treat malformed provenance as authoritative', () => {
    expect(hasRecordedCheckpoint(meta(7, 'default'))).toBe(true)
    expect(hasRecordedCheckpoint(meta(7, { checkpointStep: 0 }))).toBe(true)
  })

  it('adds checkpoint provenance without discarding existing extra or normalization fields', () => {
    expect(
      withDefaultCheckpointProvenance({
        object: 'chat.completion',
        normalization: { status: 'source_missing' },
      }),
    ).toEqual({
      object: 'chat.completion',
      normalization: { status: 'source_missing', checkpointStep: 'default' },
    })
  })
})
