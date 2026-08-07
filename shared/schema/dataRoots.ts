export interface DataRootSummary {
  /** Opaque hash; absolute filesystem paths are never returned by list APIs. */
  id: string
  /** Account-safe display locator or the explicit run label. */
  label: string
  run: string | null
  dynamic: boolean
  /** True when this root will be restored automatically on the next server start. */
  persistent: boolean
}

export interface DataRootsResponse {
  roots: DataRootSummary[]
  /** Whether folders added through the API can be saved in the local private config. */
  persistenceAvailable: boolean
}

export interface AddDataRootRequest {
  path: string
  label?: string
}

export interface AddDataRootResponse {
  root: DataRootSummary
  indexedTraces: number
  warnings: number
  traceCount: number
  dataVersion: number
}
