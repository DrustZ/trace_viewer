import { useRef, useState } from 'react'
import { useImportTrace } from '../../../api/hooks'

interface FileResult {
  id: number
  name: string
  ok: boolean
  detail: string
}

let nextResultId = 0

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(new Error('could not read file'))
    reader.readAsText(file)
  })
}

/** Dashed drop zone that imports each dropped/chosen file as a text trace. */
export function ImportDropzone({ onOpenDialog }: { onOpenDialog: () => void }) {
  const importTrace = useImportTrace()
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<FileResult[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const importFiles = async (files: File[]) => {
    if (files.length === 0 || busy) return
    setBusy(true)
    setResults([])
    for (const file of files) {
      try {
        const content = await readText(file)
        const res = await importTrace.mutateAsync({ type: 'text', content })
        setResults((prev) => [
          ...prev,
          {
            id: nextResultId++,
            name: file.name,
            ok: true,
            detail: `${res.traceIds.length} trace${res.traceIds.length === 1 ? '' : 's'} (${res.format})`,
          },
        ])
      } catch (err) {
        setResults((prev) => [
          ...prev,
          {
            id: nextResultId++,
            name: file.name,
            ok: false,
            detail: err instanceof Error ? err.message : 'failed',
          },
        ])
      }
    }
    setBusy(false)
  }

  return (
    <section data-testid="import-dropzone">
      <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Import
      </h2>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drag-drop target; the 'Choose files' button is the accessible path */}
      <div
        data-testid="import-dropzone-area"
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          void importFiles(Array.from(e.dataTransfer.files))
        }}
        className={`flex flex-col items-center gap-1 rounded-lg border border-dashed px-3 py-4 text-center ${
          dragging ? 'border-blue-400 bg-blue-50' : 'border-slate-300 bg-white'
        }`}
      >
        <p className="text-xs text-slate-500">{busy ? 'Importing…' : 'Drop trace files here'}</p>
        <button
          type="button"
          data-testid="import-choose-files"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Choose files
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".json,.jsonl,.txt"
          className="hidden"
          onChange={(e) => {
            void importFiles(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
        <button
          type="button"
          data-testid="import-open-dialog"
          onClick={onOpenDialog}
          className="text-[11px] text-blue-600 hover:underline"
        >
          paste / URL…
        </button>
      </div>
      {results.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-0.5">
          {results.map((r) => (
            <li
              key={r.id}
              className={`truncate text-[11px] ${r.ok ? 'text-emerald-700' : 'text-red-600'}`}
              title={`${r.name}: ${r.detail}`}
            >
              {r.ok ? '✓' : '✕'} {r.name} — {r.detail}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
