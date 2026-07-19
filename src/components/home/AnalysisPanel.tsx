import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { useAnalysis } from '../../api/hooks'
import type { ListParamKey } from '../../state/filterParams'
import { MarkdownContent } from '../common/MarkdownContent'
import { CollapsibleSection } from './CollapsibleSection'

const EXAMPLE_QUERIES = [
  'find reward hacking patterns',
  'why do swe traces time out?',
  'are the math judge verdicts sound?',
]

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

function compactInput(input: unknown): string {
  try {
    const s = JSON.stringify(input)
    if (!s || s === '{}') return ''
    return s.length > 90 ? `${s.slice(0, 90)}…` : s
  } catch {
    return ''
  }
}

/**
 * Home-page AI analysis agent: free-form question → server-side tool-use loop
 * over the trace store → report with cited traces and a suggested filter.
 */
export function AnalysisPanel({
  setParam,
}: {
  setParam: (key: ListParamKey, value: string | undefined) => void
}) {
  const [query, setQuery] = useState('')
  const analysis = useAnalysis()
  const [, setSearchParams] = useSearchParams()

  const submit = () => {
    const q = query.trim()
    if (q === '' || analysis.isPending) return
    analysis.mutate(q)
  }

  const openTrace = (traceId: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('peek', traceId)
        return next
      },
      { replace: true },
    )
  }

  const errorMessage = analysis.isError
    ? analysis.error instanceof ApiError && analysis.error.status === 503
      ? 'AI analysis is unavailable: the server has no ANTHROPIC_API_KEY configured.'
      : `Analysis failed: ${analysis.error instanceof Error ? analysis.error.message : 'unknown error'}`
    : null

  const report = analysis.data?.report
  const steps = analysis.data?.steps ?? []

  return (
    <div data-testid="analysis-panel">
      <CollapsibleSection id="analysis" title="AI analysis" defaultOpen={false}>
        <div className="flex flex-col gap-3">
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            rows={2}
            placeholder='Ask about the loaded traces, e.g. "which components regressed at the last checkpoint?"'
            data-testid="analysis-query"
            className="w-full resize-y rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              data-testid="analysis-submit"
              onClick={submit}
              disabled={analysis.isPending || query.trim() === ''}
              className="inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
            >
              {analysis.isPending && <Spinner />}
              Analyze
            </button>
            {EXAMPLE_QUERIES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setQuery(example)}
                className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs text-slate-500 hover:border-slate-300 hover:text-slate-700"
              >
                {example}
              </button>
            ))}
          </div>

          {analysis.isPending && (
            <div
              className="flex items-center gap-2 text-xs text-slate-500"
              data-testid="analysis-pending"
            >
              <span className="inline-block h-2 w-2 animate-ping rounded-full bg-indigo-400" />
              <span className="animate-pulse">
                Agent is planning, querying the trace store, and writing a report… (up to ~90s)
              </span>
            </div>
          )}

          {errorMessage && (
            <p className="text-xs text-red-600" data-testid="analysis-error">
              {errorMessage}
            </p>
          )}

          {report && !analysis.isPending && (
            <div className="flex flex-col gap-3" data-testid="analysis-result">
              {steps.length > 0 && (
                <ol className="flex flex-col gap-0.5 rounded-md bg-slate-50 px-3 py-2">
                  {steps.map((step, i) => (
                    <li
                      key={`${step.tool}-${String(i)}`}
                      className="flex items-baseline gap-2 font-mono text-[11px] text-slate-500"
                    >
                      <span className="text-slate-400">{i + 1}.</span>
                      <span className="font-semibold text-slate-600">{step.tool}</span>
                      <span className="min-w-0 truncate">{compactInput(step.input)}</span>
                      <span className="ml-auto shrink-0 text-slate-400">{step.tookMs}ms</span>
                    </li>
                  ))}
                </ol>
              )}

              <MarkdownContent text={report.summary} />

              {report.findings.length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {report.findings.map((finding) => (
                    <li
                      key={`${finding.traceId}-${finding.note}`}
                      className="flex items-baseline gap-2 text-xs"
                    >
                      <button
                        type="button"
                        onClick={() => openTrace(finding.traceId)}
                        className="shrink-0 font-mono text-indigo-600 underline decoration-indigo-300 hover:text-indigo-800"
                      >
                        {finding.traceId}
                      </button>
                      <span className="text-slate-600">{finding.note}</span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {report.suggestedFilter && (
                  <>
                    <button
                      type="button"
                      data-testid="analysis-apply-filter"
                      onClick={() => setParam('filters', report.suggestedFilter)}
                      className="rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                    >
                      Apply suggested filter
                    </button>
                    <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
                      {report.suggestedFilter}
                    </code>
                  </>
                )}
                {report.confidence && (
                  <span className="ml-auto text-[11px] text-slate-400">
                    confidence: {report.confidence}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </CollapsibleSection>
    </div>
  )
}
