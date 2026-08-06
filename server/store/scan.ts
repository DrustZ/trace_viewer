import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { setTimeout as delay, setImmediate as yieldToEventLoop } from 'node:timers/promises'
import { watch as chokidarWatch, type FSWatcher } from 'chokidar'
import { connectors, parseAny } from '../../shared/connectors/registry'
import type { ParsedTrace } from '../../shared/connectors/types'
import type { ScanRootMode, ScanRootState, ScanRootStatus } from '../../shared/schema/api'
import type { TraceMeta, TraceStats } from '../../shared/schema/types'
import {
  type DataRoot,
  DEFAULT_DATA_ROOTS,
  displayDataRootPath,
  parseDataRootSpec,
} from '../config/dataRoots'
import type { TraceStore } from './traceStore'

export const DEFAULT_ROOTS = [...DEFAULT_DATA_ROOTS]

/** Basename of the per-run corpus root: the folder right after it names the run. */
const RUNS_ROOT_NAME = 'runs'
/** Fallback run for traces that carry none (only reached under non-runs roots). */
const IMPORTED_RUN = 'imported'

const TRACE_EXTENSIONS: ReadonlySet<string> = new Set(connectors.flatMap((c) => c.extensions))

const META_SUFFIX = '.meta.json'

const DEBOUNCE_MS = 300

interface ResolvedRoot extends DataRoot {
  mode: ScanRootMode
}

function resolveRoot(spec: string): ResolvedRoot {
  const parsed = parseDataRootSpec(spec)
  if (parsed.run) return { ...parsed, mode: 'fixed' }
  if (path.basename(parsed.path) === RUNS_ROOT_NAME) return { ...parsed, mode: 'runs' }
  if (path.basename(parsed.path) === IMPORTED_RUN) return { ...parsed, mode: 'metadata' }
  // A direct external corpus gets its own predictable run instead of silently
  // falling into "imported". Label generic folders explicitly (for example,
  // work-trial=/Users/me/Downloads/data) to give them a more useful name.
  return { ...parsed, run: path.basename(parsed.path) || 'external', mode: 'fixed' }
}

function resolveRoots(specs: readonly string[]): ResolvedRoot[] {
  const roots = new Map<string, ResolvedRoot>()
  for (const spec of specs) {
    const root = resolveRoot(spec)
    roots.set(root.path, root)
  }
  return [...roots.values()]
}

function statusForRoot(root: ResolvedRoot): ScanRootStatus {
  return {
    id: rootId(root),
    label: displayDataRootPath(root.path),
    run: root.run ?? null,
    mode: root.mode,
    state: 'pending',
    files: 0,
    scannedFiles: 0,
    traces: 0,
    warnings: 0,
  }
}

function rootId(root: ResolvedRoot): string {
  return createHash('sha256').update(root.path).digest('hex').slice(0, 12)
}

function progressStatusFor(root: ResolvedRoot | undefined): ScanRootStatus | undefined {
  if (!root) return undefined
  return progress.scanRoots.find((status) => status.id === rootId(root))
}

/** Sidecar shape: `foo.meta.json` next to `foo.<ext>` enriches every trace parsed from it. */
interface Sidecar {
  meta?: Partial<TraceMeta>
  statsOverrides?: Partial<TraceStats>
}

export interface ScanFileResult {
  traces: number
  warnings: number
  traceIds: string[]
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
  scanRoots: ScanRootStatus[]
}

let progress: ScanProgress = {
  scanning: false,
  scannedFiles: 0,
  totalFiles: 0,
  scanRoots: DEFAULT_ROOTS.map((spec) => statusForRoot(resolveRoot(spec))),
}

interface SourceObservation {
  rootId: string
  scanned: boolean
  traces: number
  traceIds: string[]
}

/** Per-file facts behind the currently published progress snapshot. */
let sourceObservations = new Map<string, SourceObservation>()

/** Snapshot of the current (or last finished) scanAll run; surfaced via GET /api/meta. */
export function getScanProgress(): ScanProgress {
  return { ...progress, scanRoots: progress.scanRoots.map((root) => ({ ...root })) }
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
function resolveRun(root: ResolvedRoot, filePath: string, parsed: ParsedTrace): string | undefined {
  if (root.mode === 'fixed') return root.run
  if (root.mode === 'runs') {
    const rel = path.relative(root.path, filePath)
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
function rootFor(filePath: string, roots: readonly ResolvedRoot[]): ResolvedRoot | undefined {
  let best: ResolvedRoot | undefined
  for (const root of roots) {
    const rel = path.relative(root.path, filePath)
    if (rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      // The deepest configured ancestor owns the file. This keeps a broad external
      // root from silently overriding a more-specific data/runs corpus root.
      if (best === undefined || root.path.length > best.path.length) best = root
    }
  }
  return best
}

/**
 * Parses one source file into the store. Never throws; corrupt input logs one warning line.
 * When `root` is given, every parsed trace has its run derived from the path (see
 * resolveRun) and stamped onto meta.extra.run before upsert.
 */
async function scanSource(
  store: TraceStore,
  filePath: string,
  root?: ResolvedRoot,
  shouldCommit: () => boolean = () => true,
): Promise<ScanFileResult> {
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
      return { traces: 0, warnings, traceIds: [] }
    }
    if (result.warnings.length > 0) warn(`${filePath}: ${result.warnings.join('; ')}`)
    const { sidecar, warning } = await readSidecar(filePath)
    if (warning) warn(warning)
    for (const parsed of result.traces) {
      // Sidecar first (its run counts as "carried"), then the folder-derived run
      // wins for runs-root files so the layout is the source of truth.
      const merged = sidecar ? applySidecar(parsed, sidecar) : parsed
      const stamped =
        root !== undefined ? stampRun(merged, resolveRun(root, filePath, merged)) : merged
      // A full refresh can supersede an in-flight watcher read. Do not let that stale
      // snapshot overwrite the newer full-scan result after its async file read completes.
      if (!shouldCommit()) continue
      store.upsert(stamped, filePath)
    }
    return {
      traces: result.traces.length,
      warnings,
      traceIds: result.traces.map((trace) => trace.meta.traceId),
    }
  } catch (e) {
    warn(`${filePath}: ${errorMessage(e)}`)
    return { traces: 0, warnings, traceIds: [] }
  }
}

/** Public one-file scan; a root spec may include an explicit `run-name=` prefix. */
export async function scanFile(
  store: TraceStore,
  filePath: string,
  root?: string,
): Promise<ScanFileResult> {
  return scanSource(store, filePath, root === undefined ? undefined : resolveRoot(root))
}

async function walk(
  root: string,
): Promise<{ files: string[]; state: Extract<ScanRootState, 'ready' | 'missing' | 'error'> }> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true, recursive: true })
    return {
      files: entries
        .filter((e) => e.isFile())
        .map((e) => path.join(e.parentPath, e.name))
        .sort(),
      state: 'ready',
    }
  } catch (e) {
    const state =
      typeof e === 'object' && e !== null && 'code' in e && e.code === 'ENOENT'
        ? 'missing'
        : 'error'
    if (state === 'error') console.warn(`[scan] cannot read root ${root}: ${errorMessage(e)}`)
    return { files: [], state }
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
  const resolvedRoots = resolveRoots(roots)
  const scanRoots = resolvedRoots.map(statusForRoot)
  const current: ScanProgress = {
    scanning: true,
    scannedFiles: 0,
    totalFiles: 0,
    scanRoots,
  }
  progress = current

  // A source may sit under overlapping roots. Keep one deterministic, most-specific
  // owner so it is not parsed twice or stamped with two different run names.
  const sourceMap = new Map<string, ResolvedRoot>()
  for (const [index, root] of resolvedRoots.entries()) {
    const walked = await walk(root.path)
    scanRoots[index].state = walked.state
    if (walked.state === 'error') scanRoots[index].warnings += 1
    for (const filePath of walked.files) {
      if (!isTraceSource(filePath)) continue
      const owner = rootFor(filePath, resolvedRoots) ?? root
      if (owner.path === root.path) sourceMap.set(filePath, owner)
    }
  }
  const sources = [...sourceMap.entries()]
    .map(([filePath, root]) => ({ filePath, root }))
    .sort((a, b) => a.filePath.localeCompare(b.filePath))
  const statusByPath = new Map<string, ScanRootStatus>()
  for (const [index, root] of resolvedRoots.entries()) {
    const status = scanRoots[index]
    if (status) statusByPath.set(root.path, status)
  }
  for (const { root } of sources) {
    const status = statusByPath.get(root.path)
    if (status) status.files += 1
  }
  current.totalFiles = sources.length
  const observations = new Map<string, SourceObservation>()
  for (const { filePath, root } of sources) {
    observations.set(filePath, {
      rootId: rootId(root),
      scanned: false,
      traces: 0,
      traceIds: [],
    })
  }
  sourceObservations = observations

  let traces = 0
  let warnings = scanRoots.reduce((sum, root) => sum + root.warnings, 0)
  try {
    for (let i = 0; i < sources.length; i += SCAN_BATCH_SIZE) {
      for (const { filePath, root } of sources.slice(i, i + SCAN_BATCH_SIZE)) {
        const rootStatus = statusByPath.get(root.path)
        if (rootStatus) rootStatus.state = 'scanning'
        const r = await scanSource(store, filePath, root)
        traces += r.traces
        warnings += r.warnings
        current.scannedFiles += 1
        if (rootStatus) {
          rootStatus.scannedFiles += 1
          rootStatus.traces += r.traces
          rootStatus.warnings += r.warnings
        }
        observations.set(filePath, {
          rootId: rootId(root),
          scanned: true,
          traces: r.traces,
          traceIds: r.traceIds,
        })
      }
      await yieldToEventLoop()
    }
  } finally {
    current.scanning = false
    for (const root of scanRoots) {
      if (root.state === 'pending' || root.state === 'scanning') root.state = 'ready'
    }
  }
  return {
    files: sources.length,
    traces,
    warnings,
    ms: Math.round(performance.now() - startedAt),
  }
}

async function waitForFullScan(): Promise<void> {
  while (progress.scanning) await delay(25)
}

/** Watches the roots and keeps the store in sync (300ms debounce per path). */
export function watch(store: TraceStore, roots: string[] = DEFAULT_ROOTS): FSWatcher {
  const resolvedRoots = resolveRoots(roots)
  for (const root of resolvedRoots) {
    if (!progressStatusFor(root)) {
      progress.scanRoots.push({ ...statusForRoot(root), state: 'ready' })
    }
  }
  const timers = new Map<string, NodeJS.Timeout>()
  const queues = new Map<string, Promise<void>>()

  // Debouncing coalesces bursts before work starts; this queue also serializes a later event
  // that arrives while a large file is still parsing, so the newest event always wins.
  const enqueue = (filePath: string, run: () => Promise<void> | void): Promise<void> => {
    const previous = queues.get(filePath) ?? Promise.resolve()
    const next = previous
      .then(async () => {
        await run()
      })
      .catch((e: unknown) => console.warn(`[watch] ${filePath}: ${errorMessage(e)}`))
    queues.set(filePath, next)
    void next.then(() => {
      if (queues.get(filePath) === next) queues.delete(filePath)
    })
    return next
  }

  const schedule = (filePath: string, run: () => Promise<void> | void): void => {
    const pending = timers.get(filePath)
    if (pending) clearTimeout(pending)
    timers.set(
      filePath,
      setTimeout(() => {
        timers.delete(filePath)
        void enqueue(filePath, run)
      }, DEBOUNCE_MS),
    )
  }

  async function restoreShadowedSources(
    traceIds: readonly string[],
    excludedPath: string,
    observations: Map<string, SourceObservation>,
  ): Promise<void> {
    if (traceIds.length === 0) return
    const missingIds = new Set(traceIds)
    const fallbacks = [...observations.entries()]
      .filter(
        ([sourcePath, observation]) =>
          sourcePath !== excludedPath &&
          observation.traceIds.some((traceId) => missingIds.has(traceId)),
      )
      .map(([sourcePath]) => sourcePath)
    for (const sourcePath of fallbacks) {
      await enqueue(sourcePath, () => scanWatchedSource(sourcePath))
    }
  }

  const scanWatchedSource = async (sourcePath: string): Promise<void> => {
    // Boot/refresh scans own the progress ledger while active. Replay the event against their
    // completed snapshot instead of double-counting a file enumerated by both scan and watcher.
    await waitForFullScan()
    const activeProgress = progress
    const observations = sourceObservations
    const root = rootFor(sourcePath, resolvedRoots)
    const status = progressStatusFor(root)
    const previous = observations.get(sourcePath)
    if (status) status.state = 'scanning'
    store.remove(sourcePath)
    const result = await scanSource(
      store,
      sourcePath,
      root,
      () => progress === activeProgress && sourceObservations === observations,
    )
    // A refresh may have replaced the entire ledger while this file was parsing.
    if (progress !== activeProgress || sourceObservations !== observations) return
    if (!status || !root) return
    if (!previous) {
      status.files += 1
      progress.totalFiles += 1
    }
    if (!previous?.scanned) {
      status.scannedFiles += 1
      progress.scannedFiles += 1
    }
    status.state = 'ready'
    status.traces = Math.max(0, status.traces - (previous?.traces ?? 0) + result.traces)
    // Watch warnings are cumulative diagnostics: a later successful rewrite
    // cannot prove an earlier warning was irrelevant to an engineer.
    status.warnings += result.warnings
    observations.set(sourcePath, {
      rootId: rootId(root),
      scanned: true,
      traces: result.traces,
      traceIds: result.traceIds,
    })
    const currentIds = new Set(result.traceIds)
    await restoreShadowedSources(
      previous?.traceIds.filter((traceId) => !currentIds.has(traceId)) ?? [],
      sourcePath,
      observations,
    )
  }

  const rescan = async (filePath: string): Promise<void> => {
    if (filePath.endsWith(META_SUFFIX)) {
      // A sidecar edit re-parses its trace source so merged meta stays live.
      const base = filePath.slice(0, -META_SUFFIX.length)
      for (const ext of TRACE_EXTENSIONS) {
        const sourcePath = base + ext
        try {
          await fs.access(sourcePath)
          await enqueue(sourcePath, () => scanWatchedSource(sourcePath))
        } catch {
          // The source for this possible extension does not exist.
        }
      }
      return
    }
    if (isTraceSource(filePath)) await scanWatchedSource(filePath)
  }

  const watcher = chokidarWatch(
    resolvedRoots.map((root) => root.path),
    {
      ignoreInitial: true,
      // Only connector extensions are interesting; everything else (*.png, *.pid, ...) is noise.
      ignored: (p, stats) =>
        (stats?.isFile() ?? false) && !TRACE_EXTENSIONS.has(path.extname(p).toLowerCase()),
    },
  )
  watcher.on('add', (p) => schedule(p, () => rescan(p)))
  watcher.on('change', (p) => schedule(p, () => rescan(p)))
  watcher.on('unlink', (p) => {
    if (p.endsWith(META_SUFFIX)) {
      schedule(p, () => rescan(p))
      return
    }
    if (!isTraceSource(p)) return
    schedule(p, async () => {
      await waitForFullScan()
      const activeProgress = progress
      const observations = sourceObservations
      const root = rootFor(p, resolvedRoots)
      const status = progressStatusFor(root)
      const previous = observations.get(p)
      const removed = store.remove(p)
      if (progress !== activeProgress || sourceObservations !== observations) return
      if (status && previous) {
        status.files = Math.max(0, status.files - 1)
        if (previous.scanned) status.scannedFiles = Math.max(0, status.scannedFiles - 1)
        status.traces = Math.max(0, status.traces - previous.traces)
        progress.totalFiles = Math.max(0, progress.totalFiles - 1)
        if (previous.scanned) progress.scannedFiles = Math.max(0, progress.scannedFiles - 1)
      }
      observations.delete(p)

      // Trace ids are global. If the removed file had overwritten an identical id from another
      // source, restore the newest remaining source instead of making that trace disappear.
      if (removed > 0 && previous?.traceIds.length) {
        await restoreShadowedSources(previous.traceIds, p, observations)
      }
    })
  })
  watcher.on('error', (e) => {
    console.warn(`[watch] ${errorMessage(e)}`)
    const errorPath =
      typeof e === 'object' && e !== null && 'path' in e && typeof e.path === 'string'
        ? path.resolve(e.path)
        : undefined
    const root =
      errorPath === undefined
        ? undefined
        : (resolvedRoots.find((candidate) => candidate.path === errorPath) ??
          rootFor(errorPath, resolvedRoots))
    const status = progressStatusFor(root)
    if (status) {
      status.state = 'error'
      status.warnings += 1
    }
  })
  return watcher
}
