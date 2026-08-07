/** Message-level live-update contract. Source files remain the durable truth. */
export type LiveEventType =
  | 'trace.upserted'
  | 'trace.removed'
  | 'store.reset'
  | 'batch.updated'
  | 'snapshot.required'

export interface LiveEvent {
  id: number
  type: LiveEventType
  dataVersion: number
  traceUid?: string
  runId?: string
  timestamp: string
}
