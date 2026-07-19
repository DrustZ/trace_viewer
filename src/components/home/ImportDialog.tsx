import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { useImportTrace } from '../../api/hooks'

type Tab = 'paste' | 'file' | 'url'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'paste', label: 'Paste' },
  { id: 'file', label: 'File' },
  { id: 'url', label: 'URL' },
]

const FORMATS = ['auto', 'native', 'harmony', 'openai-chat'] as const

const INPUT_CLASS =
  'rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-400'

/** 4xx bodies are JSON like {"error": "...", "warnings": [...]}; fall back to the raw text. */
function parseApiError(err: unknown): { message: string; warnings: string[] } {
  if (!(err instanceof Error)) return { message: 'import failed', warnings: [] }
  if (err instanceof ApiError) {
    try {
      const body: unknown = JSON.parse(err.message)
      if (typeof body === 'object' && body !== null) {
        const rec = body as Record<string, unknown>
        return {
          message: typeof rec.error === 'string' ? rec.error : err.message,
          warnings: Array.isArray(rec.warnings) ? rec.warnings.map(String) : [],
        }
      }
    } catch {
      // not JSON — use raw message
    }
  }
  return { message: err.message, warnings: [] }
}

function WarningList({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null
  return (
    <ul className="max-h-32 list-inside list-disc overflow-y-auto text-xs text-amber-700">
      {warnings.map((w) => (
        <li key={w}>{w}</li>
      ))}
    </ul>
  )
}

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('paste')
  const [content, setContent] = useState('')
  const [format, setFormat] = useState<(typeof FORMATS)[number]>('auto')
  const [fileName, setFileName] = useState('')
  const [fileText, setFileText] = useState('')
  const [url, setUrl] = useState('')
  const importTrace = useImportTrace()
  const [, setSearchParams] = useSearchParams()
  // Guards the auto-open effect so it fires once per successful import.
  const openedRef = useRef(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // On success, open the imported trace in the right-hand drawer and close the
  // dialog — the home view stays on the left so you can keep importing / loading
  // runs. (The drawer's Expand button goes to the full trace page.)
  useEffect(() => {
    if (!importTrace.isSuccess || openedRef.current) return
    const first = importTrace.data.traceIds[0]
    if (!first) return
    openedRef.current = true
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('peek', first)
        return next
      },
      { replace: true },
    )
    onClose()
  }, [importTrace.isSuccess, importTrace.data, onClose, setSearchParams])

  const submit = () => {
    if (importTrace.isPending) return
    const fmt = format === 'auto' ? undefined : format
    if (tab === 'paste' && content.trim() !== '') {
      importTrace.mutate({ type: 'text', content, format: fmt })
    } else if (tab === 'file' && fileText !== '') {
      importTrace.mutate({ type: 'text', content: fileText, format: fmt })
    } else if (tab === 'url' && url.trim() !== '') {
      importTrace.mutate({ type: 'url', url: url.trim() })
    }
  }

  const onFileChange = (file: File | undefined) => {
    if (!file) return
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = () => setFileText(typeof reader.result === 'string' ? reader.result : '')
    reader.readAsText(file)
  }

  const reset = () => {
    openedRef.current = false
    importTrace.reset()
    setContent('')
    setFileName('')
    setFileText('')
    setUrl('')
  }

  const error = importTrace.isError ? parseApiError(importTrace.error) : null
  const canSubmit =
    tab === 'paste' ? content.trim() !== '' : tab === 'file' ? fileText !== '' : url.trim() !== ''

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click-to-close, Esc handled globally
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc handled by the window listener
    <div
      data-testid="import-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: click handler only stops backdrop close */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Import a trace"
        className="flex w-full max-w-xl flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Import a trace</h2>
          <button
            type="button"
            aria-label="Close import dialog"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700"
          >
            ×
          </button>
        </div>

        {importTrace.isSuccess ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-emerald-700">
              Imported {importTrace.data.traceIds.length} trace
              {importTrace.data.traceIds.length === 1 ? '' : 's'} ({importTrace.data.format}).
            </p>
            <WarningList warnings={importTrace.data.warnings} />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                View trace
              </button>
              <button
                type="button"
                onClick={reset}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                Import another
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex gap-1 rounded-md bg-slate-100 p-0.5">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`flex-1 rounded px-2 py-1 text-xs font-medium ${
                    tab === t.id
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === 'paste' && (
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={8}
                placeholder="Paste a trace: native JSON, harmony text, or an OpenAI chat payload"
                className={`${INPUT_CLASS} resize-y font-mono text-xs`}
              />
            )}
            {tab === 'file' && (
              <div className="flex flex-col gap-1.5">
                <input
                  type="file"
                  accept=".json,.jsonl,.txt"
                  onChange={(e) => onFileChange(e.target.files?.[0])}
                  className="text-xs text-slate-600 file:mr-2 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-2 file:py-1 file:text-xs file:text-slate-700"
                />
                {fileName !== '' && <p className="text-xs text-slate-500">Selected: {fileName}</p>}
              </div>
            )}
            {tab === 'url' && (
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit()
                }}
                placeholder="https://example.com/trace.json"
                className={INPUT_CLASS}
              />
            )}

            <div className="flex items-center justify-between gap-2">
              {tab !== 'url' ? (
                <label className="flex items-center gap-1.5 text-xs text-slate-500">
                  Format
                  <select
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                    value={format}
                    onChange={(e) => setFormat(e.target.value as (typeof FORMATS)[number])}
                  >
                    {FORMATS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <span />
              )}
              <button
                type="button"
                data-testid="import-submit"
                onClick={submit}
                disabled={!canSubmit || importTrace.isPending}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {importTrace.isPending ? 'Importing…' : 'Import'}
              </button>
            </div>

            {error && (
              <div className="flex flex-col gap-1">
                <p className="text-xs text-red-600">{error.message}</p>
                <WarningList warnings={error.warnings} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
