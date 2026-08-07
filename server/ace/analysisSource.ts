import { createHash } from 'node:crypto'
import type { Message } from '../../shared/schema/types'
import type { TraceStore } from '../store/traceStore'

function withoutDetectorOverlay(message: Message): Message {
  if (message.metadata === undefined || !('aceFailures' in message.metadata)) return message
  const metadata = { ...message.metadata }
  delete metadata.aceFailures
  const { metadata: _overlayMetadata, ...sourceMessage } = message
  return Object.keys(metadata).length > 0 ? { ...sourceMessage, metadata } : sourceMessage
}

function canonicalJson(value: unknown): string {
  const normalize = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(normalize)
    if (typeof candidate !== 'object' || candidate === null) return candidate
    return Object.fromEntries(
      Object.entries(candidate)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalize(entry)]),
    )
  }
  return JSON.stringify(normalize(value))
}

/**
 * Fingerprint only the production transcript inputs consumed by ACE's Python
 * detector registry. Evaluation, flags, and the message-level `aceFailures`
 * projection are deliberately excluded because they are outputs of that same
 * analysis pass. This makes a detector overlay idempotent while still making
 * source additions, removals, and content replacements invalidate the cache.
 */
export function productionAnalysisSourceFingerprint(store: TraceStore): string {
  const sources = store
    .list()
    .filter((summary) => summary.meta.corpusId === 'production')
    .flatMap((summary) => {
      const traceUid = summary.meta.traceUid ?? summary.meta.traceId
      const stored = store.get(traceUid)
      if (!stored) return []
      return [
        {
          traceUid,
          sourceTraceId: stored.trace.meta.sourceTraceId ?? stored.trace.meta.traceId,
          sourcePath: stored.sourcePath ?? null,
          rawText: stored.rawText ?? null,
          truncated: stored.trace.stats.truncated,
          messages: stored.trace.messages.map(withoutDetectorOverlay),
        },
      ]
    })
    .sort((left, right) => left.traceUid.localeCompare(right.traceUid))

  return createHash('sha256')
    .update('ace-production-detector-input-v1\0')
    .update(canonicalJson(sources))
    .digest('hex')
}
