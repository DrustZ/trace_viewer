/**
 * API contract between server routes and the web client.
 *
 * GET  /api/health                -> { ok, version }
 * GET  /api/meta                  -> MetaResponse
 * GET  /api/runs                  -> RunsResponse
 * GET  /api/runs/instances        -> RunInstancesResponse (query: run? repeated, q?, limit?, offset?)
 * GET  /api/traces                -> TracesListResponse | GroupedTracesResponse (when groupBy=instance)
 *      query: split, step, component, status, filters (encoded FilterSet), q (keyword),
 *             sort (any FilterKey id, default 'time' = meta.timestamp), order (asc|desc),
 *             groupBy=instance, limit (default 100), offset
 * GET  /api/traces/:id            -> Trace (404 json { error })
 * GET  /api/traces/:id/raw        -> text/plain source
 * GET  /api/traces/:id/neighbors  -> NeighborsResponse (same query params as /api/traces)
 * GET  /api/traces/:id/siblings   -> TraceSummary[] (same instance+step, other rollouts)
 * GET  /api/aggregates/tiles      -> StatTiles            (same filter params as /api/traces)
 * GET  /api/aggregates/components -> ComponentAggregate[] (query: split?, step?)
 * GET  /api/aggregates/curves     -> RewardCurves         (query: component? repeated)
 * GET  /api/evolution/:instanceId -> EvolutionSeries (404 when unknown)
 * GET  /api/search?q=&limit=      -> SearchHit[]
 * POST /api/import                -> ImportResponse  body: { type: 'text'|'url', content?, url?, format? }
 * POST /api/ai-filter             -> AiFilterResponse body: { query }
 * POST /api/refresh               -> { traces, dataVersion }
 */
import type { FilterKeyDef } from '../filter/types'
import type { Split, TraceStatus, TraceSummary } from './types'

export type ScanRootMode = 'runs' | 'metadata' | 'fixed'
export type ScanRootState = 'pending' | 'scanning' | 'ready' | 'missing' | 'error'

/** Safe, aggregate-only scanner diagnostics. No trace or file contents are exposed. */
export interface ScanRootStatus {
  /** Stable opaque id for UI reconciliation; derived from but does not reveal the host path. */
  id: string
  /** Project/home-relative or basename-only display label; never an absolute host path. */
  label: string
  /** A fixed run label, or null when run names come from folders/trace metadata. */
  run: string | null
  mode: ScanRootMode
  state: ScanRootState
  files: number
  scannedFiles: number
  traces: number
  warnings: number
}

export interface MetaResponse {
  components: string[]
  steps: number[]
  splits: Split[]
  statuses: TraceStatus[]
  filterKeys: FilterKeyDef[]
  traceCount: number
  dataVersion: number
  scanning: boolean
  scannedFiles: number
  totalFiles: number
  scanRoots: ScanRootStatus[]
}

export interface RunAggregate {
  run: string
  count: number
  avgScore: number | null
}

export interface RunsResponse {
  total: number
  items: RunAggregate[]
  dataVersion: number
}

export interface RunInstancesResponse {
  total: number
  items: string[]
  limit: number
  offset: number
  dataVersion: number
}

export interface TracesListResponse {
  total: number
  items: TraceSummary[]
}

export interface InstanceGroup {
  instanceId: string
  component: string
  count: number
  avgScore: number | null
  items: TraceSummary[]
}

export interface GroupedTracesResponse {
  total: number
  groups: InstanceGroup[]
}

export interface NeighborsResponse {
  prevId: string | null
  nextId: string | null
  /** 1-based position of this trace within the filtered ordering. */
  position: number
  total: number
}

export interface SearchHit {
  traceId: string
  component: string
  score: number | null
  snippet: string
}

export interface ImportResponse {
  traceIds: string[]
  format: string
  warnings: string[]
}

export interface AiFilterResponse {
  filter: import('../filter/types').FilterSet
  source: 'llm' | 'rules'
  explanation: string
}

export interface RefreshResponse {
  traces: number
  dataVersion: number
}
