import { type FormEvent, useState } from 'react'
import { useAddDataRoot, useDataRoots } from '../../api/dataRoots'

const INPUT_CLASS =
  'rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-400'

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'Could not add folder.'
  try {
    const body: unknown = JSON.parse(error.message)
    if (typeof body === 'object' && body !== null && 'error' in body) {
      const message = (body as { error?: unknown }).error
      if (typeof message === 'string') return message
    }
  } catch {
    // API returned plain text; use it below.
  }
  return error.message
}

export function LocalFolderForm() {
  const [folderPath, setFolderPath] = useState('')
  const [label, setLabel] = useState('')
  const roots = useDataRoots()
  const addRoot = useAddDataRoot()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (folderPath.trim() === '' || addRoot.isPending) return
    addRoot.mutate({
      path: folderPath.trim(),
      ...(label.trim() === '' ? {} : { label: label.trim() }),
    })
  }

  return (
    <div className="flex flex-col gap-3" data-testid="local-folder-form">
      <p className="text-xs leading-5 text-slate-600">
        Enter an absolute folder on this computer. Existing traces are indexed immediately, and new
        or changed trace files appear automatically. The server never returns the absolute path in
        list responses.
      </p>

      <form className="flex flex-col gap-2" onSubmit={submit}>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
          Folder path
          <input
            data-testid="data-root-path"
            type="text"
            value={folderPath}
            onChange={(event) => setFolderPath(event.target.value)}
            placeholder="/Users/you/project/data"
            autoComplete="off"
            className={`${INPUT_CLASS} font-mono text-xs`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
          Run label <span className="font-normal text-slate-400">optional</span>
          <input
            data-testid="data-root-label"
            type="text"
            value={label}
            maxLength={64}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="my-eval-run"
            autoComplete="off"
            className={INPUT_CLASS}
          />
        </label>
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-slate-400">
            {roots.data?.persistenceAvailable
              ? 'Saved privately on this machine and restored after restart.'
              : 'Runtime-only; use TRACE_DATA_ROOTS to restore this folder after restart.'}
          </p>
          <button
            type="submit"
            data-testid="add-data-root"
            disabled={folderPath.trim() === '' || addRoot.isPending}
            className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {addRoot.isPending ? 'Adding…' : 'Add & watch'}
          </button>
        </div>
      </form>

      {addRoot.isSuccess && (
        <p className="text-xs text-emerald-700" data-testid="data-root-success">
          Watching {addRoot.data.root.label}: {addRoot.data.indexedTraces} trace
          {addRoot.data.indexedTraces === 1 ? '' : 's'} indexed
          {addRoot.data.warnings > 0 ? ` (${addRoot.data.warnings} warnings)` : ''}.
        </p>
      )}
      {addRoot.isError && (
        <p className="text-xs text-red-600" role="alert">
          {errorMessage(addRoot.error)}
        </p>
      )}

      {roots.data && roots.data.roots.length > 0 && (
        <div className="border-t border-slate-100 pt-2">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Watched now
          </p>
          <ul className="max-h-24 space-y-0.5 overflow-y-auto text-xs text-slate-600">
            {roots.data.roots.map((root) => (
              <li key={root.id} className="flex items-center justify-between gap-2">
                <span className="truncate">{root.label}</span>
                {root.dynamic && (
                  <span className="shrink-0 text-slate-400">
                    {root.persistent ? 'saved locally' : 'this session'}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
