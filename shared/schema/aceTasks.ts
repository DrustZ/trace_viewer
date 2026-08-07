/**
 * Read-only ACE task-card contract exposed by the local Cockpit.
 *
 * `null` means the source card did not provide a usable value. An empty array
 * means the field was present and deliberately declared no requirements. This
 * distinction keeps the explorer from inventing task goals or constraints.
 */

export interface AceTaskSource {
  /** Scenario pack name without the .json suffix. */
  pack: string
  /** Project-relative, never absolute, source path. */
  file: string
  /** SHA-256 of the complete source pack in the current worktree. */
  fileDigest?: string
}

export type AceTaskObservedStatus =
  | 'not_run'
  | 'in_progress'
  | 'needs_attention'
  | 'all_pass'
  | 'ungraded'

export interface AceTaskOutcomeCounts {
  pass: number
  fail: number
  invalid: number
  runtime_error: number
  ungraded: number
}

export interface AceTaskLifecycleCounts {
  completed: number
  failed: number
  executing: number
  cancelled: number
  unknown: number
}

/**
 * Definition provenance for observed traces. A trace is only considered
 * definition-authoritative when it carries its own sidecar/manifest snapshot.
 */
export interface AceTaskTraceDefinitionProvenance {
  matchingCurrentDefinition: number
  historicalDefinition: number
  unavailable: number
}

export interface AceTaskStatusSummary {
  status: AceTaskObservedStatus
  outcomes: AceTaskOutcomeCounts
  lifecycle: AceTaskLifecycleCounts
  /** pass + fail. Invalid/user-sim and runtime errors never enter this denominator. */
  scoredDenominator: number
  passRate: number | null
  latestTraceAt: string | null
  definitionProvenance: AceTaskTraceDefinitionProvenance
}

export interface AceTaskRunCoverage {
  runId: string
  traceCount: number
  status: AceTaskStatusSummary
}

export interface AceTaskObservedCheck {
  name: string
  gating: boolean
}

/** The grading contract actually serialized into one or more historical traces. */
export interface AceTaskObservedScoringContract {
  fingerprint: string
  checks: AceTaskObservedCheck[]
  traceCount: number
  runIds: string[]
  outcomes: AceTaskOutcomeCounts
  latestTraceAt: string | null
  /** Shape only: names + gating flags; this cannot prove grader implementation semantics. */
  matchesCurrentCheckShape: boolean | null
}

export interface AceTaskPersona {
  issue: string | null
  language: string | null
  idKnowledge: string | null
  patience: number | null
  persistence: string | null
  style: string[] | null
  orderId: string | null
  goal: string | null
  adversarial: boolean | null
}

export interface AceTaskTraceCoverage {
  /** Explicitly scored simulation traces, plus corpus-less legacy fixtures. */
  traceCount: number
  /** Traces rejected by formal eligibility, including exploratory/synthetic/missing provenance. */
  exploratoryTraceCount: number
  runCount: number
  runIds: string[]
  /** Unique matched-seed pair keys represented in at least two runs. */
  matchedPairCount: number
  /** Suggested pair for a direct Compare deep link, when one exists. */
  compareRunIds: [string, string] | null
  status?: AceTaskStatusSummary
}

export interface AceTaskEffectiveCheck {
  name: string
  sourceSymbol: string
  purpose: string
  gatingRule: string
  /** Resolved for this task in a normal ACE scored run with an initial-world fixture. */
  effectiveGating: boolean
  basis: string
}

/**
 * Whether current-worktree semantics were actually executed by the fixed ACE
 * Python probe. Merely finding/reading a .py file is never "verified".
 */
export interface AceTaskPythonAuthority {
  status: 'verified' | 'unavailable' | 'mismatch'
  method: 'fixed_python_runtime_probe'
  reason?:
    | 'python_probe_failed'
    | 'source_digest_mismatch'
    | 'scenario_rejected'
    | 'scenario_output_missing'
    | 'scenario_identity_mismatch'
}

export interface AceTaskVariant {
  definitionDigest: string
  sources: AceTaskSource[]
  suite: string | null
  journeyId: string | null
  journeyStep: number | null
  /** Derived by the current Python `Scenario.journey_key` contract when verified. */
  journeyKey?: string
  /** Derived by executing the current Python `Database.split_of` contract. */
  split?: 'dev' | 'calibration' | 'holdout' | null
  /** Per-definition execution/provenance status for split and effective checks. */
  pythonAuthority?: AceTaskPythonAuthority
  persona: AceTaskPersona
  /** Persona-authored user goal. It is not a trace/evaluation verdict. */
  taskBrief: string | null
  expectedActions: Record<string, unknown>[] | null
  forbiddenActions: string[] | null
  expectedOutcome: string | null
  rewardBasis: string[] | null
  authorizedEffects: Record<string, unknown>[] | null
  requiredInfo: Record<string, unknown>[] | null
  expectedStateDelta: Record<string, unknown>[] | null
  mustPrecede: unknown[][] | null
  consentRequired: boolean | null
  promiseCheck: boolean | null
  userScript: string[] | null
  /** Python-probed current-worktree semantics, never inferred from copied TS rules. */
  effectiveChecks?: AceTaskEffectiveCheck[]
}

export interface AceTaskSummary {
  scenarioId: string
  suite: string | null
  journeyId: string | null
  journeyStep: number | null
  issue: string | null
  language: string | null
  personaKey: string
  taskBrief: string | null
  sourcePacks: string[]
  sourceFiles: string[]
  /** True only if the same scenario id has non-identical source definitions. */
  conflict: boolean
  traceCoverage: AceTaskTraceCoverage
}

export interface AceTaskDetail extends AceTaskSummary {
  /** One variant normally; multiple variants make source disagreement explicit. */
  variants: AceTaskVariant[]
  runCoverage?: AceTaskRunCoverage[]
  observedScoringContracts?: AceTaskObservedScoringContract[]
}

export interface AceTaskFacets {
  suites: string[]
  issues: string[]
  languages: string[]
  journeys: string[]
  personas: string[]
  sourcePacks: string[]
}

export interface AceTaskCatalogSource {
  project: 'ACE'
  directory: 'configs/scenarios'
  schemaContract: 'src/ace/evaluation/scenarios.py::Scenario'
  readOnly: true
  authority?: 'current_worktree_catalog'
  /** Digest over every current scenario definition and source-pack digest. */
  catalogDigest?: string
  /** Historical trace definitions are authoritative only through their own snapshot. */
  traceDefinitionAuthority?: 'trace_bound_snapshot_only'
  splitContract?: 'src/ace/simulation/environment/database.py::Database.split_of'
}

export interface AceTaskScoringArtifact {
  file: string
  digest: string | null
  available: boolean
  authority?: AceTaskPythonAuthority
}

export interface AceTaskRubricArtifact extends AceTaskScoringArtifact {
  kind: 'judge' | 'semantic'
  gating: false
  content: string
}

export interface AceTaskScoringContract {
  primaryGrader: AceTaskScoringArtifact & {
    symbol: 'src/ace/evaluation/grading/atomic.py::grade_atomic'
    gating: true
  }
  splitResolver: AceTaskScoringArtifact & {
    symbol: 'src/ace/simulation/environment/database.py::Database.split_of'
    sourceContract: string | null
  }
  verdictFormula: string
  primaryBoundary: 'episode'
  botBoundaryAvailable: true
  invalidUserSimPolicy: string
  /** Docstrings read from the current grader source, not a historical trace. */
  sourceContract: string | null
  shadowRubrics: AceTaskRubricArtifact[]
}

export interface AceTasksResponse {
  total: number
  filteredTotal: number
  items: AceTaskSummary[]
  facets: AceTaskFacets
  source: AceTaskCatalogSource
}

export interface AceTaskQuery {
  q?: string
  id?: string
  suite?: string
  issue?: string
  language?: string
  journey?: string
  persona?: string
  sourcePack?: string
}
