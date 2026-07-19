import { promises as fs } from 'node:fs'
import path from 'node:path'
import { setImmediate as yieldToEventLoop } from 'node:timers/promises'
import { watch as chokidarWatch, type FSWatcher } from 'chokidar'
import { connectors, parseAny } from '../../shared/connectors/registry'
import type { ParsedTrace } from '../../shared/connectors/types'
import type { TraceMeta, TraceStats } from '../../shared/schema/types'
import type { TraceStore } from './traceStore'

export const DEFAULT_ROOTS = ['data/runs', 'data/imported']

/** Basename of the per-run corpus root: the folder right after it names the run. */
const RUNS_ROOT_NAME = 'runs'
/** Fallback run for traces that carry none (only reached under non-runs roots). */
const IMPORTED_RUN = 'imported'

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

/** Files parsed per event-loop yield during a progressive scan. */
const SCAN_BATCH_SIZE = 50

export interface ScanProgress {
  scanning: boolean
  scannedFiles: number
  totalFiles: number
}

const progress: ScanProgress = { scanning: false, scannedFiles: 0, totalFiles: 0 }

/** Snapshot of the current (or last finished) scanAll run; surfaced via GET /api/meta. */
export function getScanProgress(): ScanProgress {
  return { ...progress }
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

/** True when `root` is the per-run corpus root (…/runs), where subfolders name runs. */
function isRunsRoot(root: string): boolean {
  return path.basename(path.normalize(root)) === RUNS_ROOT_NAME
}

/** The run a file carries in its own meta, if it is a non-empty string. */
function carriedRun(parsed: ParsedTrace): string | undefined {
  const run = parsed.meta.extra?.run
  return typeof run === 'string' && run.length > 0 ? run : undefined
}

/**
 * Resolves the run id for a trace given the root its file lives under.
 * - Under a runs root the folder right after runs/ IS the run and WINS over any
 *   run the trace carries (folder is the source of truth for the per-run layout).
 * - Otherwise (data/imported and any other root) the trace's own run wins,
 *   falling back to the string 'imported'.
 * Returns undefined only when a runs-root file sits directly in runs/ with no
 * run folder — then the caller leaves whatever the trace already carries.
 */
function resolveRun(root: string, filePath: string, parsed: ParsedTrace): string | undefined {
  if (isRunsRoot(root)) {
    const rel = path.relative(root, filePath)
    if (rel.startsWith('..') || path.isAbsolute(rel)) return carriedRun(parsed)
    const segments = rel.split(path.sep)
    // A run folder requires a path segment before the file (runs/<run>/…/file).
    return segments.length > 1 && segments[0] ? segments[0] : carriedRun(parsed)
  }
  return carriedRun(parsed) ?? IMPORTED_RUN
}

/** Stamps the derived run onto meta.extra.run (no-op when run is undefined). */
function stampRun(parsed: ParsedTrace, run: string | undefined): ParsedTrace {
  if (run === undefined) return parsed
  return { ...parsed, meta: { ...parsed.meta, extra: { ...parsed.meta.extra, run } } }
}

/** The root (from `roots`) that is an ancestor of `filePath`; the longest match wins. */
function rootFor(filePath: string, roots: readonly string[]): string | undefined {
  let best: string | undefined
  for (const root of roots) {
    const rel = path.relative(root, filePath)
    if (rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      if (best === undefined || root.length > best.length) best = root
    }
  }
  return best
}

/**
 * Parses one source file into the store. Never throws; corrupt input logs one warning line.
 * When `root` is given, every parsed trace has its run derived from the path (see
 * resolveRun) and stamped onto meta.extra.run before upsert.
 */
export async function scanFile(
  store: TraceStore,
  filePath: string,
  root?: string,
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
      // Sidecar first (its run counts as "carried"), then the folder-derived run
      // wins for runs-root files so the layout is the source of truth.
      const merged = sidecar ? applySidecar(parsed, sidecar) : parsed
      const stamped = root !== undefined ? stampRun(merged, resolveRun(root, filePath, merged)) : merged
      store.upsert(stamped, filePath)
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

/**
 * Progressive scan: enumerates sources up front (fast walk), then parses in batches of
 * SCAN_BATCH_SIZE, yielding to the event loop between batches so requests interleave.
 * Each upsert bumps store.dataVersion, so clients see the corpus stream in.
 */
export async function scanAll(
  store: TraceStore,
  roots: string[] = DEFAULT_ROOTS,
): Promise<ScanResult> {
  const startedAt = performance.now()
  // Track each source's root so scanFile can derive the run from the folder.
  const sources: Array<{ filePath: string; root: string }> = []
  for (const root of roots) {
    for (const filePath of await walk(root)) {
      if (isTraceSource(filePath)) sources.push({ filePath, root })
    }
  }
  progress.scanning = true
  progress.scannedFiles = 0
  progress.totalFiles = sources.length
  let traces = 0
  let warnings = 0
  try {
    for (let i = 0; i < sources.length; i += SCAN_BATCH_SIZE) {
      for (const { filePath, root } of sources.slice(i, i + SCAN_BATCH_SIZE)) {
        const r = await scanFile(store, filePath, root)
        traces += r.traces
        warnings += r.warnings
        progress.scannedFiles += 1
      }
      await yieldToEventLoop()
    }
  } finally {
    progress.scanning = false
  }
  return {
    files: sources.length,
    traces,
    warnings,
    ms: Math.round(performance.now() - startedAt),
  }
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
            void scanFile(store, sourcePath, rootFor(sourcePath, roots))
          },
          () => {},
        )
      }
      return
    }
    store.remove(filePath)
    void scanFile(store, filePath, rootFor(filePath, roots))
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
