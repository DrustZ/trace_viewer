import {
  emptyReviewPayload,
  FAILURE_DECISIONS,
  type FailureDecision,
  REVIEW_PRIORITIES,
  REVIEW_VERDICTS,
  type ReviewGroundTruth,
  type ReviewPayload,
  type ReviewRecord,
  type ReviewSubject,
  type ReviewWorkspaceResponse,
  RUBRIC_VERDICTS,
  reviewSubjectKey,
} from '@shared/reviews/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useReviewWorkspace, useSaveReviewDraft, useSubmitReview } from '../../api/reviews'
import {
  applyReviewClassificationShortcut,
  reviewShortcutFor,
  visibleReviewShortcutLabels,
} from './shortcuts'

export interface ReviewPanelProps {
  subject: ReviewSubject
  className?: string
  autosaveDelayMs?: number
  onSubmitted?: (record: ReviewRecord) => void
  onNext?: (persistCurrent: ReviewNavigationGuard) => void | Promise<void>
  onNavigationGuardChange?: (guard: ReviewNavigationGuard | null) => void
  /** Keep hook/form state alive while hiding all review evidence during a pending URL transition. */
  suspended?: boolean
}

export type ReviewNavigationGuard = () => Promise<boolean>

function payloadOf(workspace: ReviewWorkspaceResponse): ReviewPayload {
  const stored = workspace.draft ?? workspace.latestFinal
  if (stored) {
    return {
      reviewStatus: stored.reviewStatus,
      overallVerdict: stored.overallVerdict,
      priority: stored.priority,
      rootCauseTags: [...stored.rootCauseTags],
      note: stored.note,
      rubricReviews: stored.rubricReviews.map((review) => ({
        ...review,
        evidenceMessageIds: [...review.evidenceMessageIds],
      })),
      failureReviews: stored.failureReviews.map((review) => ({ ...review })),
      turnAnnotations: stored.turnAnnotations.map((annotation) => ({
        ...annotation,
        tags: [...annotation.tags],
      })),
    }
  }
  const payload = emptyReviewPayload()
  payload.rubricReviews =
    workspace.trace.rubric?.map((definition) => ({
      dimensionId: definition.dimensionId,
      verdict: 'skip',
      critique: '',
      evidenceMessageIds: [],
    })) ?? []
  return payload
}

function csv(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ]
}

function errorMessage(value: unknown): string | null {
  return value instanceof Error ? value.message : value ? String(value) : null
}

export interface GroundTruthPresentation {
  kind: 'trace_bound' | 'reference' | 'unavailable' | 'legacy'
  title: string
  warning?: string
}

export function groundTruthPresentation(
  value: ReviewGroundTruth | unknown,
): GroundTruthPresentation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { kind: 'legacy', title: 'DB / policy ground truth' }
  }
  const candidate = value as Record<string, unknown>
  if (
    candidate.status === 'available' &&
    candidate.authoritative === true &&
    candidate.traceBound === true
  ) {
    return { kind: 'trace_bound', title: 'Trace-bound task ground truth' }
  }
  if (
    candidate.status === 'reference' &&
    candidate.authoritative === false &&
    candidate.source === 'current_task_catalog'
  ) {
    return {
      kind: 'reference',
      title: 'Current task catalog reference (not trace-bound)',
      warning:
        'Informational only: the current checkout may differ from the task definition used for this historical trace.',
    }
  }
  if (candidate.status === 'unavailable' && candidate.authoritative === false) {
    return {
      kind: 'unavailable',
      title: 'Task ground truth unavailable',
      warning:
        'No matching trace-bound scenario snapshot exists. The current checkout is not substituted in Calibration mode.',
    }
  }
  return { kind: 'legacy', title: 'DB / policy ground truth' }
}

function inputClass(): string {
  return 'w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:opacity-60'
}

export function ReviewPanel({
  subject,
  className = '',
  autosaveDelayMs = 800,
  onSubmitted,
  onNext,
  onNavigationGuardChange,
  suspended = false,
}: ReviewPanelProps) {
  const workspaceQuery = useReviewWorkspace(subject)
  const saveDraft = useSaveReviewDraft()
  const submitReview = useSubmitReview()
  const [payload, setPayload] = useState<ReviewPayload | null>(null)
  const [dirty, setDirty] = useState(false)
  const [customDimension, setCustomDimension] = useState('')
  const [submitted, setSubmitted] = useState<ReviewRecord | null>(null)
  const [editingRevision, setEditingRevision] = useState(false)
  const [revealedAutomatic, setRevealedAutomatic] = useState<ReviewWorkspaceResponse['automatic']>()
  const [focusedFailureId, setFocusedFailureId] = useState<string | null>(null)
  const loadedSubject = useRef<string | null>(null)
  const editVersion = useRef(0)
  const nextInFlight = useRef(false)
  const submitInFlight = useRef(false)
  const subjectKey = reviewSubjectKey(subject)

  useEffect(() => {
    if (!workspaceQuery.data || loadedSubject.current === subjectKey) return
    loadedSubject.current = subjectKey
    setPayload(payloadOf(workspaceQuery.data))
    setSubmitted(workspaceQuery.data.latestFinal)
    setEditingRevision(
      subject.mode === 'assisted' &&
        workspaceQuery.data.latestFinal !== null &&
        workspaceQuery.data.draft !== null,
    )
    setRevealedAutomatic(workspaceQuery.data.automatic)
    setDirty(false)
    editVersion.current = 0
  }, [subject.mode, subjectKey, workspaceQuery.data])

  const latestFinal = submitted ?? workspaceQuery.data?.latestFinal
  const locked = Boolean(latestFinal) && !editingRevision
  const nextRevision = (latestFinal?.revision ?? 0) + 1
  const workspaceReady = loadedSubject.current === subjectKey
  const automatic = workspaceReady
    ? (revealedAutomatic ?? workspaceQuery.data?.automatic)
    : undefined
  const visibleFailureIds = useMemo(
    () => automatic?.failures?.map((failure) => failure.id) ?? [],
    [automatic?.failures],
  )

  const update = useCallback(
    (apply: (previous: ReviewPayload) => ReviewPayload) => {
      if (locked) return
      editVersion.current += 1
      setDirty(true)
      setPayload((previous) => (previous ? apply(previous) : previous))
    },
    [locked],
  )

  const decideFailure = useCallback(
    (failureId: string, decision: FailureDecision) => {
      update((previous) => {
        const existing = previous.failureReviews.find((item) => item.failureId === failureId)
        return {
          ...previous,
          failureReviews: [
            ...previous.failureReviews.filter((item) => item.failureId !== failureId),
            { failureId, decision, note: existing?.note ?? '' },
          ],
        }
      })
    },
    [update],
  )

  useEffect(() => {
    setFocusedFailureId((current) =>
      current && visibleFailureIds.includes(current) ? current : (visibleFailureIds[0] ?? null),
    )
  }, [visibleFailureIds])

  const saveCurrent = useCallback(async (): Promise<boolean> => {
    if (!payload || locked) return false
    const version = editVersion.current
    try {
      await saveDraft.mutateAsync({
        subject,
        review: payload,
        expectedRevision: nextRevision,
      })
      const savedLatestVersion = editVersion.current === version
      if (savedLatestVersion) setDirty(false)
      // A navigation must never clear edits made while this request was in
      // flight. The caller can retry after the newer version is persisted.
      return savedLatestVersion
    } catch {
      // The mutation exposes the error inline; keep the workspace open.
      return false
    }
  }, [locked, nextRevision, payload, saveDraft, subject])

  const persistCurrent = useCallback<ReviewNavigationGuard>(
    async () => (!dirty || locked ? true : saveCurrent()),
    [dirty, locked, saveCurrent],
  )

  useEffect(() => {
    if (!onNavigationGuardChange) return
    onNavigationGuardChange(persistCurrent)
    return () => onNavigationGuardChange(null)
  }, [onNavigationGuardChange, persistCurrent])

  const submitCurrent = useCallback(async (): Promise<void> => {
    if (!payload || locked || submitInFlight.current) return
    submitInFlight.current = true
    const finalPayload: ReviewPayload = {
      ...payload,
      reviewStatus: payload.reviewStatus === 'in_review' ? 'reviewed' : payload.reviewStatus,
    }
    try {
      const response = await submitReview.mutateAsync({
        subject,
        review: finalPayload,
        expectedRevision: nextRevision,
      })
      setPayload(finalPayload)
      setSubmitted(response.record)
      setEditingRevision(false)
      setRevealedAutomatic(response.automatic)
      setDirty(false)
      // An autosave that raced this submit lost by design (423/409); its error
      // must not be shown over a successful "Submitted and locked".
      saveDraft.reset()
      onSubmitted?.(response.record)
    } catch {
      // The mutation exposes the error inline and the review remains editable.
    } finally {
      submitInFlight.current = false
    }
  }, [locked, nextRevision, onSubmitted, payload, saveDraft.reset, subject, submitReview])

  const goNext = useCallback(async (): Promise<void> => {
    if (!onNext || nextInFlight.current) return
    nextInFlight.current = true
    try {
      // ReviewPage captures a stable queue successor before invoking this
      // guard, because persisting a draft can remove the current row from the
      // active filter.
      await onNext(persistCurrent)
    } finally {
      nextInFlight.current = false
    }
  }, [onNext, persistCurrent])

  useEffect(() => {
    if (!dirty || !payload || locked || suspended) return
    const version = editVersion.current
    const timer = window.setTimeout(() => {
      // A submit in flight will append and lock the final; a late autosave
      // would land second and surface a spurious 423/409 after success.
      if (submitInFlight.current) return
      void saveDraft
        .mutateAsync({
          subject,
          review: payload,
          expectedRevision: nextRevision,
        })
        .then(() => {
          if (editVersion.current === version) setDirty(false)
        })
        .catch(() => {
          // Keep dirty=true so an explicit retry or the next edit can persist it.
        })
    }, autosaveDelayMs)
    return () => window.clearTimeout(timer)
  }, [autosaveDelayMs, dirty, locked, payload, saveDraft, subject, nextRevision, suspended])

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (!workspaceReady || suspended) return
      const shortcut = reviewShortcutFor(event)
      if (shortcut === 'next' && onNext) {
        event.preventDefault()
        void goNext()
        return
      }
      if (!payload || locked) return
      if (shortcut === 'save') {
        event.preventDefault()
        void saveCurrent()
        return
      }
      if (shortcut === 'submit') {
        event.preventDefault()
        void submitCurrent()
        return
      }
      if (shortcut === 'overall-pass' || shortcut === 'overall-fail') {
        event.preventDefault()
        update((previous) =>
          applyReviewClassificationShortcut(
            previous,
            shortcut,
            focusedFailureId,
            visibleFailureIds,
          ),
        )
        return
      }
      if (
        (shortcut === 'failure-confirm' || shortcut === 'failure-reject') &&
        focusedFailureId &&
        visibleFailureIds.includes(focusedFailureId)
      ) {
        event.preventDefault()
        update((previous) =>
          applyReviewClassificationShortcut(
            previous,
            shortcut,
            focusedFailureId,
            visibleFailureIds,
          ),
        )
      }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [
    focusedFailureId,
    goNext,
    locked,
    onNext,
    payload,
    saveCurrent,
    submitCurrent,
    suspended,
    update,
    visibleFailureIds,
    workspaceReady,
  ])

  const rubricDefinitions = useMemo(() => {
    const definitions = new Map(
      workspaceQuery.data?.trace.rubric?.map((definition) => [
        definition.dimensionId,
        definition,
      ]) ?? [],
    )
    for (const review of payload?.rubricReviews ?? []) {
      if (!definitions.has(review.dimensionId)) {
        definitions.set(review.dimensionId, {
          dimensionId: review.dimensionId,
          label: review.dimensionId,
        })
      }
    }
    return [...definitions.values()]
  }, [payload?.rubricReviews, workspaceQuery.data?.trace.rubric])
  const hasDefinedRubric = Boolean(workspaceQuery.data?.trace.rubric?.length)
  const groundTruth = workspaceQuery.data?.trace.groundTruth
  const groundTruthView =
    groundTruth === undefined ? undefined : groundTruthPresentation(groundTruth)

  if (suspended) {
    return (
      <aside
        aria-live="polite"
        className={`rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800 ${className}`}
      >
        Saving the current draft before changing the review queue…
      </aside>
    )
  }

  if (workspaceQuery.isLoading || !payload || loadedSubject.current !== subjectKey) {
    return <aside className={`p-4 text-sm text-slate-500 ${className}`}>Loading review…</aside>
  }
  if (workspaceQuery.error) {
    return (
      <aside
        className={`rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 ${className}`}
      >
        Could not load review: {errorMessage(workspaceQuery.error)}
      </aside>
    )
  }

  const mutateRubric = (
    dimensionId: string,
    apply: (
      review: ReviewPayload['rubricReviews'][number],
    ) => ReviewPayload['rubricReviews'][number],
  ) => {
    update((previous) => ({
      ...previous,
      rubricReviews: previous.rubricReviews.map((review) =>
        review.dimensionId === dimensionId ? apply(review) : review,
      ),
    }))
  }

  const mutationError = errorMessage(saveDraft.error ?? submitReview.error)

  return (
    <aside className={`space-y-5 rounded-xl border border-slate-200 bg-white p-4 ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Human review</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {subject.annotator} · {subject.rubricVersion} · revision{' '}
            {editingRevision ? nextRevision : (latestFinal?.revision ?? nextRevision)}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            subject.mode === 'calibration'
              ? 'bg-violet-100 text-violet-700'
              : 'bg-blue-100 text-blue-700'
          }`}
        >
          {subject.mode === 'calibration' ? 'Calibration' : 'Assisted'}
        </span>
      </header>

      {subject.mode === 'calibration' && !locked ? (
        <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-800">
          Blind review is active. Model, A/B arm, grades, judge verdicts, detector findings, and
          automatic failures stay server-hidden until this review is submitted and locked.
        </div>
      ) : null}
      {locked ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          Submitted and locked. Automatic evaluation is now revealed for comparison.
        </div>
      ) : null}

      {workspaceQuery.data?.trace.transcript?.length ? (
        <details open className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-800">
            Transcript · {workspaceQuery.data.trace.transcript.length} messages
          </summary>
          <ol className="mt-3 max-h-[32rem] space-y-2 overflow-auto">
            {workspaceQuery.data.trace.transcript.map((message) => (
              <li key={message.id} className="rounded-md border border-slate-200 bg-white p-2.5">
                <div className="flex items-center gap-2 text-[11px] text-slate-500">
                  <span className="font-mono font-medium text-slate-700">{message.id}</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 uppercase">
                    {message.role}
                  </span>
                  {message.timestamp ? <span className="ml-auto">{message.timestamp}</span> : null}
                </div>
                <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-xs leading-5 text-slate-800">
                  {message.content}
                </pre>
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      {automatic ? (
        <section className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <h3 className="text-sm font-semibold text-slate-800">Automatic evaluation</h3>
          {automatic.detectorAnalysis?.status === 'unavailable' ? (
            <div
              role="alert"
              className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900"
            >
              Canonical production detector analysis is unavailable (
              {automatic.detectorAnalysis.reason}). Assisted draft decisions and submission are
              blocked until the local analysis succeeds.
            </div>
          ) : null}
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            {automatic.model ? (
              <>
                <dt className="text-slate-500">Model</dt>
                <dd className="text-right text-slate-800">{automatic.model}</dd>
              </>
            ) : null}
            {automatic.arm ? (
              <>
                <dt className="text-slate-500">A/B arm</dt>
                <dd className="text-right text-slate-800">{automatic.arm}</dd>
              </>
            ) : null}
            {automatic.outcome ? (
              <>
                <dt className="text-slate-500">Outcome</dt>
                <dd className="text-right text-slate-800">{automatic.outcome}</dd>
              </>
            ) : null}
          </dl>
          {automatic.judgeVerdicts ? (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(automatic.judgeVerdicts).map(([dimension, verdict]) => (
                <span
                  key={dimension}
                  className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                >
                  {dimension}: {verdict.verdict}
                </span>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="text-xs font-medium text-slate-600">
          Overall verdict
          <select
            className={`${inputClass()} mt-1`}
            aria-keyshortcuts="P F"
            value={payload.overallVerdict}
            disabled={locked}
            onChange={(event) =>
              update((previous) => ({
                ...previous,
                overallVerdict: event.target.value as ReviewPayload['overallVerdict'],
              }))
            }
          >
            {REVIEW_VERDICTS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          Review status
          <select
            className={`${inputClass()} mt-1`}
            value={payload.reviewStatus}
            disabled={locked}
            onChange={(event) =>
              update((previous) => ({
                ...previous,
                reviewStatus: event.target.value as ReviewPayload['reviewStatus'],
              }))
            }
          >
            <option value="in_review">in review</option>
            <option value="reviewed">reviewed</option>
            <option value="skipped">skipped</option>
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          Priority
          <select
            className={`${inputClass()} mt-1`}
            value={payload.priority}
            disabled={locked}
            onChange={(event) =>
              update((previous) => ({
                ...previous,
                priority: event.target.value as ReviewPayload['priority'],
              }))
            }
          >
            {REVIEW_PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </section>

      <label className="block text-xs font-medium text-slate-600">
        Root-cause tags (comma separated)
        <input
          className={`${inputClass()} mt-1`}
          value={payload.rootCauseTags.join(', ')}
          disabled={locked}
          onChange={(event) =>
            update((previous) => ({ ...previous, rootCauseTags: csv(event.target.value) }))
          }
        />
      </label>
      <label className="block text-xs font-medium text-slate-600">
        Overall note
        <textarea
          className={`${inputClass()} mt-1 min-h-24 resize-y`}
          value={payload.note}
          disabled={locked}
          onChange={(event) => update((previous) => ({ ...previous, note: event.target.value }))}
        />
      </label>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">Rubric verdicts</h3>
          <span className="text-xs text-slate-500">pass / fail / skip + critique + evidence</span>
        </div>
        {rubricDefinitions.map((definition) => {
          const review = payload.rubricReviews.find(
            (candidate) => candidate.dimensionId === definition.dimensionId,
          )
          if (!review) return null
          return (
            <article
              key={definition.dimensionId}
              className="rounded-lg border border-slate-200 p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h4 className="text-sm font-medium text-slate-800">{definition.label}</h4>
                  {definition.description ? (
                    <p className="mt-1 text-xs text-slate-500">{definition.description}</p>
                  ) : null}
                </div>
                <fieldset className="flex gap-1">
                  <legend className="sr-only">{definition.label} verdict</legend>
                  {RUBRIC_VERDICTS.map((verdict) => (
                    <button
                      key={verdict}
                      type="button"
                      disabled={locked}
                      onClick={() =>
                        mutateRubric(definition.dimensionId, (item) => ({ ...item, verdict }))
                      }
                      className={`rounded px-2 py-1 text-xs font-medium ${
                        review.verdict === verdict
                          ? verdict === 'pass'
                            ? 'bg-emerald-600 text-white'
                            : verdict === 'fail'
                              ? 'bg-red-600 text-white'
                              : 'bg-slate-600 text-white'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {verdict}
                    </button>
                  ))}
                </fieldset>
              </div>
              <textarea
                aria-label={`${definition.label} critique`}
                className={`${inputClass()} mt-3 min-h-20 resize-y`}
                placeholder="Critique"
                value={review.critique}
                disabled={locked}
                onChange={(event) =>
                  mutateRubric(definition.dimensionId, (item) => ({
                    ...item,
                    critique: event.target.value,
                  }))
                }
              />
              <input
                aria-label={`${definition.label} evidence message ids`}
                className={`${inputClass()} mt-2`}
                placeholder="Evidence message IDs, comma separated"
                value={review.evidenceMessageIds.join(', ')}
                disabled={locked}
                onChange={(event) =>
                  mutateRubric(definition.dimensionId, (item) => ({
                    ...item,
                    evidenceMessageIds: csv(event.target.value),
                  }))
                }
              />
            </article>
          )
        })}
        {!locked && !hasDefinedRubric ? (
          <div className="flex gap-2">
            <input
              className={inputClass()}
              placeholder="Custom rubric dimension ID"
              value={customDimension}
              onChange={(event) => setCustomDimension(event.target.value)}
            />
            <button
              type="button"
              className="shrink-0 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700"
              onClick={() => {
                const dimensionId = customDimension.trim()
                if (
                  !dimensionId ||
                  payload.rubricReviews.some((item) => item.dimensionId === dimensionId)
                )
                  return
                update((previous) => ({
                  ...previous,
                  rubricReviews: [
                    ...previous.rubricReviews,
                    { dimensionId, verdict: 'skip', critique: '', evidenceMessageIds: [] },
                  ],
                }))
                setCustomDimension('')
              }}
            >
              Add
            </button>
          </div>
        ) : null}
        {!locked && hasDefinedRubric ? (
          <p className="text-xs text-slate-500">
            This trace has a fixed rubric. Custom dimensions are disabled so saved reviews match the
            scoring contract.
          </p>
        ) : null}
      </section>

      {automatic?.failures?.length ? (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-800">Automatic failure decisions</h3>
            <span className="text-xs text-slate-500">
              Focus a finding, then C confirm · X reject
            </span>
          </div>
          {automatic.failures.map((failure) => {
            const review = payload.failureReviews.find((item) => item.failureId === failure.id)
            const focused = focusedFailureId === failure.id
            return (
              <article
                key={failure.id}
                className={`rounded-lg border p-3 ${
                  focused
                    ? 'border-blue-400 bg-blue-50/40 ring-1 ring-blue-200'
                    : 'border-slate-200'
                }`}
                onFocus={() => setFocusedFailureId(failure.id)}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm font-medium text-slate-800">
                    {failure.code}{' '}
                    <span className="text-xs text-slate-500">· {failure.origin}</span>
                  </p>
                  <button
                    type="button"
                    aria-pressed={focused}
                    aria-keyshortcuts="C X"
                    className={`rounded px-2 py-1 text-[11px] font-medium ${
                      focused ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                    onClick={() => setFocusedFailureId(failure.id)}
                  >
                    {focused ? 'Focused · C / X' : 'Focus for shortcuts'}
                  </button>
                </div>
                <p className="mt-1 text-xs text-slate-600">{failure.message}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {FAILURE_DECISIONS.map((decision) => (
                    <button
                      key={decision}
                      type="button"
                      disabled={locked}
                      className={`rounded px-2 py-1 text-xs ${
                        review?.decision === decision
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                      onClick={() => decideFailure(failure.id, decision)}
                    >
                      {decision.replace('_', ' ')}
                    </button>
                  ))}
                </div>
                {review ? (
                  <input
                    className={`${inputClass()} mt-2`}
                    placeholder="Decision note"
                    value={review.note}
                    disabled={locked}
                    onChange={(event) =>
                      update((previous) => ({
                        ...previous,
                        failureReviews: previous.failureReviews.map((item) =>
                          item.failureId === failure.id
                            ? { ...item, note: event.target.value }
                            : item,
                        ),
                      }))
                    }
                  />
                ) : null}
              </article>
            )
          })}
        </section>
      ) : null}

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">Turn annotations</h3>
          {!locked ? (
            <button
              type="button"
              className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
              onClick={() => {
                const firstMessage = workspaceQuery.data?.trace.transcript?.[0]
                if (!firstMessage) return
                update((previous) => ({
                  ...previous,
                  turnAnnotations: [
                    ...previous.turnAnnotations,
                    {
                      annotationId: globalThis.crypto?.randomUUID?.() ?? `annotation-${Date.now()}`,
                      messageId: firstMessage.id,
                      label: '',
                      tags: [],
                      note: '',
                    },
                  ],
                }))
              }}
            >
              Add annotation
            </button>
          ) : null}
        </div>
        {payload.turnAnnotations.map((annotation) => (
          <article
            key={annotation.annotationId}
            className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-2"
          >
            <select
              className={inputClass()}
              aria-label="Annotated message"
              value={annotation.messageId}
              disabled={locked}
              onChange={(event) =>
                update((previous) => ({
                  ...previous,
                  turnAnnotations: previous.turnAnnotations.map((item) =>
                    item.annotationId === annotation.annotationId
                      ? { ...item, messageId: event.target.value }
                      : item,
                  ),
                }))
              }
            >
              {workspaceQuery.data?.trace.transcript?.map((message) => (
                <option key={message.id} value={message.id}>
                  {message.id} · {message.role}
                </option>
              ))}
            </select>
            <input
              className={inputClass()}
              placeholder="Label"
              value={annotation.label}
              disabled={locked}
              onChange={(event) =>
                update((previous) => ({
                  ...previous,
                  turnAnnotations: previous.turnAnnotations.map((item) =>
                    item.annotationId === annotation.annotationId
                      ? { ...item, label: event.target.value }
                      : item,
                  ),
                }))
              }
            />
            <input
              className={inputClass()}
              placeholder="Tags, comma separated"
              value={annotation.tags.join(', ')}
              disabled={locked}
              onChange={(event) =>
                update((previous) => ({
                  ...previous,
                  turnAnnotations: previous.turnAnnotations.map((item) =>
                    item.annotationId === annotation.annotationId
                      ? { ...item, tags: csv(event.target.value) }
                      : item,
                  ),
                }))
              }
            />
            <div className="flex gap-2">
              <input
                className={inputClass()}
                placeholder="Annotation note"
                value={annotation.note}
                disabled={locked}
                onChange={(event) =>
                  update((previous) => ({
                    ...previous,
                    turnAnnotations: previous.turnAnnotations.map((item) =>
                      item.annotationId === annotation.annotationId
                        ? { ...item, note: event.target.value }
                        : item,
                    ),
                  }))
                }
              />
              {!locked ? (
                <button
                  type="button"
                  className="rounded-md px-2 text-xs text-red-600"
                  onClick={() =>
                    update((previous) => ({
                      ...previous,
                      turnAnnotations: previous.turnAnnotations.filter(
                        (item) => item.annotationId !== annotation.annotationId,
                      ),
                    }))
                  }
                >
                  Remove
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </section>

      {groundTruth !== undefined && groundTruthView !== undefined ? (
        <details
          className={`rounded-lg border p-3 ${
            groundTruthView.kind === 'unavailable' || groundTruthView.kind === 'reference'
              ? 'border-amber-300 bg-amber-50'
              : 'border-slate-200 bg-slate-50'
          }`}
        >
          <summary className="cursor-pointer text-sm font-semibold text-slate-800">
            {groundTruthView.title}
          </summary>
          {groundTruthView.warning ? (
            <p className="mt-2 text-xs font-medium text-amber-800">{groundTruthView.warning}</p>
          ) : null}
          <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap text-xs text-slate-700">
            {JSON.stringify(groundTruth, null, 2)}
          </pre>
        </details>
      ) : null}

      <details className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-slate-700">
          Keyboard shortcuts
        </summary>
        <dl className="mt-2 grid gap-1.5 text-xs sm:grid-cols-3">
          {visibleReviewShortcutLabels(Boolean(automatic?.failures?.length)).map((shortcut) => (
            <div key={shortcut.action} className="flex items-center gap-2">
              <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                {shortcut.keys}
              </kbd>
              <span className="text-slate-500">{shortcut.description}</span>
            </div>
          ))}
        </dl>
      </details>

      {mutationError ? <p className="text-sm text-red-600">{mutationError}</p> : null}
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-4">
        <span className="text-xs text-slate-500">
          {locked
            ? 'Locked'
            : saveDraft.isPending
              ? 'Saving…'
              : dirty
                ? 'Unsaved changes'
                : 'Draft saved'}
        </span>
        <div className="flex gap-2">
          {onNext ? (
            <button
              type="button"
              aria-keyshortcuts="Alt+ArrowDown"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700"
              onClick={() => void goNext()}
            >
              Next · Alt/Option ↓
            </button>
          ) : null}
          {locked && subject.mode === 'assisted' ? (
            <button
              type="button"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700"
              onClick={() => {
                setEditingRevision(true)
                setPayload((previous) =>
                  previous ? { ...previous, reviewStatus: 'in_review' } : previous,
                )
              }}
            >
              Start revision {nextRevision}
            </button>
          ) : null}
          {!locked ? (
            <>
              <button
                type="button"
                aria-keyshortcuts="Control+S Meta+S"
                disabled={saveDraft.isPending}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 disabled:opacity-50"
                onClick={() => void saveCurrent()}
              >
                Save draft
              </button>
              <button
                type="button"
                aria-keyshortcuts="Control+Enter Meta+Enter"
                disabled={submitReview.isPending}
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                onClick={() => void submitCurrent()}
              >
                {submitReview.isPending ? 'Submitting…' : 'Submit & lock'}
              </button>
            </>
          ) : null}
        </div>
      </footer>
    </aside>
  )
}
