import { encodeFilterSet } from '@shared/filter/parse'
import type { AiFilterResponse } from '@shared/schema/api'
import { useState } from 'react'
import { useAiFilter } from '../../api/hooks'
import { type ListParamPatch, useListParams } from '../../state/filterParams'

/**
 * The server passes groupByInstance as an additive field on the ai-filter
 * response (group-average requests are inexpressible in the per-trace DSL and
 * surface as instance grouping instead). Typed locally to keep the shared
 * contract untouched.
 */
type AiFilterResult = AiFilterResponse & { groupByInstance?: boolean }

function Spinner() {
  return (
    <svg
      className="h-3.5 w-3.5 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" className="opacity-25" />
      <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round" />
    </svg>
  )
}

export function AiFilterInput() {
  const [query, setQuery] = useState('')
  const ai = useAiFilter()
  // Batch setter: filters + group must land in one URL update (sequential
  // setParam calls in the same tick see stale search params).
  const { setParams } = useListParams()

  const submit = () => {
    const q = query.trim()
    if (q === '' || ai.isPending) return
    ai.mutate(q, {
      // Replace (not merge) the filters param: predictable, matches the explanation shown.
      onSuccess: (result) => {
        const patch: ListParamPatch = { filters: encodeFilterSet(result.filter) || undefined }
        // Group-average requests are per-trace-inexpressible; the server asks
        // us to group by instance so avg scores appear on the group rows.
        if ((result as AiFilterResult).groupByInstance) patch.group = 'instance'
        setParams(patch)
      },
    })
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          placeholder='Describe a filter, e.g. "failed swebench runs over 20 turns"'
          data-testid="ai-filter"
          className="w-72 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        />
        <button
          type="button"
          data-testid="ai-filter-submit"
          onClick={submit}
          disabled={ai.isPending || query.trim() === ''}
          className="inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
        >
          {ai.isPending && <Spinner />}
          AI Filter
        </button>
      </div>
      {ai.isError && (
        <p className="text-xs text-red-600">
          AI filter failed: {ai.error instanceof Error ? ai.error.message : 'unknown error'}
        </p>
      )}
      {ai.data && !ai.isPending && (
        <p className="flex items-center gap-1.5 text-xs text-slate-500">
          <span
            data-testid="ai-filter-source"
            className={`inline-block rounded px-1.5 py-0.5 font-medium ${
              ai.data.source === 'llm'
                ? 'bg-indigo-50 text-indigo-700'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            {ai.data.source === 'llm' ? 'AI' : 'rules'}
          </span>
          <span className="truncate">{ai.data.explanation}</span>
        </p>
      )}
    </div>
  )
}
