import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  AceTaskDetail,
  AceTaskFacets,
  AceTaskObservedCheck,
  AceTaskObservedScoringContract,
  AceTaskOutcomeCounts,
  AceTaskPythonAuthority,
  AceTaskQuery,
  AceTaskRunCoverage,
  AceTaskScoringContract,
  AceTaskSource,
  AceTaskStatusSummary,
  AceTaskSummary,
  AceTaskTraceCoverage,
  AceTaskVariant,
} from '../../shared/schema/aceTasks'
import type { TraceOutcome, TraceSummary } from '../../shared/schema/types'
import { isFormalMetricsTrace } from './formalMetrics'
import {
  type AceTaskScoringExporter,
  type AceTaskScoringProbeInput,
  type AceTaskScoringProbeScenario,
  runAceTaskScoringExport,
} from './taskScoringAuthority'

const SOURCE_DIRECTORY = 'configs/scenarios' as const
const SCHEMA_CONTRACT = 'src/ace/evaluation/scenarios.py::Scenario' as const
const GRADER_FILE = 'src/ace/evaluation/grading/atomic.py' as const
const GRADER_SYMBOL = `${GRADER_FILE}::grade_atomic` as const
const SPLIT_FILE = 'src/ace/simulation/environment/database.py' as const
const SPLIT_SYMBOL = `${SPLIT_FILE}::Database.split_of` as const

type UnknownRecord = Record<string, unknown>

export interface AceTaskCatalog {
  tasks: AceTaskDetail[]
  facets: AceTaskFacets
  scoring?: AceTaskScoringContract
  source: {
    project: 'ACE'
    directory: typeof SOURCE_DIRECTORY
    schemaContract: typeof SCHEMA_CONTRACT
    readOnly: true
    authority?: 'current_worktree_catalog'
    catalogDigest?: string
    traceDefinitionAuthority?: 'trace_bound_snapshot_only'
    splitContract?: typeof SPLIT_SYMBOL
  }
}

function record(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function boolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function textList(owner: UnknownRecord, key: string): string[] | null {
  if (!(key in owner) || !Array.isArray(owner[key])) return null
  const values = owner[key]
  return values.every((value) => typeof value === 'string') ? [...values] : null
}

function recordList(owner: UnknownRecord, key: string): UnknownRecord[] | null {
  if (!(key in owner) || !Array.isArray(owner[key])) return null
  const values = owner[key].map(record)
  return values.every((value): value is UnknownRecord => value !== null) ? values : null
}

function nestedList(owner: UnknownRecord, key: string): unknown[][] | null {
  if (!(key in owner) || !Array.isArray(owner[key])) return null
  const values = owner[key]
  return values.every(Array.isArray) ? values.map((value) => [...value]) : null
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  const object = record(value)
  if (!object) return value
  return Object.fromEntries(
    Object.entries(object)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, stableValue(child)]),
  )
}

function digest(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex')
    .slice(0, 16)
}

function fullDigest(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function definitionValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(definitionValue)
  const object = record(value)
  if (!object) return value
  return Object.fromEntries(
    Object.entries(object)
      .filter(([key]) => !/canary/i.test(key))
      .map(([key, child]) => [key, definitionValue(child)]),
  )
}

interface ScoringLoadResult {
  scoring: AceTaskScoringContract
  authority: AceTaskPythonAuthority
  scenarios: Map<string, AceTaskScoringProbeScenario>
}

export interface LoadAceTaskCatalogOptions {
  scoringExporter?: AceTaskScoringExporter
}

async function sourceText(projectRoot: string, file: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(projectRoot, file), 'utf8')
  } catch {
    return null
  }
}

async function loadScoringContract(
  projectRoot: string,
  probeInputs: readonly AceTaskScoringProbeInput[],
  exporter: AceTaskScoringExporter,
): Promise<ScoringLoadResult> {
  const graderFile = GRADER_FILE
  const splitFile = SPLIT_FILE
  const graderBefore = await sourceText(projectRoot, graderFile)
  const splitBefore = await sourceText(projectRoot, splitFile)
  const rubricRoot = path.join(projectRoot, 'configs', 'rubrics')
  let rubricFiles: string[] = []
  try {
    rubricFiles = (await fs.readdir(rubricRoot))
      .filter((file) => file.endsWith('.md'))
      .sort((a, b) => a.localeCompare(b))
  } catch {
    // Optional shadow channels may be absent in a minimal local fixture.
  }
  const shadowRubrics = await Promise.all(
    rubricFiles.map(async (file) => {
      const content = await fs.readFile(path.join(rubricRoot, file), 'utf8')
      return {
        file: `configs/rubrics/${file}`,
        digest: fullDigest(content),
        available: true,
        kind: file.startsWith('semantic') ? ('semantic' as const) : ('judge' as const),
        gating: false as const,
        content,
      }
    }),
  )
  let exported: Awaited<ReturnType<AceTaskScoringExporter>> | null = null
  try {
    exported = await exporter(projectRoot, probeInputs)
  } catch {
    // Import/probe failures are expected while the sibling worktree is
    // incomplete. Never fall back to copied TypeScript scoring rules.
  }
  // Re-read after the subprocess. A concurrent edit must not let an output
  // derived from an older source revision retain a green "verified" badge.
  const graderAfter = await sourceText(projectRoot, graderFile)
  const splitAfter = await sourceText(projectRoot, splitFile)
  const sourcesStable = graderBefore === graderAfter && splitBefore === splitAfter
  const exportMatches =
    exported !== null &&
    graderAfter !== null &&
    splitAfter !== null &&
    exported.grader.digest === fullDigest(graderAfter) &&
    exported.splitResolver.digest === fullDigest(splitAfter)
  const authority: AceTaskPythonAuthority =
    exported === null
      ? {
          status: 'unavailable',
          method: 'fixed_python_runtime_probe',
          reason: 'python_probe_failed',
        }
      : !sourcesStable || !exportMatches
        ? {
            status: 'mismatch',
            method: 'fixed_python_runtime_probe',
            reason: 'source_digest_mismatch',
          }
        : { status: 'verified', method: 'fixed_python_runtime_probe' }
  const verifiedExport = authority.status === 'verified' ? exported : null
  const verified = verifiedExport !== null
  const scenarios = new Map<string, AceTaskScoringProbeScenario>()
  if (verifiedExport) {
    for (const scenario of verifiedExport.scenarios) scenarios.set(scenario.key, scenario)
  }
  return {
    authority,
    scenarios,
    scoring: {
      primaryGrader: {
        file: graderFile,
        digest: graderAfter ? fullDigest(graderAfter) : null,
        available: verified,
        authority,
        symbol: GRADER_SYMBOL,
        gating: true,
      },
      splitResolver: {
        file: splitFile,
        digest: splitAfter ? fullDigest(splitAfter) : null,
        available: verified,
        authority,
        symbol: SPLIT_SYMBOL,
        sourceContract: verifiedExport?.splitResolver.sourceContract ?? null,
      },
      verdictFormula:
        'reward = 1 only when every gating check at the episode boundary passes; otherwise reward = 0. Non-gating checks remain diagnostics.',
      primaryBoundary: 'episode',
      botBoundaryAvailable: true,
      invalidUserSimPolicy:
        'Invalid user-simulator episodes are void: grade and metrics are null and they are excluded from pass/fail denominators.',
      sourceContract: verifiedExport?.grader.sourceContract ?? null,
      shadowRubrics,
    },
  }
}

function normalizeVariant(row: UnknownRecord, source: AceTaskSource): AceTaskVariant {
  const card = record(row.card) ?? {}
  const style = textList(card, 'style')
  const goal = text(card.goal)
  const journeyId = text(row.journey_id)
  const orderId = text(card.order_id)
  return {
    definitionDigest: digest(definitionValue(row)),
    sources: [source],
    suite: text(row.suite),
    journeyId,
    journeyStep: number(row.journey_step),
    split: null,
    persona: {
      issue: text(card.issue),
      language: text(card.language),
      idKnowledge: text(card.id_knowledge),
      patience: number(card.patience),
      persistence: text(card.persistence),
      style,
      orderId,
      goal,
      adversarial: boolean(card.adversarial),
    },
    taskBrief: goal,
    expectedActions: recordList(row, 'expected_actions'),
    forbiddenActions: textList(row, 'forbidden_actions'),
    expectedOutcome: text(row.expected_outcome),
    rewardBasis: textList(row, 'reward_basis'),
    authorizedEffects: recordList(row, 'authorized_effects'),
    requiredInfo: recordList(row, 'required_info'),
    expectedStateDelta: recordList(row, 'expected_state_delta'),
    mustPrecede: nestedList(row, 'must_precede'),
    consentRequired: boolean(row.consent_required),
    promiseCheck: boolean(row.promise_check),
    userScript: textList(row, 'user_script'),
  }
}

function commonValue<T>(values: readonly T[]): T | null {
  if (values.length === 0) return null
  const first = values[0]
  return values.every((value) => value === first) ? (first ?? null) : null
}

function personaKey(variants: readonly AceTaskVariant[]): string {
  const values = new Set<string>()
  for (const { persona } of variants) {
    for (const value of [persona.idKnowledge, persona.persistence, ...(persona.style ?? [])]) {
      if (value) values.add(value)
    }
    if (persona.adversarial === true) values.add('adversarial')
  }
  return [...values].sort().join(' · ')
}

function preferredComparePair(runSets: string[][]): [string, string] | null {
  const candidates: Array<[number, string, string]> = []
  for (const runs of runSets) {
    for (let left = 0; left < runs.length; left += 1) {
      for (let right = left + 1; right < runs.length; right += 1) {
        const a = runs[left]
        const b = runs[right]
        if (!a || !b) continue
        const normalizeArm = (run: string) =>
          run.toLowerCase().replace(/(?:^|[-_.])(baseline|optimized)(?=$|[-_.])/g, '-')
        const isNamedArm = /baseline/i.test(a) !== /baseline/i.test(b)
        const sameTransport = normalizeArm(a) === normalizeArm(b)
        candidates.push([isNamedArm && sameTransport ? 0 : isNamedArm ? 1 : 2, a, b])
      }
    }
  }
  candidates.sort(
    ([scoreA, a1, a2], [scoreB, b1, b2]) =>
      scoreA - scoreB || a1.localeCompare(b1) || a2.localeCompare(b2),
  )
  const selected = candidates[0]
  return selected ? [selected[1], selected[2]] : null
}

export function traceCoverageFor(
  scenarioId: string,
  traces: readonly TraceSummary[],
  currentDefinitionDigests: readonly string[] = [],
): AceTaskTraceCoverage {
  const allMatching = allMatchingTaskTraces(scenarioId, traces)
  const matching = allMatching.filter(isFormalTaskTrace)
  const runIds = [...new Set(matching.map((trace) => trace.meta.runId ?? 'run-a'))].sort()
  const byPair = new Map<string, Map<string, number>>()
  for (const trace of matching) {
    if (!trace.meta.pairKey) continue
    const runs = byPair.get(trace.meta.pairKey) ?? new Map<string, number>()
    const runId = trace.meta.runId ?? 'run-a'
    runs.set(runId, (runs.get(runId) ?? 0) + 1)
    byPair.set(trace.meta.pairKey, runs)
  }
  const matchedRunSets = [...byPair.values()]
    // A pair key is usable only when every arm contributes exactly one trace.
    // Duplicated rows within one arm are an integrity ambiguity and must match
    // the stricter A/B comparison quarantine rather than inflating coverage.
    .filter((runs) => runs.size >= 2 && [...runs.values()].every((count) => count === 1))
    .map((runs) => [...runs.keys()].sort())
  return {
    traceCount: matching.length,
    exploratoryTraceCount: allMatching.length - matching.length,
    runCount: runIds.length,
    runIds,
    matchedPairCount: matchedRunSets.length,
    compareRunIds: preferredComparePair(matchedRunSets),
    status: statusFor(matching, currentDefinitionDigests),
  }
}

function allMatchingTaskTraces(
  scenarioId: string,
  traces: readonly TraceSummary[],
): TraceSummary[] {
  return traces.filter((trace) => {
    if (trace.meta.instanceId !== scenarioId) return false
    // Store-normalized ACE simulations have corpusId=simulation. Retain
    // corpus-less fixture/legacy traces, but never let a production id
    // collision change task status.
    return trace.meta.corpusId === undefined || trace.meta.corpusId === 'simulation'
  })
}

function isFormalTaskTrace(trace: TraceSummary): boolean {
  return isFormalMetricsTrace(trace)
}

function matchingTaskTraces(scenarioId: string, traces: readonly TraceSummary[]): TraceSummary[] {
  return allMatchingTaskTraces(scenarioId, traces).filter(isFormalTaskTrace)
}

function emptyOutcomes(): AceTaskOutcomeCounts {
  return { pass: 0, fail: 0, invalid: 0, runtime_error: 0, ungraded: 0 }
}

function outcomeOf(trace: TraceSummary): TraceOutcome {
  const outcome = trace.evaluation?.outcome
  if (
    outcome === 'pass' ||
    outcome === 'fail' ||
    outcome === 'invalid' ||
    outcome === 'runtime_error' ||
    outcome === 'ungraded'
  ) {
    return outcome
  }
  return trace.meta.status === 'failed' ? 'runtime_error' : 'ungraded'
}

function outcomeCounts(traces: readonly TraceSummary[]): AceTaskOutcomeCounts {
  const counts = emptyOutcomes()
  for (const trace of traces) counts[outcomeOf(trace)] += 1
  return counts
}

function lifecycleOf(trace: TraceSummary): keyof AceTaskStatusSummary['lifecycle'] {
  const state = trace.evaluation?.lifecycle.state ?? trace.meta.status
  if (
    state === 'completed' ||
    state === 'failed' ||
    state === 'executing' ||
    state === 'cancelled'
  ) {
    return state
  }
  return 'unknown'
}

function validSnapshotDigest(trace: TraceSummary): string | null {
  const extra = record(trace.meta.extra)
  if (!extra) return null
  const snapshot = record(extra.scenario_snapshot) ?? record(extra.scenarioSnapshot)
  if (!snapshot) return null
  const provenance = text(extra.scenario_snapshot_provenance ?? extra.scenarioSnapshotProvenance)
  if (provenance !== 'episode_sidecar' && provenance !== 'batch_manifest') return null
  const snapshotId = text(snapshot.scenario_id ?? snapshot.scenarioId)
  if (!snapshotId || snapshotId !== trace.meta.instanceId) return null
  const configDigest = text(extra.config_digest ?? extra.configDigest)
  if (!configDigest) return null
  const snapshotConfigDigest = text(snapshot.config_digest ?? snapshot.configDigest)
  if (snapshotConfigDigest && snapshotConfigDigest !== configDigest) return null
  return digest(definitionValue(snapshot))
}

function statusFor(
  traces: readonly TraceSummary[],
  currentDefinitionDigests: readonly string[],
): AceTaskStatusSummary {
  const outcomes = outcomeCounts(traces)
  const lifecycle = { completed: 0, failed: 0, executing: 0, cancelled: 0, unknown: 0 }
  const definitionProvenance = {
    matchingCurrentDefinition: 0,
    historicalDefinition: 0,
    unavailable: 0,
  }
  for (const trace of traces) {
    lifecycle[lifecycleOf(trace)] += 1
    const snapshotDigest = validSnapshotDigest(trace)
    if (!snapshotDigest) definitionProvenance.unavailable += 1
    else if (currentDefinitionDigests.includes(snapshotDigest)) {
      definitionProvenance.matchingCurrentDefinition += 1
    } else definitionProvenance.historicalDefinition += 1
  }
  const scoredDenominator = outcomes.pass + outcomes.fail
  const latestTraceAt =
    traces
      .map((trace) => trace.meta.timestamp)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null
  const status =
    traces.length === 0
      ? ('not_run' as const)
      : outcomes.fail + outcomes.invalid + outcomes.runtime_error > 0
        ? ('needs_attention' as const)
        : lifecycle.executing > 0
          ? ('in_progress' as const)
          : scoredDenominator > 0 && outcomes.ungraded === 0
            ? ('all_pass' as const)
            : ('ungraded' as const)
  return {
    status,
    outcomes,
    lifecycle,
    scoredDenominator,
    passRate: scoredDenominator > 0 ? outcomes.pass / scoredDenominator : null,
    latestTraceAt,
    definitionProvenance,
  }
}

function runCoverageFor(
  scenarioId: string,
  traces: readonly TraceSummary[],
  currentDefinitionDigests: readonly string[],
): AceTaskRunCoverage[] {
  const byRun = new Map<string, TraceSummary[]>()
  for (const trace of matchingTaskTraces(scenarioId, traces)) {
    const runId = trace.meta.runId ?? 'run-a'
    const entries = byRun.get(runId) ?? []
    entries.push(trace)
    byRun.set(runId, entries)
  }
  return [...byRun.entries()]
    .map(([runId, entries]) => ({
      runId,
      traceCount: entries.length,
      status: statusFor(entries, currentDefinitionDigests),
    }))
    .sort((a, b) => a.runId.localeCompare(b.runId))
}

function observedChecks(trace: TraceSummary): AceTaskObservedCheck[] | null {
  const checks = trace.evaluation?.checks
  if (!checks || checks.length === 0) return null
  return checks.map(({ name, gating }) => ({ name, gating }))
}

function canonicalChecks(checks: readonly AceTaskObservedCheck[]): string {
  return [...checks]
    .sort((a, b) => a.name.localeCompare(b.name) || Number(a.gating) - Number(b.gating))
    .map((check) => `${check.name}:${check.gating ? 'gate' : 'shadow'}`)
    .join('|')
}

function matchesCurrentChecks(
  checks: readonly AceTaskObservedCheck[],
  variants: readonly AceTaskVariant[],
): boolean | null {
  if (variants.length !== 1) return null
  const current = variants[0]?.effectiveChecks
  if (!current) return null
  // TERMINATION is only serialized when it fails, so it is omitted from the
  // normal completed-trace fingerprint comparison.
  const expected = current
    .filter((check) => check.name !== 'TERMINATION')
    .map(({ name, effectiveGating }) => ({ name, gating: effectiveGating }))
  return canonicalChecks(checks) === canonicalChecks(expected)
}

function observedScoringContractsFor(
  scenarioId: string,
  traces: readonly TraceSummary[],
  variants: readonly AceTaskVariant[],
): AceTaskObservedScoringContract[] {
  const groups = new Map<string, { checks: AceTaskObservedCheck[]; traces: TraceSummary[] }>()
  for (const trace of matchingTaskTraces(scenarioId, traces)) {
    const checks = observedChecks(trace)
    if (!checks) continue
    const key = canonicalChecks(checks)
    const group = groups.get(key) ?? { checks, traces: [] }
    group.traces.push(trace)
    groups.set(key, group)
  }
  return [...groups.values()]
    .map(({ checks, traces: entries }) => ({
      fingerprint: digest(checks),
      checks,
      traceCount: entries.length,
      runIds: [...new Set(entries.map((trace) => trace.meta.runId ?? 'run-a'))].sort(),
      outcomes: outcomeCounts(entries),
      latestTraceAt:
        entries
          .map((trace) => trace.meta.timestamp)
          .filter(Boolean)
          .sort()
          .at(-1) ?? null,
      matchesCurrentCheckShape: matchesCurrentChecks(checks, variants),
    }))
    .sort((a, b) => b.traceCount - a.traceCount || a.fingerprint.localeCompare(b.fingerprint))
}

function setFacet(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => value !== null))].sort()
}

function buildFacets(tasks: readonly AceTaskDetail[]): AceTaskFacets {
  return {
    suites: setFacet(tasks.map((task) => task.suite)),
    issues: setFacet(tasks.map((task) => task.issue)),
    languages: setFacet(tasks.map((task) => task.language)),
    journeys: setFacet(tasks.map((task) => task.journeyId)),
    personas: setFacet(tasks.map((task) => task.personaKey || null)),
    sourcePacks: setFacet(tasks.flatMap((task) => task.sourcePacks)),
  }
}

export async function loadAceTaskCatalog(
  projectRoot: string,
  traces: readonly TraceSummary[] = [],
  options: LoadAceTaskCatalogOptions = {},
): Promise<AceTaskCatalog> {
  const root = path.join(projectRoot, 'configs', 'scenarios')
  const entries = (await fs.readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .sort((a, b) => a.name.localeCompare(b.name))
  const grouped = new Map<string, AceTaskVariant[]>()
  const probeRows = new Map<string, Record<string, unknown>>()

  for (const entry of entries) {
    let parsed: unknown
    let raw: string
    try {
      raw = await fs.readFile(path.join(root, entry.name), 'utf8')
      parsed = JSON.parse(raw)
    } catch (error) {
      throw new Error(
        `Cannot read ACE scenario pack ${entry.name}: ${error instanceof Error ? error.message : 'invalid JSON'}`,
      )
    }
    if (!Array.isArray(parsed)) throw new Error(`ACE scenario pack ${entry.name} must be an array`)
    const source: AceTaskSource = {
      pack: entry.name.slice(0, -'.json'.length),
      file: `${SOURCE_DIRECTORY}/${entry.name}`,
      fileDigest: fullDigest(raw),
    }
    for (const [index, value] of parsed.entries()) {
      const row = record(value)
      const scenarioId = row ? text(row.scenario_id) : null
      if (!row || !scenarioId) {
        throw new Error(`ACE scenario pack ${entry.name} has no scenario_id at row ${index + 1}`)
      }
      const variant = normalizeVariant(row, source)
      const probeRow = record(definitionValue(row))
      if (probeRow && !probeRows.has(variant.definitionDigest)) {
        probeRows.set(variant.definitionDigest, probeRow)
      }
      const variants = grouped.get(scenarioId) ?? []
      const same = variants.find(
        (candidate) => candidate.definitionDigest === variant.definitionDigest,
      )
      if (same) same.sources.push(source)
      else variants.push(variant)
      grouped.set(scenarioId, variants)
    }
  }

  const scoringLoad = await loadScoringContract(
    projectRoot,
    [...probeRows.entries()].map(([key, scenario]) => ({ key, scenario })),
    options.scoringExporter ?? runAceTaskScoringExport,
  )
  for (const [scenarioId, variants] of grouped) {
    for (const variant of variants) {
      if (scoringLoad.authority.status !== 'verified') {
        variant.pythonAuthority = scoringLoad.authority
        continue
      }
      const probe = scoringLoad.scenarios.get(variant.definitionDigest)
      if (!probe) {
        variant.pythonAuthority = {
          status: 'unavailable',
          method: 'fixed_python_runtime_probe',
          reason: 'scenario_output_missing',
        }
        continue
      }
      if (probe.status === 'unavailable') {
        variant.pythonAuthority = {
          status: 'unavailable',
          method: 'fixed_python_runtime_probe',
          reason: probe.reason,
        }
        continue
      }
      if (probe.scenarioId !== scenarioId) {
        variant.pythonAuthority = {
          status: 'mismatch',
          method: 'fixed_python_runtime_probe',
          reason: 'scenario_identity_mismatch',
        }
        continue
      }
      variant.pythonAuthority = { status: 'verified', method: 'fixed_python_runtime_probe' }
      variant.split = probe.split
      variant.journeyKey = probe.journeyKey
      variant.effectiveChecks = probe.effectiveChecks
    }
  }

  const tasks = [...grouped.entries()]
    .map(([scenarioId, variants]): AceTaskDetail => {
      variants.sort((a, b) => a.definitionDigest.localeCompare(b.definitionDigest))
      for (const variant of variants) {
        variant.sources.sort((a, b) => a.file.localeCompare(b.file))
      }
      const sourceFiles = [
        ...new Set(variants.flatMap((variant) => variant.sources.map((s) => s.file))),
      ].sort()
      const sourcePacks = [
        ...new Set(variants.flatMap((variant) => variant.sources.map((s) => s.pack))),
      ].sort()
      const definitionDigests = variants.map((variant) => variant.definitionDigest)
      return {
        scenarioId,
        suite: commonValue(variants.map((variant) => variant.suite)),
        journeyId: commonValue(variants.map((variant) => variant.journeyId)),
        journeyStep: commonValue(variants.map((variant) => variant.journeyStep)),
        issue: commonValue(variants.map((variant) => variant.persona.issue)),
        language: commonValue(variants.map((variant) => variant.persona.language)),
        personaKey: personaKey(variants),
        taskBrief: commonValue(variants.map((variant) => variant.taskBrief)),
        sourcePacks,
        sourceFiles,
        conflict: variants.length > 1,
        traceCoverage: traceCoverageFor(scenarioId, traces, definitionDigests),
        variants,
        runCoverage: runCoverageFor(scenarioId, traces, definitionDigests),
        observedScoringContracts: observedScoringContractsFor(scenarioId, traces, variants),
      }
    })
    .sort((a, b) => a.scenarioId.localeCompare(b.scenarioId))

  return {
    tasks,
    facets: buildFacets(tasks),
    scoring: scoringLoad.scoring,
    source: {
      project: 'ACE',
      directory: SOURCE_DIRECTORY,
      schemaContract: SCHEMA_CONTRACT,
      readOnly: true,
      authority: 'current_worktree_catalog',
      catalogDigest: fullDigest(
        JSON.stringify(
          stableValue(
            tasks.map((task) => ({
              scenarioId: task.scenarioId,
              variants: task.variants.map((variant) => ({
                definitionDigest: variant.definitionDigest,
                sources: variant.sources,
              })),
            })),
          ),
        ),
      ),
      traceDefinitionAuthority: 'trace_bound_snapshot_only',
      ...(scoringLoad.authority.status === 'verified' ? { splitContract: SPLIT_SYMBOL } : {}),
    },
  }
}

function includes(value: string | null, needle: string): boolean {
  return value?.toLowerCase().includes(needle) ?? false
}

export function filterAceTasks(
  tasks: readonly AceTaskDetail[],
  query: AceTaskQuery,
): AceTaskSummary[] {
  const lowered = Object.fromEntries(
    Object.entries(query).map(([key, value]) => [key, value?.trim().toLowerCase()]),
  ) as Record<keyof AceTaskQuery, string | undefined>
  return tasks
    .filter((task) => {
      if (lowered.id && !includes(task.scenarioId, lowered.id)) return false
      if (lowered.suite && task.suite?.toLowerCase() !== lowered.suite) return false
      if (lowered.issue && task.issue?.toLowerCase() !== lowered.issue) return false
      if (lowered.language && task.language?.toLowerCase() !== lowered.language) return false
      if (
        lowered.sourcePack &&
        !task.sourcePacks.some((pack) => pack.toLowerCase() === lowered.sourcePack)
      ) {
        return false
      }
      if (lowered.journey) {
        const journey = task.journeyId?.toLowerCase()
        if (
          lowered.journey === '__standalone__' ? journey !== undefined : journey !== lowered.journey
        ) {
          return false
        }
      }
      if (lowered.persona && !includes(task.personaKey, lowered.persona)) return false
      if (lowered.q) {
        const searchable = [
          task.scenarioId,
          task.suite,
          task.issue,
          task.language,
          task.personaKey,
          task.taskBrief,
          ...task.sourcePacks,
          ...task.variants.flatMap((variant) => [
            variant.expectedOutcome,
            ...(variant.rewardBasis ?? []),
            JSON.stringify(variant.expectedActions ?? []),
            JSON.stringify(variant.forbiddenActions ?? []),
            JSON.stringify(variant.requiredInfo ?? []),
            JSON.stringify(variant.expectedStateDelta ?? []),
          ]),
        ]
        if (!searchable.some((value) => includes(value, lowered.q as string))) return false
      }
      return true
    })
    .map(
      ({
        variants: _variants,
        runCoverage: _runCoverage,
        observedScoringContracts: _observedScoringContracts,
        ...summary
      }) => summary,
    )
}
