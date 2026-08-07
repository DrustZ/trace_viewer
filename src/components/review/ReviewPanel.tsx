import {
  emptyReviewPayload,
  type FailureDecision,
  type ReviewPayload,
  type ReviewRecord,
  type ReviewSubject,
  type ReviewWorkspaceResponse,
  reviewSubjectKey,
  type TurnAnnotation,
} from '@shared/reviews/types'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useReviewWorkspace, useSaveReviewDraft, useSubmitReview } from '../../api/reviews'
import { ReviewAutomaticSection } from './ReviewAutomaticSection'
import { ReviewFailureSection } from './ReviewFailureSection'
import { ReviewFastPath } from './ReviewFastPath'
import { groundTruthPresentation, ReviewGroundTruthSection } from './ReviewGroundTruthSection'
import { ReviewRubricSection } from './ReviewRubricSection'
import { ReviewShortcutsHelp } from './ReviewShortcutsHelp'
import { ReviewStatusSection } from './ReviewStatusSection'
import { ReviewTranscriptSection } from './ReviewTranscriptSection'
import { ReviewTurnAnnotationsSection } from './ReviewTurnAnnotationsSection'
import {
  evidenceDimensionsByMessage,
  finalizeReviewPayload,
  toggleEvidenceMessageId,
} from './reviewPayloadOps'
import {
  applyReviewClassificationShortcut,
  isReviewEditingTarget,
  reviewShortcutFor,
} from './shortcuts'

// Re-exported so existing imports/tests keep working after the panel split.
export { type GroundTruthPresentation, groundTruthPresentation } from './ReviewGroundTruthSection'

export interface ReviewPanelProps {
  subject: ReviewSubject
  className?: string
  autosaveDelayMs?: number
  onSubmitted?: (record: ReviewRecord) => void
  onNext?: (persistCurrent: ReviewNavigationGuard) => void | Promise<void>
  onPrev?: (persistCurrent: ReviewNavigationGuard) => void | Promise<void>
  onNavigationGuardChange?: (guard: ReviewNavigationGuard | null) => void
  /** Keep hook/form state alive while hiding all review evidence during a pending URL transition. */
  suspended?: boolean
  /** Historical root-cause tags (e.g. aggregated from the loaded queue) for completion. */
  rootCauseTagSuggestions?: readonly string[]
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

function errorMessage(value: unknown): string | null {
  return value instanceof Error ? value.message : value ? String(value) : null
}

function DetailsSection({
  title,
  count,
  children,
  tone = 'default',
  onToggle,
}: {
  title: string
  count?: number
  children: ReactNode
  tone?: 'default' | 'warning'
  onToggle?: (open: boolean) => void
}) {
  return (
    <details
      className={`rounded-lg border p-3 ${
        tone === 'warning' ? 'border-amber-300 bg-amber-50' : 'border-slate-200'
      }`}
      onToggle={(event) => onToggle?.((event.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer text-sm font-semibold text-slate-800">
        {title}
        {count !== undefined ? (
          <span className="ml-1.5 text-xs text-slate-500">({count})</span>
        ) : null}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  )
}

export function ReviewPanel({
  subject,
  className = '',
  autosaveDelayMs = 800,
  onSubmitted,
  onNext,
  onPrev,
  onNavigationGuardChange,
  suspended = false,
  rootCauseTagSuggestions = [],
}: ReviewPanelProps) {
  const workspaceQuery = useReviewWorkspace(subject)
  const saveDraft = useSaveReviewDraft()
  const submitReview = useSubmitReview()
  const [payload, setPayload] = useState<ReviewPayload | null>(null)
  const [dirty, setDirty] = useState(false)
  const [submitted, setSubmitted] = useState<ReviewRecord | null>(null)
  const [editingRevision, setEditingRevision] = useState(false)
  const [revealedAutomatic, setRevealedAutomatic] = useState<ReviewWorkspaceResponse['automatic']>()
  const [focusedFailureId, setFocusedFailureId] = useState<string | null>(null)
  // C/X must only mutate a failure the reviewer can SEE: the accordion renders
  // collapsed by default, and a shortcut against an invisible finding would be
  // silently persisted by autosave.
  const [failuresSectionOpen, setFailuresSectionOpen] = useState(false)
  const panelRef = useRef<HTMLElement | null>(null)
  const [focusedDimensionId, setFocusedDimensionId] = useState<string | null>(null)
  const [evidenceHint, setEvidenceHint] = useState<string | null>(null)
  const loadedSubject = useRef<string | null>(null)
  const editVersion = useRef(0)
  const navInFlight = useRef(false)
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
    setFocusedDimensionId(null)
    setEvidenceHint(null)
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

  useEffect(() => {
    if (!evidenceHint) return
    const timer = window.setTimeout(() => setEvidenceHint(null), 4000)
    return () => window.clearTimeout(timer)
  }, [evidenceHint])

  const saveCurrent = useCallback(async (): Promise<boolean> => {
    // A save racing an in-flight submit would land after the final lock and
    // surface a spurious 423 over the success state (same class the autosave
    // timer already guards against).
    if (!payload || locked || submitInFlight.current) return false
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
    const finalPayload = finalizeReviewPayload(payload)
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

  const navigate = useCallback(
    async (handler?: (persistCurrent: ReviewNavigationGuard) => void | Promise<void>) => {
      if (!handler || navInFlight.current) return
      navInFlight.current = true
      try {
        await handler(persistCurrent)
      } finally {
        navInFlight.current = false
      }
    },
    [persistCurrent],
  )
  const goNext = useCallback(() => navigate(onNext), [navigate, onNext])
  const goPrev = useCallback(() => navigate(onPrev), [navigate, onPrev])

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
      if (shortcut === 'prev' && onPrev) {
        event.preventDefault()
        void goPrev()
        return
      }
      if (!payload || locked) return
      if (shortcut === 'save' || shortcut === 'submit') {
        // The chord exemption lets Cmd+S/Cmd+Enter fire while typing in the
        // panel's own note fields — but a chord from an editable control
        // elsewhere on the page (queue search, filters popover) must not
        // save/lock the open review.
        if (isReviewEditingTarget(event.target)) {
          const target = event.target instanceof Node ? event.target : null
          if (!target || !panelRef.current?.contains(target)) return
        }
        event.preventDefault()
        if (shortcut === 'save') void saveCurrent()
        else void submitCurrent()
        return
      }
      if (
        shortcut === 'overall-pass' ||
        shortcut === 'overall-fail' ||
        shortcut === 'overall-unsure'
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
        return
      }
      if (
        (shortcut === 'failure-confirm' || shortcut === 'failure-reject') &&
        failuresSectionOpen &&
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
    failuresSectionOpen,
    focusedFailureId,
    goNext,
    goPrev,
    locked,
    onNext,
    onPrev,
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

  const focusedDimension = focusedDimensionId
    ? (rubricDefinitions.find((definition) => definition.dimensionId === focusedDimensionId) ??
      null)
    : null
  const focusedEvidenceIds = useMemo(() => {
    const review = payload?.rubricReviews.find((item) => item.dimensionId === focusedDimensionId)
    return new Set(review?.evidenceMessageIds ?? [])
  }, [focusedDimensionId, payload?.rubricReviews])
  const evidenceBadges = useMemo(() => {
    if (!payload) return new Map<string, string[]>()
    const labelOf = new Map(
      rubricDefinitions.map((definition) => [definition.dimensionId, definition.label]),
    )
    const byMessage = evidenceDimensionsByMessage(payload)
    return new Map(
      [...byMessage.entries()].map(([messageId, dimensionIds]) => [
        messageId,
        dimensionIds.map((dimensionId) => labelOf.get(dimensionId) ?? dimensionId),
      ]),
    )
  }, [payload, rubricDefinitions])

  const toggleEvidence = useCallback(
    (messageId: string) => {
      if (locked || !payload) return
      if (
        !focusedDimensionId ||
        !payload.rubricReviews.some((item) => item.dimensionId === focusedDimensionId)
      ) {
        setEvidenceHint(
          'Pick a rubric dimension first (Details → Rubric dimensions), then click messages to attach evidence.',
        )
        return
      }
      update((previous) => toggleEvidenceMessageId(previous, focusedDimensionId, messageId))
    },
    [focusedDimensionId, locked, payload, update],
  )

  const patchAnnotation = useCallback(
    (annotationId: string, patch: Partial<Omit<TurnAnnotation, 'annotationId'>>) => {
      update((previous) => ({
        ...previous,
        turnAnnotations: previous.turnAnnotations.map((item) =>
          item.annotationId === annotationId ? { ...item, ...patch } : item,
        ),
      }))
    },
    [update],
  )

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
  const transcript = workspaceQuery.data?.trace.transcript ?? []

  return (
    <aside
      ref={panelRef}
      className={`space-y-5 rounded-xl border border-slate-200 bg-white p-4 ${className}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Human review</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {subject.annotator} · {subject.rubricVersion} · revision{' '}
            {editingRevision ? nextRevision : (latestFinal?.revision ?? nextRevision)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              subject.mode === 'calibration'
                ? 'bg-violet-100 text-violet-700'
                : 'bg-blue-100 text-blue-700'
            }`}
          >
            {subject.mode === 'calibration' ? 'Calibration' : 'Assisted'}
          </span>
          <ReviewShortcutsHelp hasAutomaticFailures={Boolean(automatic?.failures?.length)} />
        </div>
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

      <ReviewFastPath
        verdict={payload.overallVerdict}
        note={payload.note}
        locked={locked}
        dirty={dirty}
        saving={saveDraft.isPending}
        submitting={submitReview.isPending}
        errorText={mutationError}
        canStartRevision={locked && subject.mode === 'assisted'}
        nextRevision={nextRevision}
        onVerdict={(verdict) => update((previous) => ({ ...previous, overallVerdict: verdict }))}
        onNote={(note) => update((previous) => ({ ...previous, note }))}
        onSave={() => void saveCurrent()}
        onSubmit={() => void submitCurrent()}
        onStartRevision={() => {
          setEditingRevision(true)
          setPayload((previous) =>
            previous ? { ...previous, reviewStatus: 'in_review' } : previous,
          )
        }}
        onPrev={onPrev ? () => void goPrev() : undefined}
        onNext={onNext ? () => void goNext() : undefined}
      />

      <ReviewTranscriptSection
        messages={transcript}
        locked={locked}
        focusedDimensionLabel={focusedDimension?.label ?? null}
        selectedIds={focusedEvidenceIds}
        evidenceBadges={evidenceBadges}
        hint={evidenceHint}
        onToggle={toggleEvidence}
      />

      <section aria-label="Review details" className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-800">Details</h3>
        <DetailsSection title="Status & tags">
          <ReviewStatusSection
            reviewStatus={payload.reviewStatus}
            priority={payload.priority}
            rootCauseTags={payload.rootCauseTags}
            tagSuggestions={rootCauseTagSuggestions}
            locked={locked}
            onStatus={(reviewStatus) => update((previous) => ({ ...previous, reviewStatus }))}
            onPriority={(priority) => update((previous) => ({ ...previous, priority }))}
            onTags={(rootCauseTags) => update((previous) => ({ ...previous, rootCauseTags }))}
          />
        </DetailsSection>

        <DetailsSection title="Rubric dimensions" count={rubricDefinitions.length}>
          <ReviewRubricSection
            definitions={rubricDefinitions}
            reviews={payload.rubricReviews}
            locked={locked}
            hasDefinedRubric={hasDefinedRubric}
            focusedDimensionId={focusedDimensionId}
            onFocusDimension={setFocusedDimensionId}
            onMutate={mutateRubric}
            onAddDimension={(dimensionId) =>
              update((previous) => ({
                ...previous,
                rubricReviews: [
                  ...previous.rubricReviews,
                  { dimensionId, verdict: 'skip', critique: '', evidenceMessageIds: [] },
                ],
              }))
            }
          />
        </DetailsSection>

        {automatic?.failures?.length ? (
          <DetailsSection
            title="Automatic failures"
            count={automatic.failures.length}
            onToggle={setFailuresSectionOpen}
          >
            <ReviewFailureSection
              failures={automatic.failures}
              reviews={payload.failureReviews}
              locked={locked}
              focusedFailureId={focusedFailureId}
              onFocusFailure={setFocusedFailureId}
              onDecide={decideFailure}
              onNote={(failureId, note) =>
                update((previous) => ({
                  ...previous,
                  failureReviews: previous.failureReviews.map((item) =>
                    item.failureId === failureId ? { ...item, note } : item,
                  ),
                }))
              }
            />
          </DetailsSection>
        ) : null}

        <DetailsSection title="Turn annotations" count={payload.turnAnnotations.length}>
          <ReviewTurnAnnotationsSection
            annotations={payload.turnAnnotations}
            transcript={transcript}
            locked={locked}
            onAdd={() => {
              const firstMessage = transcript[0]
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
            onChange={patchAnnotation}
            onRemove={(annotationId) =>
              update((previous) => ({
                ...previous,
                turnAnnotations: previous.turnAnnotations.filter(
                  (item) => item.annotationId !== annotationId,
                ),
              }))
            }
          />
        </DetailsSection>

        {groundTruth !== undefined && groundTruthView !== undefined ? (
          <DetailsSection
            title="Ground truth"
            tone={
              groundTruthView.kind === 'unavailable' || groundTruthView.kind === 'reference'
                ? 'warning'
                : 'default'
            }
          >
            <ReviewGroundTruthSection groundTruth={groundTruth} presentation={groundTruthView} />
          </DetailsSection>
        ) : null}

        {automatic ? (
          <DetailsSection title="Automatic evaluation">
            <ReviewAutomaticSection automatic={automatic} />
          </DetailsSection>
        ) : null}
      </section>
    </aside>
  )
}
