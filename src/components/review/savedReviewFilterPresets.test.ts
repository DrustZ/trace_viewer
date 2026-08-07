import { describe, expect, it } from 'vitest'
import type { ReviewQueueFilters } from '../../api/reviews'
import {
  deleteReviewFilterPreset,
  loadReviewFilterPresets,
  REVIEW_FILTER_PRESETS_STORAGE_KEY,
  type ReviewPresetStorage,
  reviewFiltersForPreset,
  saveReviewFilterPreset,
} from './savedReviewFilterPresets'

function memoryStorage(initial?: string): ReviewPresetStorage & { value: string | null } {
  return {
    value: initial ?? null,
    getItem(key) {
      return key === REVIEW_FILTER_PRESETS_STORAGE_KEY ? this.value : null
    },
    setItem(key, value) {
      if (key === REVIEW_FILTER_PRESETS_STORAGE_KEY) this.value = value
    },
  }
}

function assistedFilters(): ReviewQueueFilters {
  return {
    annotator: 'alice',
    rubricVersion: 'rubric-v3',
    mode: 'assisted',
    corpusId: 'simulation',
    runId: 'run-a',
    state: 'draft',
    priority: 'high',
    q: 'refund',
    tags: ['policy', 'money'],
    disagreement: true,
    limit: 200,
    offset: 120,
  }
}

describe('saved review filter presets', () => {
  it('saves, updates by case-insensitive name, applies, and deletes a named preset', () => {
    const storage = memoryStorage()
    const first = saveReviewFilterPreset(storage, 'Needs Triage', assistedFilters(), {
      id: 'preset-1',
      now: '2026-08-06T00:00:00.000Z',
    })
    expect(first.presets).toHaveLength(1)
    expect(reviewFiltersForPreset(first.preset)).toMatchObject({
      mode: 'assisted',
      corpusId: 'simulation',
      runId: 'run-a',
      state: 'draft',
      priority: 'high',
      q: 'refund',
      tags: ['policy', 'money'],
      disagreement: true,
      offset: 0,
    })
    expect(first.preset.query).not.toContain('offset=')
    expect(first.preset.query).not.toContain('limit=')

    const updated = saveReviewFilterPreset(
      storage,
      'needs triage',
      { ...assistedFilters(), priority: 'critical' },
      { id: 'ignored-new-id', now: '2026-08-06T01:00:00.000Z' },
    )
    expect(updated.presets).toHaveLength(1)
    expect(updated.preset.id).toBe('preset-1')
    expect(updated.preset.createdAt).toBe('2026-08-06T00:00:00.000Z')
    expect(reviewFiltersForPreset(updated.preset).priority).toBe('critical')

    expect(deleteReviewFilterPreset(storage, 'preset-1')).toEqual([])
    expect(loadReviewFilterPresets(storage)).toEqual([])
  })

  it('strips pagination from legacy stored presets and always applies at the first page', () => {
    const storage = memoryStorage(
      JSON.stringify({
        schemaVersion: 1,
        presets: [
          {
            id: 'legacy-page',
            name: 'Legacy page',
            query:
              'mode=assisted&annotator=alice&rubricVersion=rubric-v3&corpusId=simulation&state=draft&offset=400',
            createdAt: '2026-08-06T00:00:00.000Z',
            updatedAt: '2026-08-06T00:00:00.000Z',
          },
        ],
      }),
    )

    const [preset] = loadReviewFilterPresets(storage)
    expect(preset?.query).not.toContain('offset=')
    expect(preset && reviewFiltersForPreset(preset).offset).toBe(0)
  })

  it('strips run ids and unknown automatic fields from Calibration presets', () => {
    const storage = memoryStorage()
    const saved = saveReviewFilterPreset(
      storage,
      'Blind queue',
      {
        ...assistedFilters(),
        mode: 'calibration',
        runId: 'secret-baseline-arm',
      },
      { id: 'blind', now: '2026-08-06T00:00:00.000Z' },
    ).preset

    expect(saved.query).not.toContain('runId')
    expect(saved.query).not.toContain('secret-baseline-arm')
    expect(reviewFiltersForPreset(saved).runId).toBeUndefined()

    storage.value = JSON.stringify({
      schemaVersion: 1,
      presets: [
        {
          ...saved,
          query: `${saved.query}&model=secret-model&arm=optimized&judge=fail`,
        },
      ],
    })
    const reloaded = loadReviewFilterPresets(storage)
    expect(reloaded[0]?.query).not.toMatch(/model|arm|judge|secret/)
  })

  it('fails closed for corrupt storage and rejects unsafe names', () => {
    expect(loadReviewFilterPresets(memoryStorage('{bad json'))).toEqual([])
    const storage = memoryStorage()
    expect(() => saveReviewFilterPreset(storage, '   ', assistedFilters())).toThrow(
      'Enter a preset name.',
    )
    expect(() => saveReviewFilterPreset(storage, 'bad\nname', assistedFilters())).toThrow(
      'control characters',
    )
  })
})
