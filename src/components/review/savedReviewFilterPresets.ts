import type { ReviewQueueFilters } from '../../api/reviews'
import {
  reviewQueueFiltersFromSearchParams,
  reviewQueueFiltersToSearchParams,
} from './reviewQueueState'

export const REVIEW_FILTER_PRESETS_STORAGE_KEY = 'ace.trace-viewer.review-filter-presets.v1'

const MAX_PRESETS = 50
const MAX_NAME_LENGTH = 64
const MAX_QUERY_LENGTH = 4_096

export interface SavedReviewFilterPreset {
  id: string
  name: string
  /** Canonical shareable URL query, deliberately excluding pagination. */
  query: string
  createdAt: string
  updatedAt: string
}

export type ReviewPresetStorage = Pick<Storage, 'getItem' | 'setItem'>

interface StoredReviewFilterPresets {
  schemaVersion: 1
  presets: SavedReviewFilterPreset[]
}

function withoutPagination(filters: ReviewQueueFilters): ReviewQueueFilters {
  const { limit: _limit, offset: _offset, ...filterConditions } = filters
  return filterConditions
}

function canonicalPresetQuery(query: string): string {
  return reviewQueueFiltersToSearchParams(
    withoutPagination(reviewQueueFiltersFromSearchParams(new URLSearchParams(query))),
  ).toString()
}

function parsePreset(value: unknown): SavedReviewFilterPreset | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.id !== 'string' ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(candidate.id) ||
    typeof candidate.name !== 'string' ||
    candidate.name.trim().length === 0 ||
    candidate.name.length > MAX_NAME_LENGTH ||
    typeof candidate.query !== 'string' ||
    candidate.query.length > MAX_QUERY_LENGTH ||
    typeof candidate.createdAt !== 'string' ||
    typeof candidate.updatedAt !== 'string'
  ) {
    return null
  }
  return {
    id: candidate.id,
    name: candidate.name.trim(),
    query: canonicalPresetQuery(candidate.query),
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
  }
}

export function normalizeReviewFilterPresetName(name: string): string {
  for (const character of name) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint <= 31 || codePoint === 127) {
      throw new Error('Preset names cannot contain control characters.')
    }
  }
  const normalized = name.trim().replace(/\s+/g, ' ')
  if (!normalized) throw new Error('Enter a preset name.')
  if (normalized.length > MAX_NAME_LENGTH) {
    throw new Error(`Preset names must be ${MAX_NAME_LENGTH} characters or fewer.`)
  }
  return normalized
}

export function loadReviewFilterPresets(storage: ReviewPresetStorage): SavedReviewFilterPreset[] {
  try {
    const raw = storage.getItem(REVIEW_FILTER_PRESETS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return []
    const envelope = parsed as Partial<StoredReviewFilterPresets>
    if (envelope.schemaVersion !== 1 || !Array.isArray(envelope.presets)) return []
    const byId = new Map<string, SavedReviewFilterPreset>()
    for (const value of envelope.presets.slice(0, MAX_PRESETS)) {
      const preset = parsePreset(value)
      if (preset && !byId.has(preset.id)) byId.set(preset.id, preset)
    }
    return [...byId.values()]
  } catch {
    return []
  }
}

function persistReviewFilterPresets(
  storage: ReviewPresetStorage,
  presets: readonly SavedReviewFilterPreset[],
): void {
  const envelope: StoredReviewFilterPresets = {
    schemaVersion: 1,
    presets: presets.slice(0, MAX_PRESETS),
  }
  storage.setItem(REVIEW_FILTER_PRESETS_STORAGE_KEY, JSON.stringify(envelope))
}

export function saveReviewFilterPreset(
  storage: ReviewPresetStorage,
  name: string,
  filters: ReviewQueueFilters,
  options: { now?: string; id?: string } = {},
): { preset: SavedReviewFilterPreset; presets: SavedReviewFilterPreset[] } {
  const normalizedName = normalizeReviewFilterPresetName(name)
  const presets = loadReviewFilterPresets(storage)
  const existing = presets.find(
    (preset) => preset.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase(),
  )
  const now = options.now ?? new Date().toISOString()
  const id =
    existing?.id ?? options.id ?? globalThis.crypto?.randomUUID?.() ?? `preset-${Date.now()}`
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(id)) throw new Error('Could not create a safe preset id.')
  const preset: SavedReviewFilterPreset = {
    id,
    name: normalizedName,
    query: reviewQueueFiltersToSearchParams(withoutPagination(filters)).toString(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  const next = existing
    ? presets.map((candidate) => (candidate.id === existing.id ? preset : candidate))
    : [preset, ...presets].slice(0, MAX_PRESETS)
  persistReviewFilterPresets(storage, next)
  return { preset, presets: next }
}

export function deleteReviewFilterPreset(
  storage: ReviewPresetStorage,
  id: string,
): SavedReviewFilterPreset[] {
  const next = loadReviewFilterPresets(storage).filter((preset) => preset.id !== id)
  persistReviewFilterPresets(storage, next)
  return next
}

export function reviewFiltersForPreset(preset: SavedReviewFilterPreset): ReviewQueueFilters {
  return {
    ...reviewQueueFiltersFromSearchParams(new URLSearchParams(preset.query)),
    offset: 0,
  }
}
