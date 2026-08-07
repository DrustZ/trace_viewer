import { useEffect, useMemo, useState } from 'react'
import type { ReviewQueueFilters } from '../../api/reviews'
import {
  deleteReviewFilterPreset,
  loadReviewFilterPresets,
  reviewFiltersForPreset,
  type SavedReviewFilterPreset,
  saveReviewFilterPreset,
} from './savedReviewFilterPresets'

export interface ReviewFilterPresetsProps {
  filters: ReviewQueueFilters
  onApply: (filters: ReviewQueueFilters) => void
}

function localPresetStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function ReviewFilterPresets({ filters, onApply }: ReviewFilterPresetsProps) {
  const [presets, setPresets] = useState<SavedReviewFilterPreset[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [name, setName] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const selected = useMemo(
    () => presets.find((preset) => preset.id === selectedId) ?? null,
    [presets, selectedId],
  )

  useEffect(() => {
    const storage = localPresetStorage()
    if (!storage) {
      setNotice('Local preset storage is unavailable in this browser.')
      return
    }
    setPresets(loadReviewFilterPresets(storage))
  }, [])

  const saveCurrent = () => {
    const storage = localPresetStorage()
    if (!storage) {
      setNotice('Local preset storage is unavailable in this browser.')
      return
    }
    try {
      const result = saveReviewFilterPreset(storage, name, filters)
      setPresets(result.presets)
      setSelectedId(result.preset.id)
      setName(result.preset.name)
      setNotice(`Saved “${result.preset.name}” in this browser.`)
    } catch (error) {
      setNotice(errorText(error))
    }
  }

  const applySelected = () => {
    if (!selected) return
    onApply(reviewFiltersForPreset(selected))
    setName(selected.name)
    setNotice(`Applied “${selected.name}”; the current filters are now in the URL.`)
  }

  const deleteSelected = () => {
    if (!selected) return
    const storage = localPresetStorage()
    if (!storage) {
      setNotice('Local preset storage is unavailable in this browser.')
      return
    }
    try {
      setPresets(deleteReviewFilterPreset(storage, selected.id))
      setSelectedId('')
      setName('')
      setNotice(`Deleted “${selected.name}” from this browser.`)
    } catch (error) {
      setNotice(errorText(error))
    }
  }

  return (
    <section
      aria-label="Saved review filter presets"
      className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-slate-700">Saved filter presets</h3>
        <span className="text-[11px] text-slate-500">This browser only</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <select
          aria-label="Saved review filter preset"
          className="min-w-0 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700"
          value={selectedId}
          onChange={(event) => {
            const id = event.target.value
            setSelectedId(id)
            const preset = presets.find((candidate) => candidate.id === id)
            if (preset) setName(preset.name)
            setNotice(null)
          }}
        >
          <option value="">Choose a preset…</option>
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!selected}
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 disabled:opacity-40"
          onClick={applySelected}
        >
          Apply
        </button>
        <button
          type="button"
          disabled={!selected}
          className="rounded-md px-2.5 py-1.5 text-xs text-red-600 disabled:opacity-40"
          onClick={deleteSelected}
        >
          Delete
        </button>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          saveCurrent()
        }}
      >
        <input
          aria-label="Review filter preset name"
          maxLength={64}
          className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs"
          value={name}
          placeholder="Name the current filters"
          onChange={(event) => {
            setName(event.target.value)
            setNotice(null)
          }}
        />
        <button type="submit" className="rounded-md bg-slate-800 px-2.5 py-1.5 text-xs text-white">
          Save current
        </button>
      </form>
      <p className="text-[11px] text-slate-500">
        Applying a local preset updates the shareable URL; the preset name itself is never sent to
        the server.
      </p>
      {notice ? (
        <p aria-live="polite" className="text-[11px] text-slate-600">
          {notice}
        </p>
      ) : null}
    </section>
  )
}
