import { promises as fs } from 'node:fs'
import path from 'node:path'
import { watch as chokidarWatch, type FSWatcher } from 'chokidar'
import { connectors, parseAny } from '../../shared/connectors/registry'
import type { ParsedTrace } from '../../shared/connectors/types'
import type { TraceMeta, TraceStats } from '../../shared/schema/types'
import type { TraceStore } from './traceStore'

export const DEFAULT_ROOTS = ['data/traces', 'data/imported']

const TRACE_EXTENSIONS: ReadonlySet<string> = new Set(connectors.flatMap((c) => c.extensions))

const META_SUFFIX = '.meta.json'

const DEBOUNCE_MS = 300

/** Sidecar shape: `foo.meta.json` next to `foo.<ext>` enriches every trace parsed from it. */
interface Sidecar {
  meta?: Partial<TraceMeta>
  statsOverrides?: Partial<TraceStats>
}

export interface ScanResult {
  files: number
  traces: number
  warnings: number
  ms: number
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** A file scans as a trace source when a connector claims its extension and it is not a sidecar. */
function isTraceSource(filePath: string): boolean {
  return (
    !filePath.endsWith(META_SUFFIX) && TRACE_EXTENSIONS.has(path.extname(filePath).toLowerCase())
  )
}

function sidecarPath(filePath: string): string {
  return filePath.replace(/\.[^.]+$/, '') + META_SUFFIX
}

async function readSidecar(
  filePath: string,
): Promise<{ sidecar: Sidecar | null; warning?: string }> {
  const scPath = sidecarPath(filePath)
  let text: string
  try {
    text = await fs.readFile(scPath, 'utf8')
  } catch {
    return { sidecar: null } // no sidecar — the common case
  }
  try {
    return { sidecar: JSON.parse(text) as Sidecar }
  } catch (e) {
    return { sidecar: null, warning: `${scPath}: invalid sidecar JSON (${errorMessage(e)})` }
  }
}

function applySidecar(parsed: ParsedTrace, sidecar: Sidecar): ParsedTrace {
  return {
    ...parsed,
    // Sidecar meta fields win over connector-derived ones.
    meta: { ...parsed.meta, ...sidecar.meta },
    ...(sidecar.statsOverrides || parsed.statsOverrides
      ? { statsOverrides: { ...parsed.statsOverrides, ...sidecar.statsOverrides } }
      : {}),
  }
}

/** Parses one source file into the store. Never throws; corrupt input logs one warning line. */
export async function scanFile(
  store: TraceStore,
  filePath: string,
): Promise<{ traces: number; warnings: number }> {
  let warnings = 0
  const warn = (message: string): void => {
    warnings += 1
    console.warn(`[scan] ${message}`)
  }
  try {
    const [text, stat] = await Promise.all([fs.readFile(filePath, 'utf8'), fs.stat(filePath)])
    const result = parseAny(text, {
      sourcePath: filePath,
      fallbackTimestamp: stat.mtime.toISOString(),
    })
    if (result.traces.length === 0) {
      warn(`${filePath}: ${result.warnings[0] ?? 'no traces parsed'}`)
      return { traces: 0, warnings }
    }
    if (result.warnings.length > 0) warn(`${filePath}: ${result.warnings.join('; ')}`)
    const { sidecar, warning } = await readSidecar(filePath)
    if (warning) warn(warning)
    for (const parsed of result.traces) {
      store.upsert(sidecar ? applySidecar(parsed, sidecar) : parsed, filePath)
    }
    return { traces: result.traces.length, warnings }
  } catch (e) {
    warn(`${filePath}: ${errorMessage(e)}`)
    return { traces: 0, warnings }
  }
}

async function walk(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true, recursive: true })
    return entries
      .filter((e) => e.isFile())
      .map((e) => path.join(e.parentPath, e.name))
      .sort()
  } catch {
    return [] // missing root (e.g. data/imported before the first import) is fine
  }
}

export async function scanAll(
  store: TraceStore,
  roots: string[] = DEFAULT_ROOTS,
): Promise<ScanResult> {
  const startedAt = performance.now()
  let files = 0
  let traces = 0
  let warnings = 0
  for (const root of roots) {
    for (const filePath of await walk(root)) {
      if (!isTraceSource(filePath)) continue
      files += 1
      const r = await scanFile(store, filePath)
      traces += r.traces
      warnings += r.warnings
    }
  }
  return { files, traces, warnings, ms: Math.round(performance.now() - startedAt) }
}

/** Watches the roots and keeps the store in sync (300ms debounce per path). */
export function watch(store: TraceStore, roots: string[] = DEFAULT_ROOTS): FSWatcher {
  const timers = new Map<string, NodeJS.Timeout>()
  const schedule = (filePath: string, run: () => void): void => {
    const pending = timers.get(filePath)
    if (pending) clearTimeout(pending)
    timers.set(
      filePath,
      setTimeout(() => {
        timers.delete(filePath)
        run()
      }, DEBOUNCE_MS),
    )
  }

  const rescan = (filePath: string): void => {
    if (filePath.endsWith(META_SUFFIX)) {
      // A sidecar edit re-parses its trace source so merged meta stays live.
      const base = filePath.slice(0, -META_SUFFIX.length)
      for (const ext of TRACE_EXTENSIONS) {
        const sourcePath = base + ext
        fs.access(sourcePath).then(
          () => {
            store.remove(sourcePath)
            void scanFile(store, sourcePath)
          },
          () => {},
        )
      }
      return
    }
    store.remove(filePath)
    void scanFile(store, filePath)
  }

  const watcher = chokidarWatch(roots, {
    ignoreInitial: true,
    // Only connector extensions are interesting; everything else (*.png, *.pid, ...) is noise.
    ignored: (p, stats) =>
      (stats?.isFile() ?? false) && !TRACE_EXTENSIONS.has(path.extname(p).toLowerCase()),
  })
  watcher.on('add', (p) => schedule(p, () => rescan(p)))
  watcher.on('change', (p) => schedule(p, () => rescan(p)))
  watcher.on('unlink', (p) => {
    if (!isTraceSource(p)) return
    schedule(p, () => {
      store.remove(p)
    })
  })
  watcher.on('error', (e) => console.warn(`[watch] ${errorMessage(e)}`))
  return watcher
}
