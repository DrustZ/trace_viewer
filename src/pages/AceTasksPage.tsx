import { encodeFilterSet } from '@shared/filter/parse'
import type {
  AceTaskObservedScoringContract,
  AceTaskOutcomeCounts,
  AceTaskQuery,
  AceTaskRunCoverage,
  AceTaskScoringContract,
  AceTaskStatusSummary,
  AceTaskVariant,
} from '@shared/schema/aceTasks'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useAceTask, useAceTasks } from '../api/aceTasks'
import { EmptyState, LoadingState } from '../components/common/EmptyState'

const INPUT =
  'w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-400'

const FILTER_KEYS = [
  'q',
  'id',
  'suite',
  'issue',
  'language',
  'journey',
  'persona',
  'sourcePack',
] as const

type FilterKey = (typeof FILTER_KEYS)[number]

function field(search: URLSearchParams, key: FilterKey): string {
  return search.get(key) ?? ''
}

function filtersOf(search: URLSearchParams): AceTaskQuery {
  return Object.fromEntries(
    FILTER_KEYS.map((key) => [key, field(search, key) || undefined]),
  ) as AceTaskQuery
}

export function taskTraceHref(scenarioId: string): string {
  const filters = encodeFilterSet({
    conditions: [{ key: 'instanceId', op: 'eq', value: scenarioId }],
  })
  return `/?${new URLSearchParams({ filters }).toString()}`
}

export function taskRunHref(scenarioId: string, runId: string): string {
  const filters = encodeFilterSet({
    conditions: [
      { key: 'instanceId', op: 'eq', value: scenarioId },
      { key: 'run', op: 'eq', value: runId },
    ],
  })
  return `/?${new URLSearchParams({ filters }).toString()}`
}

export function taskCompareHref(
  scenarioId: string,
  compareRunIds: [string, string] | null,
): string | null {
  if (!compareRunIds) return null
  return `/compare?${new URLSearchParams({
    instance: scenarioId,
    runA: compareRunIds[0],
    runB: compareRunIds[1],
  }).toString()}`
}

export function taskExperimentHref(scenarioId: string, sourceFile: string): string | null {
  const match = /^configs\/scenarios\/([A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json)$/.exec(sourceFile)
  const scenarioFile = match?.[1]
  if (!scenarioFile) return null
  return `/ace/experiments?${new URLSearchParams({ scenarioFile, scenarioId }).toString()}`
}

export function taskLabHref(scenarioId: string, sourceFile: string): string | null {
  const match = /^configs\/scenarios\/([A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json)$/.exec(sourceFile)
  const scenarioFile = match?.[1]
  if (!scenarioFile) return null
  return `/ace/lab?${new URLSearchParams({ scenarioFile, scenarioId }).toString()}`
}

function UnknownValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === '') {
    return <span className="italic text-slate-400">Not set in source</span>
  }
  if (typeof value === 'boolean') return <>{value ? 'Yes' : 'No'}</>
  return <>{String(value)}</>
}

function Field({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 break-words text-xs text-slate-700">
        <UnknownValue value={value} />
      </dd>
    </div>
  )
}

const STATUS_STYLE: Record<AceTaskStatusSummary['status'], string> = {
  not_run: 'bg-slate-100 text-slate-600',
  in_progress: 'bg-blue-50 text-blue-700',
  needs_attention: 'bg-red-50 text-red-700',
  all_pass: 'bg-emerald-50 text-emerald-700',
  ungraded: 'bg-amber-50 text-amber-700',
}

const EMPTY_TASK_STATUS: AceTaskStatusSummary = {
  status: 'not_run',
  outcomes: { pass: 0, fail: 0, invalid: 0, runtime_error: 0, ungraded: 0 },
  lifecycle: { completed: 0, failed: 0, executing: 0, cancelled: 0, unknown: 0 },
  scoredDenominator: 0,
  passRate: null,
  latestTraceAt: null,
  definitionProvenance: {
    matchingCurrentDefinition: 0,
    historicalDefinition: 0,
    unavailable: 0,
  },
}

function taskStatus(status: AceTaskStatusSummary | undefined): AceTaskStatusSummary {
  return status ?? EMPTY_TASK_STATUS
}

const STATUS_LABEL: Record<AceTaskStatusSummary['status'], string> = {
  not_run: 'Not run',
  in_progress: 'In progress',
  needs_attention: 'Needs attention',
  all_pass: 'All scored traces pass',
  ungraded: 'Ungraded',
}

function StatusBadge({ status }: { status: AceTaskStatusSummary['status'] }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  )
}

function OutcomeCounts({ counts }: { counts: AceTaskOutcomeCounts }) {
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] tabular-nums text-slate-600">
      <span className="text-emerald-700">P {counts.pass}</span>
      <span className="text-red-700">F {counts.fail}</span>
      <span className="text-amber-700">Invalid {counts.invalid}</span>
      <span className="text-rose-700">Runtime {counts.runtime_error}</span>
      <span>Ungraded {counts.ungraded}</span>
    </span>
  )
}

function Digest({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="italic text-slate-400">Unavailable</span>
  return (
    <span title={value} className="font-mono">
      {value.slice(0, 16)}
    </span>
  )
}

function StructuredList({ title, values }: { title: string; values: unknown[] | null }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3">
      <h3 className="text-xs font-semibold text-slate-800">{title}</h3>
      {values === null ? (
        <p className="mt-2 text-xs italic text-slate-400">Unavailable in source.</p>
      ) : values.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">None declared.</p>
      ) : (
        <ol className="mt-2 space-y-2">
          {values.map((value) => (
            <li
              key={`${title}:${JSON.stringify(value)}`}
              className="rounded bg-slate-50 px-2 py-1.5"
            >
              {typeof value === 'string' ? (
                <span className="text-xs text-slate-700">{value}</span>
              ) : (
                <pre className="overflow-x-auto whitespace-pre-wrap text-[11px] leading-4 text-slate-700">
                  {JSON.stringify(value, null, 2)}
                </pre>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function authorityLabel(status: 'verified' | 'unavailable' | 'mismatch'): string {
  if (status === 'verified') return 'ACE Python runtime verified'
  if (status === 'mismatch') return 'Source changed during verification'
  return 'Python scoring semantics unavailable'
}

export function ScoringAuthority({ scoring }: { scoring: AceTaskScoringContract }) {
  const status = scoring.primaryGrader.authority?.status ?? 'unavailable'
  const verified = status === 'verified' && scoring.primaryGrader.available
  return (
    <section className="rounded-lg border border-violet-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold text-slate-900">How ACE scores this task</h3>
          <p className="mt-1 max-w-4xl text-[11px] leading-4 text-slate-600">
            {verified ? (
              <>
                {scoring.verdictFormula} The primary reported verdict is the{' '}
                <b>{scoring.primaryBoundary}</b> boundary; a separate bot-boundary verdict is also
                available on generated traces. {scoring.invalidUserSimPolicy} Runtime verification
                covers the effective check roles and split resolver; historical outcomes remain
                attached to their recorded trace contracts.
              </>
            ) : (
              <>
                Task cards remain available, but current effective checks and data splits are not
                inferred from copied TypeScript rules. Re-run the fixed local Python probe after the
                ACE worktree is loadable and stable.
              </>
            )}
          </p>
        </div>
        <span
          className={`rounded px-2 py-1 text-[10px] font-medium ${verified ? 'bg-emerald-50 text-emerald-700' : status === 'mismatch' ? 'bg-amber-100 text-amber-800' : 'bg-red-50 text-red-700'}`}
        >
          {authorityLabel(status)}
        </span>
      </div>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Primary grader" value={scoring.primaryGrader.symbol} />
        <Field label="Source file" value={scoring.primaryGrader.file} />
        <Field
          label="Source SHA-256"
          value={scoring.primaryGrader.digest ? scoring.primaryGrader.digest.slice(0, 16) : null}
        />
        <Field label="Split resolver" value={scoring.splitResolver.symbol} />
      </dl>
      {scoring.sourceContract && (
        <details className="mt-3 rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
          <summary className="cursor-pointer text-[11px] font-medium text-slate-700">
            Exact scoring contract docstrings from current source
          </summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[10px] leading-4 text-slate-600">
            {scoring.sourceContract}
          </pre>
        </details>
      )}
      <div className="mt-3">
        <h4 className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
          Shadow rubrics (never change primary reward)
        </h4>
        {scoring.shadowRubrics.length === 0 ? (
          <p className="mt-1 text-[11px] italic text-slate-400">No rubric files available.</p>
        ) : (
          <div className="mt-1.5 space-y-1.5">
            {scoring.shadowRubrics.map((rubric) => (
              <details key={rubric.file} className="rounded border border-slate-200 px-2 py-1.5">
                <summary className="cursor-pointer text-[11px] text-slate-700">
                  <span className="font-mono">{rubric.file}</span>
                  <span className="ml-2 rounded bg-slate-100 px-1 py-0.5 text-[9px] uppercase text-slate-500">
                    {rubric.kind} · non-gating
                  </span>
                  <span className="ml-2 text-[9px] text-slate-400">
                    sha256 {rubric.digest?.slice(0, 16)}
                  </span>
                </summary>
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap bg-slate-50 p-2 text-[10px] leading-4 text-slate-600">
                  {rubric.content}
                </pre>
              </details>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function RunCoverage({ scenarioId, runs }: { scenarioId: string; runs: AceTaskRunCoverage[] }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3">
      <h3 className="text-xs font-semibold text-slate-900">Observed run coverage</h3>
      <p className="mt-1 text-[11px] text-slate-500">
        Status comes from each trace's recorded evaluation. It is not recomputed using the current
        task definition.
      </p>
      {runs.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">
          This current task has no loaded simulation traces.
        </p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded border border-slate-100">
          <table className="min-w-full text-left text-[11px]">
            <thead className="border-b border-slate-100 text-[9px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-2 py-1.5">Run</th>
                <th className="px-2 py-1.5">Status</th>
                <th className="px-2 py-1.5">Recorded outcomes</th>
                <th className="px-2 py-1.5">Definition provenance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {runs.map((run) => (
                <tr key={run.runId}>
                  <td className="px-2 py-2">
                    <Link
                      className="font-mono text-blue-700 hover:underline"
                      to={taskRunHref(scenarioId, run.runId)}
                    >
                      {run.runId}
                    </Link>
                    <div className="mt-0.5 text-[9px] text-slate-400">
                      {run.traceCount} trace{run.traceCount === 1 ? '' : 's'}
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <StatusBadge status={run.status.status} />
                    <div className="mt-1 text-[9px] text-slate-400">
                      scored denominator {run.status.scoredDenominator}
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <OutcomeCounts counts={run.status.outcomes} />
                  </td>
                  <td className="px-2 py-2 text-[10px] text-slate-600">
                    <div>
                      current-match {run.status.definitionProvenance.matchingCurrentDefinition}
                    </div>
                    <div>historical {run.status.definitionProvenance.historicalDefinition}</div>
                    <div>unavailable {run.status.definitionProvenance.unavailable}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function ObservedContracts({ contracts }: { contracts: AceTaskObservedScoringContract[] }) {
  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50/30 p-3">
      <h3 className="text-xs font-semibold text-amber-950">Recorded historical check contracts</h3>
      <p className="mt-1 text-[11px] text-amber-800">
        These fingerprints come only from check names and gating flags stored in traces. A mismatch
        is evidence of grader drift; the cockpit does not retroactively relabel the result.
      </p>
      {contracts.length === 0 ? (
        <p className="mt-2 text-xs italic text-slate-500">
          No trace has a recorded grade-check payload.
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          {contracts.map((contract) => (
            <details
              key={contract.fingerprint}
              className="rounded border border-amber-100 bg-white p-2"
            >
              <summary className="cursor-pointer text-[11px] text-slate-700">
                <span className="font-mono font-medium">{contract.fingerprint}</span>
                <span className="ml-2">{contract.traceCount} traces</span>
                <span
                  className={`ml-2 rounded px-1 py-0.5 text-[9px] ${contract.matchesCurrentCheckSemantics === true ? 'bg-emerald-50 text-emerald-700' : contract.matchesCurrentCheckSemantics === false ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500'}`}
                >
                  {contract.matchesCurrentCheckSemantics === true
                    ? 'matches current checks'
                    : contract.matchesCurrentCheckSemantics === false
                      ? 'differs from current checks'
                      : 'current semantics unavailable'}
                </span>
              </summary>
              <div className="mt-2 flex flex-wrap gap-1">
                {contract.checks.map((check) => (
                  <span
                    key={`${check.name}:${check.gating}`}
                    className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${check.gating ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'}`}
                  >
                    {check.name}:{check.gating ? 'gate' : 'shadow'}
                  </span>
                ))}
              </div>
              <div className="mt-2">
                <OutcomeCounts counts={contract.outcomes} />
              </div>
              <p className="mt-1 text-[9px] text-slate-400">Runs: {contract.runIds.join(', ')}</p>
            </details>
          ))}
        </div>
      )}
    </section>
  )
}

export function Variant({ variant, index }: { variant: AceTaskVariant; index: number }) {
  const authorityStatus = variant.pythonAuthority?.status ?? 'unavailable'
  const semanticsVerified = authorityStatus === 'verified'
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-900">
          {index === 0 ? 'Task definition' : `Conflicting definition ${index + 1}`}
        </h2>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
          {variant.definitionDigest}
        </span>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-3">
        <h3 className="text-xs font-semibold text-slate-800">User and task brief</h3>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-5 text-slate-700">
          {variant.taskBrief ?? <i className="text-slate-400">Not set in source</i>}
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
          <Field label="Issue" value={variant.persona.issue} />
          <Field label="Language" value={variant.persona.language} />
          <Field label="ID knowledge" value={variant.persona.idKnowledge} />
          <Field label="Patience" value={variant.persona.patience} />
          <Field label="Persistence" value={variant.persona.persistence} />
          <Field
            label="Style"
            value={
              variant.persona.style === null
                ? null
                : variant.persona.style.length > 0
                  ? variant.persona.style.join(', ')
                  : 'Neutral / no style tags'
            }
          />
          <Field label="Grounding order" value={variant.persona.orderId} />
          <Field label="Adversarial" value={variant.persona.adversarial} />
          <Field
            label="Data split"
            value={semanticsVerified ? variant.split : 'Unavailable — Python probe not verified'}
          />
          <Field
            label="Journey key"
            value={
              semanticsVerified
                ? (variant.journeyKey ?? variant.journeyId)
                : 'Unavailable — Python probe not verified'
            }
          />
          <Field label="Derived semantics" value={authorityLabel(authorityStatus)} />
        </dl>
      </section>

      <section className="rounded-lg border border-blue-200 bg-blue-50/40 p-3">
        <h3 className="text-xs font-semibold text-blue-900">Evaluation contract</h3>
        <p className="mt-1 text-[11px] text-blue-700">
          These are task-card expectations, not observed model results or automatic verdicts.
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
          <Field label="Suite" value={variant.suite} />
          <Field label="Expected outcome" value={variant.expectedOutcome} />
          <Field label="Consent required" value={variant.consentRequired} />
          <Field label="Promise hard gate" value={variant.promiseCheck} />
          <Field label="Journey ID" value={variant.journeyId} />
          <Field label="Journey step" value={variant.journeyStep} />
          <Field
            label="Reward basis"
            value={
              variant.rewardBasis?.join(', ') || (variant.rewardBasis === null ? null : 'None')
            }
          />
        </dl>
      </section>

      <section
        className={`rounded-lg border p-3 ${semanticsVerified ? 'border-violet-200 bg-violet-50/30' : 'border-amber-200 bg-amber-50/40'}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold text-violet-950">
              Current effective grade checks
            </h3>
            <p className="mt-1 text-[11px] text-violet-700">
              {semanticsVerified
                ? 'Executed by the fixed local Python probe for this exact current task definition and a fixture-backed scored run. Historical traces retain their own recorded check contract below.'
                : 'Unavailable for this definition. The cockpit intentionally does not substitute hand-copied TypeScript grading rules.'}
            </p>
          </div>
          <span
            className={`rounded px-2 py-1 text-[10px] ${semanticsVerified ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}
          >
            {authorityLabel(authorityStatus)}
          </span>
        </div>
        {semanticsVerified ? (
          <div className="mt-3 overflow-x-auto rounded border border-violet-100 bg-white">
            <table className="min-w-full text-left text-[11px]">
              <thead className="border-b border-violet-100 text-[9px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-2 py-1.5">Check</th>
                  <th className="px-2 py-1.5">Role now</th>
                  <th className="px-2 py-1.5">What it checks</th>
                  <th className="px-2 py-1.5">Why</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(variant.effectiveChecks ?? []).map((check) => (
                  <tr key={check.name}>
                    <td className="whitespace-nowrap px-2 py-2 align-top">
                      <div className="font-mono font-semibold text-slate-800">{check.name}</div>
                      <div className="mt-0.5 font-mono text-[9px] text-slate-400">
                        {check.sourceSymbol}
                      </div>
                    </td>
                    <td className="px-2 py-2 align-top">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${check.effectiveGating ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'}`}
                      >
                        {check.effectiveGating ? 'GATING' : 'SHADOW'}
                      </span>
                    </td>
                    <td className="max-w-sm px-2 py-2 align-top text-slate-600">{check.purpose}</td>
                    <td className="max-w-sm px-2 py-2 align-top text-slate-600">
                      <div>{check.basis}</div>
                      <div className="mt-1 text-[10px] text-slate-400">{check.gatingRule}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 rounded border border-amber-200 bg-white px-2 py-2 text-[11px] text-amber-800">
            No current check roles or split are asserted. Reason:{' '}
            <span className="font-mono">{variant.pythonAuthority?.reason ?? 'not_verified'}</span>.
          </p>
        )}
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <StructuredList title="Expected actions" values={variant.expectedActions} />
        <StructuredList title="Forbidden actions" values={variant.forbiddenActions} />
        <StructuredList title="Authorized effects" values={variant.authorizedEffects} />
        <StructuredList title="Required information" values={variant.requiredInfo} />
        <StructuredList title="Expected state delta" values={variant.expectedStateDelta} />
        <StructuredList title="Must precede" values={variant.mustPrecede} />
      </div>
      <StructuredList title="Deterministic user script" values={variant.userScript} />

      <section className="rounded-lg border border-slate-200 bg-white p-3">
        <h3 className="text-xs font-semibold text-slate-800">Source provenance</h3>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {variant.sources.map((source) => (
            <div
              key={source.file}
              className="rounded bg-slate-100 px-2 py-1 font-mono text-[10px] text-slate-600"
            >
              <div>{source.file}</div>
              <div className="mt-0.5 text-[9px] text-slate-400">
                file sha256 <Digest value={source.fileDigest} />
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-slate-500">
          Definition digest excludes the leakage canary. The canary itself is intentionally never
          rendered in the cockpit.
        </p>
      </section>
    </div>
  )
}

export default function AceTasksPage() {
  const { scenarioId: routedScenarioId } = useParams<{ scenarioId?: string }>()
  const [search, setSearch] = useSearchParams()
  const filters = filtersOf(search)
  const tasks = useAceTasks(filters)
  const selectedId = routedScenarioId ?? tasks.data?.items[0]?.scenarioId
  const task = useAceTask(selectedId)

  const setFilter = (key: FilterKey, value: string) => {
    setSearch(
      (previous) => {
        const next = new URLSearchParams(previous)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true },
    )
  }
  const reset = () =>
    setSearch(
      (previous) => {
        const next = new URLSearchParams(previous)
        for (const key of FILTER_KEYS) next.delete(key)
        return next
      },
      { replace: true },
    )

  const compareHref = task.data
    ? taskCompareHref(task.data.scenarioId, task.data.traceCoverage.compareRunIds)
    : null
  const experimentHref =
    task.data && !task.data.conflict
      ? taskExperimentHref(task.data.scenarioId, task.data.sourceFiles[0] ?? '')
      : null
  const labHref =
    task.data && !task.data.conflict
      ? taskLabHref(task.data.scenarioId, task.data.sourceFiles[0] ?? '')
      : null

  return (
    <div className="min-h-screen bg-slate-50 px-5 py-4">
      <div className="mx-auto max-w-[1500px] space-y-4">
        <header className="flex flex-wrap items-center gap-3">
          <Link to="/" className="text-xs text-blue-600 hover:underline">
            ← Traces
          </Link>
          <Link to="/ace" className="text-xs text-blue-600 hover:underline">
            ACE runs
          </Link>
          <Link to="/ace/experiments" className="text-xs text-blue-600 hover:underline">
            Experiment matrix
          </Link>
          <Link to="/reviews" className="text-xs text-blue-600 hover:underline">
            Human review
          </Link>
          <h1 className="text-base font-semibold text-slate-900">ACE task explorer</h1>
          <span className="rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
            Read only
          </span>
        </header>

        <section className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-48 flex-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
              Search goal / definition
              <input
                className={`${INPUT} mt-1`}
                value={field(search, 'q')}
                onChange={(event) => setFilter('q', event.target.value)}
                placeholder="goal, issue, persona…"
              />
            </label>
            <label className="w-44 text-[10px] font-medium uppercase tracking-wide text-slate-400">
              Task ID
              <input
                className={`${INPUT} mt-1`}
                value={field(search, 'id')}
                onChange={(event) => setFilter('id', event.target.value)}
                placeholder="s-refund-00"
              />
            </label>
            {(
              [
                ['suite', 'Suite', tasks.data?.facets.suites ?? []],
                ['issue', 'Issue', tasks.data?.facets.issues ?? []],
                ['language', 'Language', tasks.data?.facets.languages ?? []],
                ['sourcePack', 'Source pack', tasks.data?.facets.sourcePacks ?? []],
              ] as const
            ).map(([key, label, options]) => (
              <label
                key={key}
                className="w-36 text-[10px] font-medium uppercase tracking-wide text-slate-400"
              >
                {label}
                <select
                  className={`${INPUT} mt-1`}
                  value={field(search, key)}
                  onChange={(event) => setFilter(key, event.target.value)}
                >
                  <option value="">All</option>
                  {options.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              </label>
            ))}
            <label className="w-40 text-[10px] font-medium uppercase tracking-wide text-slate-400">
              Journey
              <select
                className={`${INPUT} mt-1`}
                value={field(search, 'journey')}
                onChange={(event) => setFilter('journey', event.target.value)}
              >
                <option value="">All</option>
                <option value="__standalone__">Standalone</option>
                {(tasks.data?.facets.journeys ?? []).map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </label>
            <label className="w-44 text-[10px] font-medium uppercase tracking-wide text-slate-400">
              Persona
              <input
                className={`${INPUT} mt-1`}
                value={field(search, 'persona')}
                onChange={(event) => setFilter('persona', event.target.value)}
                placeholder="partial, frustrated…"
              />
            </label>
            <button
              type="button"
              onClick={reset}
              className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
            >
              Clear
            </button>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            {tasks.data
              ? `${tasks.data.filteredTotal} of ${tasks.data.total} current-worktree task definitions · ${tasks.data.source.directory} · catalog sha256 ${tasks.data.source.catalogDigest?.slice(0, 16) ?? 'unavailable'} · ${tasks.data.source.schemaContract}`
              : 'Loading authoritative ACE scenario cards…'}
          </p>
          <p className="mt-1 text-[10px] text-slate-400">
            Current catalog files are authoritative for today's task definitions. Historical runs
            are authoritative only when their own trace-bound scenario snapshot is present.
          </p>
        </section>

        <div className="grid min-h-[70vh] gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-3 py-2 text-xs font-medium text-slate-700">
              Tasks
            </div>
            {tasks.isLoading ? (
              <LoadingState label="Loading task definitions…" />
            ) : tasks.isError ? (
              <EmptyState
                title="Task catalog unavailable"
                hint="Check the local ACE configs/scenarios directory."
              />
            ) : tasks.data?.items.length === 0 ? (
              <EmptyState title="No matching tasks" hint="Clear or broaden the filters above." />
            ) : (
              <div className="max-h-[75vh] divide-y divide-slate-100 overflow-y-auto">
                {tasks.data?.items.map((item) => (
                  <Link
                    key={item.scenarioId}
                    to={{
                      pathname: `/ace/tasks/${encodeURIComponent(item.scenarioId)}`,
                      search: search.toString(),
                    }}
                    className={`block px-3 py-2.5 hover:bg-slate-50 ${selectedId === item.scenarioId ? 'bg-blue-50/70' : ''}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate font-mono text-xs font-semibold text-slate-800">
                        {item.scenarioId}
                      </span>
                      {item.conflict && (
                        <span className="rounded bg-red-50 px-1 py-0.5 text-[9px] font-medium text-red-700">
                          source conflict
                        </span>
                      )}
                      <StatusBadge status={taskStatus(item.traceCoverage.status).status} />
                      <span className="ml-auto rounded bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-500">
                        {item.suite ?? 'suite unset'}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-600">
                      {item.taskBrief ?? 'No task brief in source'}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1 text-[9px] text-slate-500">
                      <span>{item.issue ?? 'issue unset'}</span>
                      <span>·</span>
                      <span>{item.language ?? 'language unset'}</span>
                      <span>·</span>
                      <span>{item.traceCoverage.traceCount} traces</span>
                      {item.traceCoverage.matchedPairCount > 0 && (
                        <span className="text-blue-600">
                          · {item.traceCoverage.matchedPairCount} matched seeds
                        </span>
                      )}
                    </div>
                    {item.traceCoverage.traceCount > 0 && (
                      <div className="mt-1">
                        <OutcomeCounts counts={taskStatus(item.traceCoverage.status).outcomes} />
                      </div>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </section>

          <main className="min-w-0 space-y-3">
            {!selectedId ? (
              <EmptyState title="Select a task" hint="Pick a task card from the list." />
            ) : task.isLoading ? (
              <LoadingState label="Loading task card…" />
            ) : task.isError || !task.data ? (
              <EmptyState title="Task unavailable" hint="The source definition may have moved." />
            ) : (
              <>
                <section className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-start gap-2">
                    <div>
                      <h2 className="font-mono text-sm font-semibold text-slate-900">
                        {task.data.scenarioId}
                      </h2>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {task.data.sourcePacks.join(', ')} · {task.data.traceCoverage.traceCount}{' '}
                        matching traces across {task.data.traceCoverage.runCount} runs
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <StatusBadge status={taskStatus(task.data.traceCoverage.status).status} />
                        <OutcomeCounts
                          counts={taskStatus(task.data.traceCoverage.status).outcomes}
                        />
                        <span className="text-[10px] text-slate-400">
                          pass rate{' '}
                          {taskStatus(task.data.traceCoverage.status).passRate === null
                            ? '—'
                            : `${((taskStatus(task.data.traceCoverage.status).passRate ?? 0) * 100).toFixed(1)}%`}{' '}
                          / denominator{' '}
                          {taskStatus(task.data.traceCoverage.status).scoredDenominator}
                        </span>
                      </div>
                    </div>
                    <div className="ml-auto flex flex-wrap gap-2">
                      {labHref && (
                        <Link
                          to={labHref}
                          className="rounded-md bg-violet-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-violet-700"
                        >
                          Open Interactive Lab
                        </Link>
                      )}
                      {experimentHref && (
                        <Link
                          to={experimentHref}
                          className="rounded-md border border-blue-200 px-2.5 py-1.5 text-xs text-blue-700 hover:bg-blue-50"
                        >
                          Create matched experiment
                        </Link>
                      )}
                      {task.data.traceCoverage.traceCount > 0 ? (
                        <Link
                          to={taskTraceHref(task.data.scenarioId)}
                          className="rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                        >
                          View matching traces
                        </Link>
                      ) : (
                        <span className="rounded-md bg-slate-100 px-2.5 py-1.5 text-xs text-slate-400">
                          No matching traces loaded
                        </span>
                      )}
                      {compareHref && (
                        <Link
                          to={compareHref}
                          className="rounded-md border border-blue-200 px-2.5 py-1.5 text-xs text-blue-700 hover:bg-blue-50"
                        >
                          Compare matched A/B
                        </Link>
                      )}
                    </div>
                  </div>
                  {task.data.conflict && (
                    <p className="mt-3 rounded bg-red-50 px-2 py-1.5 text-xs text-red-700">
                      This scenario ID has non-identical source definitions. No single goal is
                      selected silently; every variant is shown below.
                    </p>
                  )}
                  {task.data.traceCoverage.traceCount > 0 && (
                    <div className="mt-3 rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                      Trace definition provenance: current-definition match{' '}
                      {
                        taskStatus(task.data.traceCoverage.status).definitionProvenance
                          .matchingCurrentDefinition
                      }
                      , historical snapshot{' '}
                      {
                        taskStatus(task.data.traceCoverage.status).definitionProvenance
                          .historicalDefinition
                      }
                      , unavailable{' '}
                      {taskStatus(task.data.traceCoverage.status).definitionProvenance.unavailable}.
                      Outcomes above always remain attached to their recorded trace contract.
                    </div>
                  )}
                </section>
                {task.data.scoring && <ScoringAuthority scoring={task.data.scoring} />}
                {task.data.variants.map((variant, index) => (
                  <Variant key={variant.definitionDigest} variant={variant} index={index} />
                ))}
                <RunCoverage scenarioId={task.data.scenarioId} runs={task.data.runCoverage ?? []} />
                <ObservedContracts contracts={task.data.observedScoringContracts ?? []} />
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}
