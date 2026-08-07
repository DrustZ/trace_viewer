import type { DetectorFlag, FailureV1, Message, Trace } from '@shared/schema/types'

/**
 * Single source of truth for trace failures.
 *
 * Two producers write failure data today: `trace.evaluation.failures`
 * (authoritative, normalized FailureV1) and per-message
 * `metadata.aceFailures` (denormalized anchors written by connectors and the
 * store enrichment pass). They can drift apart — an inline chip could show a
 * failure the Evaluation table doesn't, or vice versa. This module merges the
 * two: evaluation wins, message metadata only fills gaps, and detector
 * tier/family evidence from `evaluation.flags` is joined onto matching rows so
 * the message row can show the same taxonomy the aggregate views filter on.
 */
export interface UnifiedFailure {
  origin: string
  code: string
  severity: string
  /** Only programmatic grade checks may gate the task outcome. */
  gating: boolean
  evidence?: FailureV1['evidence']
  source: string
  /** Resolved id of the message this failure anchors to; undefined ⇒ trace-level. */
  messageId?: string
  /** Human anchor label for tables ('m-3', 'raw #4', '—'). */
  anchorLabel: string
  /** ACE detector evidence tier, joined from evaluation.flags when available. */
  tier?: string
  /** ACE detector family (log, env, or agent), joined from evaluation.flags. */
  family?: string
  /** True when only message metadata carried this failure (fill-in, not authoritative). */
  metadataOnly: boolean
}

/** Resolve the message a failure anchors to, honoring its declared index space. */
export function failureMessageId(trace: Trace, failure: FailureV1): string | undefined {
  if (failure.messageId !== undefined) {
    return trace.messages.some((message) => message.id === failure.messageId)
      ? failure.messageId
      : undefined
  }
  if (failure.indexSpace === 'raw' && failure.rawIndex !== undefined) {
    return trace.messages.find((message) => message.rawIndex === failure.rawIndex)?.id
  }
  if (failure.indexSpace === 'chronological' && failure.chronologicalIndex !== undefined) {
    return trace.messages.find(
      (message) => message.chronologicalIndex === failure.chronologicalIndex,
    )?.id
  }
  return undefined
}

function failureAnchorLabel(failure: FailureV1): string {
  if (failure.messageId !== undefined) return failure.messageId
  if (failure.indexSpace === 'raw' && failure.rawIndex !== undefined) {
    return `raw #${failure.rawIndex + 1}`
  }
  if (failure.indexSpace === 'chronological' && failure.chronologicalIndex !== undefined) {
    return `chronological #${failure.chronologicalIndex + 1}`
  }
  return '—'
}

function flagMessageId(trace: Trace, flag: DetectorFlag): string | undefined {
  if (flag.messageId !== undefined) {
    return trace.messages.some((message) => message.id === flag.messageId)
      ? flag.messageId
      : undefined
  }
  if (flag.indexSpace === 'raw' && flag.rawIndex !== undefined) {
    return trace.messages.find((message) => message.rawIndex === flag.rawIndex)?.id
  }
  if (flag.indexSpace === 'chronological' && flag.chronologicalIndex !== undefined) {
    return trace.messages.find((message) => message.chronologicalIndex === flag.chronologicalIndex)
      ?.id
  }
  return undefined
}

/**
 * Detector-origin failures carry the detector name as their code
 * (aceSidecar: `code: flag.detector`); join tier/family from the flag whose
 * anchor matches, falling back to a code-only match when anchors are absent.
 */
function detectorEvidence(
  trace: Trace,
  code: string,
  messageId: string | undefined,
): { tier?: string; family?: string } {
  const flags = trace.evaluation?.flags ?? []
  const candidates = flags.filter((flag) => flag.detector === code)
  if (candidates.length === 0) return {}
  const anchored = candidates.find((flag) => flagMessageId(trace, flag) === messageId)
  const match = anchored ?? candidates[0]
  return {
    ...(match.tier !== undefined ? { tier: match.tier } : {}),
    ...(match.family !== undefined ? { family: match.family } : {}),
  }
}

/** code + resolved anchor. Metadata fill-ins can only anchor to their carrying message. */
function dedupeKey(code: string, failure: FailureV1, messageId: string | undefined): string {
  if (messageId !== undefined) return `${code}@msg:${messageId}`
  if (failure.indexSpace === 'raw' && failure.rawIndex !== undefined) {
    return `${code}@raw:${failure.rawIndex}`
  }
  if (failure.indexSpace === 'chronological' && failure.chronologicalIndex !== undefined) {
    return `${code}@chrono:${failure.chronologicalIndex}`
  }
  return `${code}@trace`
}

interface MetadataFailure {
  code: string
  severity?: string
  origin?: string
  evidence?: string
}

function metadataFailures(message: Message): MetadataFailure[] {
  const value = message.metadata?.aceFailures
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate) => {
    if (typeof candidate !== 'object' || candidate === null) return []
    const item = candidate as Record<string, unknown>
    if (typeof item.code !== 'string') return []
    return [
      {
        code: item.code,
        ...(typeof item.severity === 'string' ? { severity: item.severity } : {}),
        ...(typeof item.origin === 'string' ? { origin: item.origin } : {}),
        ...(typeof item.evidence === 'string' ? { evidence: item.evidence } : {}),
      },
    ]
  })
}

/**
 * Merged failure list: `evaluation.failures` verbatim (authoritative order),
 * then any `metadata.aceFailures` entry whose code+anchor is not already
 * covered, marked `metadataOnly`. Fill-ins never claim `gating` — only the
 * normalized evaluation layer may gate an outcome.
 */
export function unifiedFailures(trace: Trace): UnifiedFailure[] {
  const merged: UnifiedFailure[] = []
  const seen = new Set<string>()

  for (const failure of trace.evaluation?.failures ?? []) {
    const messageId = failureMessageId(trace, failure)
    seen.add(dedupeKey(failure.code, failure, messageId))
    merged.push({
      origin: failure.origin,
      code: failure.code,
      severity: failure.severity,
      gating: failure.gating,
      ...(failure.evidence !== undefined ? { evidence: failure.evidence } : {}),
      source: failure.source,
      ...(messageId !== undefined ? { messageId } : {}),
      anchorLabel: failureAnchorLabel(failure),
      ...detectorEvidence(trace, failure.code, messageId),
      metadataOnly: false,
    })
  }

  for (const message of trace.messages) {
    for (const item of metadataFailures(message)) {
      const key = `${item.code}@msg:${message.id}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push({
        origin: item.origin ?? 'detector',
        code: item.code,
        severity: item.severity ?? 'minor',
        gating: false,
        ...(item.evidence !== undefined ? { evidence: item.evidence } : {}),
        source: 'message.metadata',
        messageId: message.id,
        anchorLabel: message.id,
        ...detectorEvidence(trace, item.code, message.id),
        metadataOnly: true,
      })
    }
  }

  return merged
}

/** Message-anchored view of the unified list, for inline chips. */
export function failuresByMessage(trace: Trace): Map<string, UnifiedFailure[]> {
  const index = new Map<string, UnifiedFailure[]>()
  for (const failure of unifiedFailures(trace)) {
    if (failure.messageId === undefined) continue
    const bucket = index.get(failure.messageId)
    if (bucket) bucket.push(failure)
    else index.set(failure.messageId, [failure])
  }
  return index
}
