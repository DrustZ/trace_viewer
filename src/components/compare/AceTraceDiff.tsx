import type { ReviewMode, ReviewRecord, ReviewSubject } from '@shared/reviews/types'
import type { Message, ToolLedgerEntry, Trace, WorldDiffEntry } from '@shared/schema/types'
import { useMemo } from 'react'
import { useTrace } from '../../api/hooks'
import { useReviewWorkspace } from '../../api/reviews'

export type TraceDiffStatus = 'unchanged' | 'changed' | 'added' | 'removed'

interface Positioned<T> {
  value: T
  index: number
  position: number
  stableId?: string
}

interface AlignedItem<T> {
  a?: Positioned<T>
  b?: Positioned<T>
  matchBy?: 'stable_id' | 'chronological_position'
  reordered: boolean
}

export interface MessageDiffRow {
  key: string
  status: TraceDiffStatus
  matchBy?: AlignedItem<Message>['matchBy']
  reordered: boolean
  differences: string[]
  a?: Positioned<Message>
  b?: Positioned<Message>
}

export interface ToolDiffRow {
  key: string
  status: TraceDiffStatus
  matchBy?: AlignedItem<ToolLedgerEntry>['matchBy']
  reordered: boolean
  differences: string[]
  a?: Positioned<ToolLedgerEntry>
  b?: Positioned<ToolLedgerEntry>
}

export interface WorldDiffRow {
  key: string
  status: TraceDiffStatus
  differences: string[]
  a?: Positioned<WorldDiffEntry>
  b?: Positioned<WorldDiffEntry>
}

export interface AceTraceComparison {
  messages: MessageDiffRow[]
  tools: ToolDiffRow[]
  world: WorldDiffRow[]
}

export interface ComparisonReviewState {
  loading: boolean
  records: ReviewRecord[]
  draftModes: ReviewMode[]
  error?: string
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalValue(child)]),
    )
  }
  return value
}

function valueKey(value: unknown): string {
  if (value === undefined) return 'undefined:'
  return `${typeof value}:${JSON.stringify(canonicalValue(value))}`
}

function displayValue(value: unknown): string {
  if (value === undefined) return '—'
  if (typeof value === 'string') return value
  return JSON.stringify(canonicalValue(value), null, 2) ?? String(value)
}

function positioned<T>(
  values: readonly T[],
  stableId: (value: T) => string | undefined,
  chronologicalPosition?: (value: T, arrayIndex: number) => number,
): Positioned<T>[] {
  return values
    .map((value, index) => ({
      value,
      index,
      position: chronologicalPosition?.(value, index) ?? index,
      stableId: stableId(value),
    }))
    .sort((a, b) => a.position - b.position || a.index - b.index)
}

/**
 * Pair durable ids first, then only pair still-unmatched items at the same
 * chronological position. Stable-id rank detects true reorderings without
 * treating every item after an insertion as moved.
 */
function alignSequence<T>(
  a: Positioned<T>[],
  b: Positioned<T>[],
  options: { fallbackByPosition: boolean; detectReordering: boolean },
): AlignedItem<T>[] {
  const usedA = new Set<number>()
  const usedB = new Set<number>()
  const pairs: AlignedItem<T>[] = []
  const bById = new Map<string, Positioned<T>[]>()
  for (const item of b) {
    if (!item.stableId) continue
    const existing = bById.get(item.stableId)
    if (existing) existing.push(item)
    else bById.set(item.stableId, [item])
  }

  for (const left of a) {
    if (!left.stableId) continue
    const match = bById.get(left.stableId)?.find((candidate) => !usedB.has(candidate.index))
    if (!match) continue
    usedA.add(left.index)
    usedB.add(match.index)
    pairs.push({ a: left, b: match, matchBy: 'stable_id', reordered: false })
  }

  if (options.detectReordering) {
    const stablePairs = pairs.filter((pair) => pair.matchBy === 'stable_id')
    const aRanks = new Map(
      [...stablePairs]
        .sort((left, right) => (left.a?.position ?? 0) - (right.a?.position ?? 0))
        .map((pair, rank) => [pair, rank]),
    )
    const bRanks = new Map(
      [...stablePairs]
        .sort((left, right) => (left.b?.position ?? 0) - (right.b?.position ?? 0))
        .map((pair, rank) => [pair, rank]),
    )
    for (const pair of stablePairs) pair.reordered = aRanks.get(pair) !== bRanks.get(pair)
  }

  if (options.fallbackByPosition) {
    const remainingBByPosition = new Map<number, Positioned<T>[]>()
    for (const right of b) {
      if (usedB.has(right.index)) continue
      const existing = remainingBByPosition.get(right.position)
      if (existing) existing.push(right)
      else remainingBByPosition.set(right.position, [right])
    }
    for (const left of a) {
      if (usedA.has(left.index)) continue
      const match = remainingBByPosition
        .get(left.position)
        ?.find((candidate) => !usedB.has(candidate.index))
      if (!match) continue
      usedA.add(left.index)
      usedB.add(match.index)
      pairs.push({
        a: left,
        b: match,
        matchBy: 'chronological_position',
        reordered: false,
      })
    }
  }

  for (const left of a) {
    if (!usedA.has(left.index)) pairs.push({ a: left, reordered: false })
  }
  for (const right of b) {
    if (!usedB.has(right.index)) pairs.push({ b: right, reordered: false })
  }

  return pairs.sort((left, right) => {
    const leftMin = Math.min(
      left.a?.position ?? Number.POSITIVE_INFINITY,
      left.b?.position ?? Infinity,
    )
    const rightMin = Math.min(
      right.a?.position ?? Number.POSITIVE_INFINITY,
      right.b?.position ?? Infinity,
    )
    if (leftMin !== rightMin) return leftMin - rightMin
    const leftMax = Math.max(left.a?.position ?? -1, left.b?.position ?? -1)
    const rightMax = Math.max(right.a?.position ?? -1, right.b?.position ?? -1)
    if (leftMax !== rightMax) return leftMax - rightMax
    return (left.a?.index ?? left.b?.index ?? 0) - (right.a?.index ?? right.b?.index ?? 0)
  })
}

function pairStatus<T>(pair: AlignedItem<T>, differences: readonly string[]): TraceDiffStatus {
  if (!pair.a) return 'added'
  if (!pair.b) return 'removed'
  return differences.length > 0 ? 'changed' : 'unchanged'
}

export function alignTraceMessages(a: readonly Message[], b: readonly Message[]): MessageDiffRow[] {
  const pairs = alignSequence(
    positioned(
      a,
      (message) => message.id,
      (message, index) => message.chronologicalIndex ?? index,
    ),
    positioned(
      b,
      (message) => message.id,
      (message, index) => message.chronologicalIndex ?? index,
    ),
    { fallbackByPosition: true, detectReordering: true },
  )
  return pairs.map((pair, index) => {
    const differences: string[] = []
    if (pair.a && pair.b) {
      if (pair.a.value.id !== pair.b.value.id) differences.push('id')
      if (pair.a.value.role !== pair.b.value.role) differences.push('role')
      if (pair.a.value.channel !== pair.b.value.channel) differences.push('channel')
      if (pair.a.value.content !== pair.b.value.content) differences.push('content')
      if (pair.reordered) differences.push('order')
    }
    return {
      key: pair.a?.value.id ?? pair.b?.value.id ?? `message-${index}`,
      status: pairStatus(pair, differences),
      matchBy: pair.matchBy,
      reordered: pair.reordered,
      differences,
      a: pair.a,
      b: pair.b,
    }
  })
}

export type ToolActualOutcome =
  | { kind: 'unknown' }
  | { kind: 'recorded'; value?: unknown }
  | { kind: 'unavailable' }

/** Unknown is authoritative even if a partial/simulated payload is present. */
export function toolActualOutcome(entry: ToolLedgerEntry): ToolActualOutcome {
  if (entry.outcomeKnown === false) return { kind: 'unknown' }
  const value = entry.actualResult ?? entry.actualResultHead
  if (value !== undefined || entry.outcomeKnown === true) return { kind: 'recorded', value }
  return { kind: 'unavailable' }
}

function visibleToolResult(entry: ToolLedgerEntry): unknown {
  return entry.result ?? entry.resultHead
}

export function alignToolSequence(
  a: readonly ToolLedgerEntry[],
  b: readonly ToolLedgerEntry[],
): ToolDiffRow[] {
  const pairs = alignSequence(
    positioned(a, (entry) => entry.toolCallId),
    positioned(b, (entry) => entry.toolCallId),
    { fallbackByPosition: true, detectReordering: true },
  )
  return pairs.map((pair, index) => {
    const differences: string[] = []
    if (pair.a && pair.b) {
      const left = pair.a.value
      const right = pair.b.value
      if (left.toolCallId !== right.toolCallId) differences.push('tool call id')
      if (left.name !== right.name) differences.push('name')
      if (valueKey(left.args) !== valueKey(right.args)) differences.push('arguments')
      if (valueKey(visibleToolResult(left)) !== valueKey(visibleToolResult(right))) {
        differences.push('visible result')
      }
      if (valueKey(toolActualOutcome(left)) !== valueKey(toolActualOutcome(right))) {
        differences.push('actual outcome')
      }
      if (left.ok !== right.ok) differences.push('ok')
      if (left.executed !== right.executed) differences.push('executed')
      if (pair.reordered) differences.push('order')
    }
    return {
      key: pair.a?.value.toolCallId ?? pair.b?.value.toolCallId ?? `tool-${index}`,
      status: pairStatus(pair, differences),
      matchBy: pair.matchBy,
      reordered: pair.reordered,
      differences,
      a: pair.a,
      b: pair.b,
    }
  })
}

function worldKey(entry: WorldDiffEntry): string {
  return `${entry.orderId ?? '(world)'}\u0000${entry.field}`
}

export function alignWorldDiff(
  a: readonly WorldDiffEntry[],
  b: readonly WorldDiffEntry[],
): WorldDiffRow[] {
  const pairs = alignSequence(positioned(a, worldKey), positioned(b, worldKey), {
    fallbackByPosition: false,
    detectReordering: false,
  })
  return pairs.map((pair, index) => {
    const differences: string[] = []
    if (pair.a && pair.b) {
      if (valueKey(pair.a.value.before) !== valueKey(pair.b.value.before))
        differences.push('before')
      if (valueKey(pair.a.value.after) !== valueKey(pair.b.value.after)) differences.push('after')
      if (pair.a.value.legal !== pair.b.value.legal) differences.push('legal')
    }
    return {
      key: pair.a ? worldKey(pair.a.value) : pair.b ? worldKey(pair.b.value) : `world-${index}`,
      status: pairStatus(pair, differences),
      differences,
      a: pair.a,
      b: pair.b,
    }
  })
}

export function compareAceTraces(a: Trace, b: Trace): AceTraceComparison {
  return {
    messages: alignTraceMessages(a.messages, b.messages),
    tools: alignToolSequence(a.evaluation?.ledger ?? [], b.evaluation?.ledger ?? []),
    world: alignWorldDiff(a.evaluation?.worldDiff ?? [], b.evaluation?.worldDiff ?? []),
  }
}

function traceUid(trace: Trace): string {
  return trace.meta.traceUid ?? trace.meta.traceId
}

export function comparisonReviewSubject(trace: Trace, mode: ReviewMode): ReviewSubject {
  return {
    corpusId:
      trace.meta.corpusId ??
      (trace.meta.sourceFormat.startsWith('ace') ? 'simulation' : 'production'),
    runId:
      trace.meta.runId ??
      (typeof trace.meta.extra?.run === 'string' ? trace.meta.extra.run : 'unassigned'),
    traceUid: traceUid(trace),
    rubricVersion: trace.evaluation?.judge?.rubricVersion ?? 'judge_v2',
    annotator: 'local',
    mode,
  }
}

function queryError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function useComparisonReviews(trace: Trace | undefined): ComparisonReviewState {
  const assisted = useReviewWorkspace(
    trace ? comparisonReviewSubject(trace, 'assisted') : undefined,
  )
  const calibration = useReviewWorkspace(
    trace ? comparisonReviewSubject(trace, 'calibration') : undefined,
  )
  if (!trace || assisted.isLoading || calibration.isLoading) {
    return { loading: true, records: [], draftModes: [] }
  }
  const records = [assisted.data?.latestFinal, calibration.data?.latestFinal].filter(
    (record): record is ReviewRecord => record !== null && record !== undefined,
  )
  const draftModes: ReviewMode[] = []
  if (assisted.data?.draft) draftModes.push('assisted')
  if (calibration.data?.draft) draftModes.push('calibration')
  const errors = [assisted.error, calibration.error].filter(
    (error): error is NonNullable<typeof error> => error !== null,
  )
  return {
    loading: false,
    records,
    draftModes,
    ...(errors.length > 0 ? { error: errors.map(queryError).join('; ') } : {}),
  }
}

function countStatus<T extends { status: TraceDiffStatus }>(rows: readonly T[]) {
  return {
    changed: rows.filter((row) => row.status === 'changed').length,
    added: rows.filter((row) => row.status === 'added').length,
    removed: rows.filter((row) => row.status === 'removed').length,
  }
}

function DiffBadge({ status }: { status: TraceDiffStatus }) {
  const color =
    status === 'added'
      ? 'bg-emerald-50 text-emerald-700'
      : status === 'removed'
        ? 'bg-red-50 text-red-700'
        : status === 'changed'
          ? 'bg-amber-50 text-amber-800'
          : 'bg-slate-100 text-slate-500'
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${color}`}>{status}</span>
}

function ChangeDescription({
  status,
  differences,
}: {
  status: TraceDiffStatus
  differences: readonly string[]
}) {
  return (
    <span className="text-[10px] text-slate-400">
      {status === 'added'
        ? 'only in B'
        : status === 'removed'
          ? 'only in A'
          : differences.length > 0
            ? differences.join(', ')
            : 'no field changes'}
    </span>
  )
}

function MessageCell({ item }: { item: Positioned<Message> | undefined }) {
  if (!item) return <span className="text-slate-300">—</span>
  const message = item.value
  return (
    <div className="min-w-64 space-y-1">
      <div className="flex flex-wrap items-center gap-1 text-[10px] text-slate-500">
        <b className="font-mono text-slate-700">{message.role}</b>
        {message.channel ? <span>{message.channel}</span> : null}
        <span>chronological #{item.position}</span>
        <span className="font-mono">{message.id}</span>
      </div>
      <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-2 text-xs text-slate-800">
        {message.content || '(empty content)'}
      </pre>
    </div>
  )
}

function ActualOutcome({ entry }: { entry: ToolLedgerEntry }) {
  const outcome = toolActualOutcome(entry)
  if (outcome.kind === 'unknown') {
    return <span className="font-medium text-amber-700">Unknown outcome</span>
  }
  if (outcome.kind === 'unavailable') return <span className="text-slate-400">Not recorded</span>
  if (outcome.value === undefined) {
    return <span className="text-slate-500">Known; payload not recorded</span>
  }
  return <pre className="whitespace-pre-wrap break-words">{displayValue(outcome.value)}</pre>
}

function ToolCell({ item }: { item: Positioned<ToolLedgerEntry> | undefined }) {
  if (!item) return <span className="text-slate-300">—</span>
  const entry = item.value
  return (
    <div className="min-w-72 space-y-1.5 text-[10px]">
      <div className="flex flex-wrap items-center gap-1">
        <b className="font-mono text-xs text-slate-800">{entry.name}</b>
        <span className="text-slate-400">sequence #{item.position}</span>
        {entry.toolCallId ? (
          <span className="font-mono text-slate-400">{entry.toolCallId}</span>
        ) : null}
      </div>
      <div className="grid gap-1 sm:grid-cols-[6rem_1fr]">
        <b className="text-slate-500">Arguments</b>
        <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-1.5">
          {displayValue(entry.args)}
        </pre>
        <b className="text-slate-500">Visible result</b>
        <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-1.5">
          {displayValue(visibleToolResult(entry))}
        </pre>
        <b className="text-slate-500">Actual result</b>
        <div className="max-h-24 overflow-auto rounded bg-slate-50 p-1.5">
          <ActualOutcome entry={entry} />
        </div>
      </div>
    </div>
  )
}

function WorldCell({ item }: { item: Positioned<WorldDiffEntry> | undefined }) {
  if (!item) return <span className="text-slate-300">—</span>
  const entry = item.value
  return (
    <div className="min-w-56 space-y-1 text-[10px]">
      <p className="font-mono text-xs text-slate-800">
        {entry.orderId ?? '(world)'} · {entry.field}
      </p>
      <div className="grid grid-cols-[3rem_1fr] gap-1">
        <b className="text-slate-500">Before</b>
        <pre className="whitespace-pre-wrap break-words">{displayValue(entry.before)}</pre>
        <b className="text-slate-500">After</b>
        <pre className="whitespace-pre-wrap break-words">{displayValue(entry.after)}</pre>
        <b className="text-slate-500">Legal</b>
        <span>{entry.legal === undefined ? '—' : entry.legal ? 'yes' : 'no'}</span>
      </div>
    </div>
  )
}

function ReviewRecordCard({ record }: { record: ReviewRecord }) {
  return (
    <article className="rounded border border-slate-200 bg-white p-2 text-[10px]">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-xs text-slate-800">{record.overallVerdict}</b>
        <span>{record.mode}</span>
        <span>revision {record.revision}</span>
        <span>priority {record.priority}</span>
      </div>
      {record.rootCauseTags.length > 0 ? (
        <p className="mt-1">Root cause: {record.rootCauseTags.join(', ')}</p>
      ) : null}
      {record.rubricReviews.length > 0 ? (
        <p className="mt-1">
          Rubric:{' '}
          {record.rubricReviews
            .map((review) => `${review.dimensionId}=${review.verdict}`)
            .join(' · ')}
        </p>
      ) : null}
      {record.failureReviews.length > 0 ? (
        <p className="mt-1">
          Failures:{' '}
          {record.failureReviews
            .map((review) => `${review.failureId}=${review.decision}`)
            .join(' · ')}
        </p>
      ) : null}
      {record.turnAnnotations.length > 0 ? (
        <p className="mt-1">
          Turn labels: {record.turnAnnotations.map((annotation) => annotation.label).join(', ')}
        </p>
      ) : null}
      {record.note ? (
        <p className="mt-1 whitespace-pre-wrap text-slate-600">{record.note}</p>
      ) : null}
    </article>
  )
}

function ReviewSide({ label, state }: { label: string; state: ComparisonReviewState }) {
  return (
    <div className="space-y-2 rounded bg-slate-50 p-3">
      <h4 className="text-xs font-semibold text-slate-700">{label}</h4>
      {state.loading ? <p className="text-xs text-slate-500">Loading review labels…</p> : null}
      {state.records.map((record) => (
        <ReviewRecordCard key={record.key} record={record} />
      ))}
      {!state.loading && state.records.length === 0 ? (
        <p className="text-xs text-amber-800">
          Review labels unavailable for this comparison: no submitted local review was found for the
          current rubric.
        </p>
      ) : null}
      {state.draftModes.length > 0 ? (
        <p className="text-[10px] text-slate-500">
          Unsubmitted {state.draftModes.join(' + ')} draft exists; draft decisions are not treated
          as comparison labels.
        </p>
      ) : null}
      {state.error ? (
        <p className="text-[10px] text-red-700">
          Review labels unavailable for part of this comparison: {state.error}
        </p>
      ) : null}
    </div>
  )
}

export function AceTraceDiffSummary({
  traceA,
  traceB,
  comparison,
  reviewA,
  reviewB,
}: {
  traceA: Trace
  traceB: Trace
  comparison: AceTraceComparison
  reviewA: ComparisonReviewState
  reviewB: ComparisonReviewState
}) {
  const messageCounts = countStatus(comparison.messages)
  const toolCounts = countStatus(comparison.tools)
  const worldCounts = countStatus(comparison.world)
  return (
    <details
      data-testid="aligned-ace-trace-diff"
      className="rounded-lg border border-indigo-200 bg-white"
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-2 text-xs text-slate-700">
        <b className="text-indigo-800">Aligned ACE trace diff</b>
        <span className="rounded bg-slate-100 px-2 py-0.5">
          messages Δ{messageCounts.changed} +{messageCounts.added} −{messageCounts.removed}
        </span>
        <span className="rounded bg-slate-100 px-2 py-0.5">
          tools Δ{toolCounts.changed} +{toolCounts.added} −{toolCounts.removed}
        </span>
        <span className="rounded bg-slate-100 px-2 py-0.5">
          world Δ{worldCounts.changed} +{worldCounts.added} −{worldCounts.removed}
        </span>
        <span className="ml-auto text-slate-400">open aligned evidence</span>
      </summary>
      <div className="max-h-[44vh] space-y-4 overflow-auto border-t border-slate-100 p-4">
        <p className="text-[10px] text-slate-500">
          Exact traces: <span className="font-mono">{traceUid(traceA)}</span> ↔{' '}
          <span className="font-mono">{traceUid(traceB)}</span>. Messages and tools match stable IDs
          first, then chronological/sequence position. World changes match entity + field.
        </p>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
            Message alignment · {comparison.messages.length}
          </h3>
          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="w-full text-left align-top text-xs">
              <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Change</th>
                  <th className="px-3 py-2">A</th>
                  <th className="px-3 py-2">B</th>
                </tr>
              </thead>
              <tbody>
                {comparison.messages.map((row) => (
                  <tr key={row.key} className="border-t border-slate-100 align-top">
                    <td className="w-32 px-3 py-2">
                      <DiffBadge status={row.status} />
                      <div className="mt-1">
                        <ChangeDescription status={row.status} differences={row.differences} />
                      </div>
                      <p className="mt-1 text-[10px] text-slate-400">
                        {row.matchBy === 'stable_id'
                          ? 'stable id'
                          : row.matchBy === 'chronological_position'
                            ? 'chronological position'
                            : 'unpaired'}
                      </p>
                    </td>
                    <td className="px-3 py-2">
                      <MessageCell item={row.a} />
                    </td>
                    <td className="px-3 py-2">
                      <MessageCell item={row.b} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
            Tool sequence · {comparison.tools.length}
          </h3>
          {comparison.tools.length === 0 ? (
            <p className="rounded bg-slate-50 p-3 text-xs text-slate-500">
              Neither trace has an ACE tool ledger.
            </p>
          ) : (
            <div className="overflow-x-auto rounded border border-slate-200">
              <table className="w-full text-left align-top text-xs">
                <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Change</th>
                    <th className="px-3 py-2">A</th>
                    <th className="px-3 py-2">B</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.tools.map((row) => (
                    <tr key={row.key} className="border-t border-slate-100 align-top">
                      <td className="w-32 px-3 py-2">
                        <DiffBadge status={row.status} />
                        <div className="mt-1">
                          <ChangeDescription status={row.status} differences={row.differences} />
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <ToolCell item={row.a} />
                      </td>
                      <td className="px-3 py-2">
                        <ToolCell item={row.b} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
            World diff comparison · {comparison.world.length}
          </h3>
          {comparison.world.length === 0 ? (
            <p className="rounded bg-slate-50 p-3 text-xs text-slate-500">
              Neither trace records persistent world changes.
            </p>
          ) : (
            <div className="overflow-x-auto rounded border border-slate-200">
              <table className="w-full text-left align-top text-xs">
                <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Change</th>
                    <th className="px-3 py-2">A</th>
                    <th className="px-3 py-2">B</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.world.map((row) => (
                    <tr key={row.key} className="border-t border-slate-100 align-top">
                      <td className="w-32 px-3 py-2">
                        <DiffBadge status={row.status} />
                        <div className="mt-1">
                          <ChangeDescription status={row.status} differences={row.differences} />
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <WorldCell item={row.a} />
                      </td>
                      <td className="px-3 py-2">
                        <WorldCell item={row.b} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
            Human review labels
          </h3>
          <p className="mb-2 rounded border border-amber-200 bg-amber-50 p-2 text-[10px] text-amber-800">
            Label lookup is intentionally limited to submitted local Assisted/Calibration records
            for each trace&apos;s current rubric. Arbitrary annotators and historical rubric
            versions are unavailable for this comparison through the current trace-scoped API.
          </p>
          <div className="grid gap-3 lg:grid-cols-2">
            <ReviewSide label="A labels" state={reviewA} />
            <ReviewSide label="B labels" state={reviewB} />
          </div>
        </section>
      </div>
    </details>
  )
}

export function AceTraceDiff({ traceAId, traceBId }: { traceAId: string; traceBId: string }) {
  const a = useTrace(traceAId || undefined)
  const b = useTrace(traceBId || undefined)
  const reviewA = useComparisonReviews(a.data)
  const reviewB = useComparisonReviews(b.data)
  const comparison = useMemo(
    () => (a.data && b.data ? compareAceTraces(a.data, b.data) : undefined),
    [a.data, b.data],
  )

  if (a.isLoading || b.isLoading) {
    return (
      <p className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-500">
        Loading exact traces for aligned diff…
      </p>
    )
  }
  if (a.isError || b.isError || !a.data || !b.data || !comparison) {
    return (
      <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
        Aligned diff unavailable: one or both exact traces could not be loaded.
      </p>
    )
  }
  return (
    <AceTraceDiffSummary
      traceA={a.data}
      traceB={b.data}
      comparison={comparison}
      reviewA={reviewA}
      reviewB={reviewB}
    />
  )
}
