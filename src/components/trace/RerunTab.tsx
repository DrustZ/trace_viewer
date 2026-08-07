import type { Trace } from '@shared/schema/types'
import { useState } from 'react'
import { PlaygroundTab } from './PlaygroundTab'
import { ReplayTab } from './ReplayTab'

type RerunMode = 'fork' | 'llm-only'

/**
 * Single rerun surface: real replay/fork against the recorded ACE world is the
 * primary mode; the stand-in LLM-only continuation (formerly the misleading
 * "playground" tab) is a clearly-labeled secondary mode. `?tab=replay` and
 * `?tab=playground` deep links both land here.
 */
export function RerunTab({ trace }: { trace: Trace }) {
  const [mode, setMode] = useState<RerunMode>('fork')
  return (
    <div>
      <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 pt-4">
        <button
          type="button"
          data-testid="rerun-mode-fork"
          aria-pressed={mode === 'fork'}
          onClick={() => setMode('fork')}
          className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
            mode === 'fork'
              ? 'border-slate-700 bg-slate-800 text-white'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          Replay &amp; fork · real execution
        </button>
        <button
          type="button"
          data-testid="rerun-mode-llm-only"
          aria-pressed={mode === 'llm-only'}
          onClick={() => setMode('llm-only')}
          title="Sends a transcript prefix to a stand-in model. No tools, world state, or grading."
          className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
            mode === 'llm-only'
              ? 'border-amber-400 bg-amber-100 text-amber-900'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          LLM-only continuation · no tool execution
        </button>
      </div>
      {mode === 'fork' ? (
        <ReplayTab key={trace.meta.traceUid ?? trace.meta.traceId} trace={trace} />
      ) : (
        <PlaygroundTab key={trace.meta.traceUid ?? trace.meta.traceId} trace={trace} />
      )}
    </div>
  )
}
