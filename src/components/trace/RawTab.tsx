import { useVirtualizer } from '@tanstack/react-virtual'
import { useMemo, useRef } from 'react'
import { useTraceRaw } from '../../api/hooks'
import { EmptyState, ErrorState, LoadingState } from '../common/EmptyState'

/** Above this size, rendering one <pre> janks — switch to a virtualized line list. */
const PRE_LIMIT = 300_000
/** Render guard for pathological single lines inside the virtualized list. */
const MAX_LINE = 20_000

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

function guessExt(text: string): string {
  const head = text.trimStart()
  if (head.startsWith('{') || head.startsWith('[')) {
    const nl = text.indexOf('\n')
    if (nl > -1 && nl < text.length - 1) {
      try {
        JSON.parse(text.slice(0, nl))
        return '.jsonl'
      } catch {
        return '.json'
      }
    }
    return '.json'
  }
  return '.txt'
}

function LineList({ lines }: { lines: string[] }) {
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 18,
    overscan: 40,
  })
  return (
    <div ref={parentRef} className="min-h-0 flex-1 overflow-auto">
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const line = lines[item.index]
          return (
            <div
              key={item.index}
              className="absolute left-0 top-0 h-[18px] whitespace-pre px-4 font-mono text-xs leading-[18px] text-slate-700"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              {line.length > MAX_LINE
                ? `${line.slice(0, MAX_LINE)} … (+${(line.length - MAX_LINE).toLocaleString()} chars)`
                : line}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function RawTab({ traceId, active }: { traceId: string; active: boolean }) {
  const raw = useTraceRaw(traceId, active)
  const text = raw.data
  const byteSize = useMemo(
    () => (text !== undefined ? new TextEncoder().encode(text).length : 0),
    [text],
  )
  const lines = useMemo(
    () => (text !== undefined && text.length >= PRE_LIMIT ? text.split('\n') : []),
    [text],
  )

  if (raw.isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-4">
        <LoadingState label="Loading raw source…" />
      </div>
    )
  }
  if (raw.isError || text === undefined) {
    const message = raw.error instanceof Error ? raw.error.message : 'raw unavailable'
    return (
      <div className="mx-auto max-w-4xl px-4 py-4">
        {message.includes('404') ? (
          <EmptyState
            title="No raw source on disk"
            hint="This trace was not imported from a file, so there is no raw payload to show."
          />
        ) : (
          <ErrorState message={`Failed to load raw source: ${message}`} />
        )}
      </div>
    )
  }

  const download = () => {
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${traceId}${guessExt(text)}`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-2 text-xs text-slate-500">
        <span className="font-mono">{formatBytes(byteSize)}</span>
        <button
          type="button"
          onClick={download}
          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-600 hover:bg-slate-50"
        >
          Download
        </button>
        <a
          href={`/api/traces/${traceId}/raw`}
          target="_blank"
          rel="noreferrer"
          className="text-slate-500 underline hover:text-slate-800"
        >
          Open raw endpoint
        </a>
      </div>
      {text.length < PRE_LIMIT ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <pre className="whitespace-pre-wrap break-all px-4 py-3 font-mono text-xs text-slate-700">
            {text}
          </pre>
        </div>
      ) : (
        <LineList lines={lines} />
      )}
    </div>
  )
}
