import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TraceSummary } from '../../shared/schema/types'
import { filterAceTasks, loadAceTaskCatalog, traceCoverageFor } from './taskCatalog'
import type { AceTaskScoringExport, AceTaskScoringExporter } from './taskScoringAuthority'

const complete = {
  scenario_id: 'task-a',
  suite: 'sealed',
  journey_id: null,
  journey_step: 0,
  card: {
    issue: 'refund_payment',
    language: 'en',
    id_knowledge: 'partial',
    patience: 4,
    persistence: 'pushes_back',
    style: ['frustrated'],
    order_id: 'order_1',
    goal: 'Get the eligible refund.',
    adversarial: false,
  },
  expected_actions: [{ name: 'refund_order', args_subset: { order_id: 'order_1' } }],
  forbidden_actions: [],
  expected_outcome: 'refund',
  reward_basis: ['ACTIONS', 'OUTCOME'],
  authorized_effects: [{ order_id: 'order_1', effects: ['refund'] }],
  required_info: [],
  expected_state_delta: [],
  must_precede: [],
  consent_required: true,
  promise_check: false,
  user_script: ['please refund order_1'],
}

const emptyStats: TraceSummary['stats'] = {
  score: null,
  hasError: false,
  truncated: false,
  inputTokens: 0,
  outputTokens: 0,
  thinkingTokens: 0,
  totalTokens: 0,
  turns: 0,
  toolUses: 0,
  sandboxExecutions: 0,
  thinkingPortion: 0,
}

function trace(runId: string, pairKey?: string, instanceId = 'task-a'): TraceSummary {
  return {
    meta: {
      traceId: `${runId}:${instanceId}`,
      instanceId,
      runId,
      pairKey,
      component: 'ace/test',
      status: 'completed',
      timestamp: '2026-08-06T00:00:00.000Z',
      checkpointStep: 0,
      split: 'test',
      sourceFormat: 'agent-conversation',
    },
    stats: emptyStats,
  }
}

function evaluatedTrace(options: {
  runId: string
  outcome: 'pass' | 'fail' | 'invalid' | 'runtime_error' | 'ungraded'
  timestamp: string
  checks: Array<{ name: string; gating: boolean }>
  snapshot?: Record<string, unknown>
}): TraceSummary {
  return {
    meta: {
      traceId: `${options.runId}:task-a`,
      instanceId: 'task-a',
      corpusId: 'simulation',
      runId: options.runId,
      component: 'ace/test',
      timestamp: options.timestamp,
      status: options.outcome === 'runtime_error' ? 'failed' : 'completed',
      checkpointStep: 0,
      split: 'test',
      sourceFormat: 'agent-conversation',
      extra: options.snapshot
        ? {
            scenario_snapshot: options.snapshot,
            scenario_snapshot_provenance: 'episode_sidecar',
            config_digest: 'config-a',
          }
        : {},
    },
    evaluation: {
      lifecycle: {
        state: options.outcome === 'runtime_error' ? 'failed' : 'completed',
      },
      outcome: options.outcome,
      checks: options.checks.map((check) => ({ ...check, ok: options.outcome === 'pass' })),
      metrics: {},
      failures: [],
      flags: [],
      worldDiff: [],
      ledger: [],
    },
    stats: emptyStats,
  }
}

describe('ACE task catalog', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ace-task-catalog-'))
    await fs.mkdir(path.join(root, 'configs', 'scenarios'), { recursive: true })
    await fs.mkdir(path.join(root, 'configs', 'rubrics'), { recursive: true })
    await fs.mkdir(path.join(root, 'src', 'ace'), { recursive: true })
    await fs.writeFile(
      path.join(root, 'src', 'ace', 'scenario.py'),
      `def _grade_checks():
    """Current gating contract from source."""

def grade_atomic():
    """Binary reward over gating checks."""
`,
    )
    await fs.writeFile(
      path.join(root, 'src', 'ace', 'db.py'),
      `class Database:
    @staticmethod
    def split_of(order_id):
        return "holdout"
`,
    )
    await fs.writeFile(
      path.join(root, 'configs', 'rubrics', 'judge_v2.md'),
      '# Frozen judge rubric\n\nShadow only.\n',
    )
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  async function writePack(file: string, rows: unknown[]) {
    await fs.writeFile(path.join(root, 'configs', 'scenarios', file), JSON.stringify(rows))
  }

  const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

  const verifiedExporter: AceTaskScoringExporter = async (projectRoot, scenarios) => {
    const grader = await fs.readFile(path.join(projectRoot, 'src', 'ace', 'scenario.py'), 'utf8')
    const split = await fs.readFile(path.join(projectRoot, 'src', 'ace', 'db.py'), 'utf8')
    const names = [
      'ACTIONS',
      'MUST_PRECEDE',
      'FORBIDDEN',
      'OUTCOME',
      'WORLD_DIFF',
      'REQUIRED_INFO',
      'WRITE_SAFETY',
      'CONSENT',
      'PROMISE',
      'TERMINATION',
    ]
    return {
      schemaVersion: 1,
      grader: {
        file: 'src/ace/scenario.py',
        digest: sha256(grader),
        symbol: 'src/ace/scenario.py::grade_atomic',
        sourceContract: 'Current runtime-probed scoring contract.',
      },
      splitResolver: {
        file: 'src/ace/db.py',
        digest: sha256(split),
        symbol: 'src/ace/db.py::Database.split_of',
        sourceContract: 'Current runtime-probed split contract.',
      },
      scenarios: scenarios.map(({ key, scenario }) => {
        const rewardBasis = new Set(
          Array.isArray(scenario.reward_basis) ? scenario.reward_basis : ['ACTIONS'],
        )
        const gating = (name: string) => {
          if (name === 'WORLD_DIFF' || name === 'WRITE_SAFETY' || name === 'TERMINATION') {
            return true
          }
          if (name === 'MUST_PRECEDE') {
            return Array.isArray(scenario.must_precede) && scenario.must_precede.length > 0
          }
          if (name === 'OUTCOME') {
            return (
              rewardBasis.has(name) ||
              (Array.isArray(scenario.expected_state_delta) &&
                scenario.expected_state_delta.length > 0)
            )
          }
          if (name === 'CONSENT') return false
          if (name === 'PROMISE') return scenario.promise_check === true
          return rewardBasis.has(name)
        }
        return {
          key,
          status: 'verified' as const,
          scenarioId: String(scenario.scenario_id),
          split: 'holdout' as const,
          journeyKey: String(scenario.journey_id ?? scenario.scenario_id),
          effectiveChecks: names.map((name) => ({
            name,
            sourceSymbol: `src/ace/scenario.py::_${name.toLowerCase()}`,
            purpose: `Runtime purpose for ${name}.`,
            gatingRule: 'Resolved by current Python runtime.',
            effectiveGating: gating(name),
            basis: `Runtime probe returned gating=${gating(name)}.`,
          })),
        }
      }),
    } satisfies AceTaskScoringExport
  }

  async function load(traces: readonly TraceSummary[] = []) {
    return loadAceTaskCatalog(root, traces, { scoringExporter: verifiedExporter })
  }

  it('deduplicates identical split packs and preserves missing versus empty fields', async () => {
    await writePack('graded.json', [
      { ...complete, canary: 'CANARY::one' },
      { scenario_id: 'task-unset', card: {} },
    ])
    await writePack('graded_dev.json', [{ ...complete, canary: 'CANARY::two' }])
    const catalog = await load()

    expect(catalog.tasks).toHaveLength(2)
    const task = catalog.tasks.find((entry) => entry.scenarioId === 'task-a')
    expect(task).toMatchObject({
      conflict: false,
      suite: 'sealed',
      issue: 'refund_payment',
      sourcePacks: ['graded', 'graded_dev'],
      sourceFiles: ['configs/scenarios/graded.json', 'configs/scenarios/graded_dev.json'],
    })
    expect(task?.variants).toHaveLength(1)
    expect(task?.variants[0]?.sources).toHaveLength(2)
    expect(task?.variants[0]?.sources[0]?.fileDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(task?.variants[0]?.forbiddenActions).toEqual([])

    const unset = catalog.tasks.find((entry) => entry.scenarioId === 'task-unset')
    expect(unset?.variants[0]).toMatchObject({
      suite: null,
      expectedActions: null,
      forbiddenActions: null,
      consentRequired: null,
      promiseCheck: null,
    })
    expect(unset?.variants[0]?.persona).toMatchObject({
      issue: null,
      language: null,
      goal: null,
      style: null,
    })
    expect(catalog.source).toMatchObject({
      authority: 'current_worktree_catalog',
      traceDefinitionAuthority: 'trace_bound_snapshot_only',
    })
    expect(catalog.source.catalogDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(catalog.scoring).toMatchObject({
      primaryGrader: {
        file: 'src/ace/scenario.py',
        available: true,
        symbol: 'src/ace/scenario.py::grade_atomic',
        gating: true,
      },
      primaryBoundary: 'episode',
      botBoundaryAvailable: true,
      shadowRubrics: [
        {
          file: 'configs/rubrics/judge_v2.md',
          kind: 'judge',
          gating: false,
          content: '# Frozen judge rubric\n\nShadow only.\n',
        },
      ],
    })
    expect(catalog.scoring?.sourceContract).toContain('Current runtime-probed scoring contract.')
  })

  it('surfaces conflicting definitions instead of silently choosing a goal', async () => {
    await writePack('one.json', [complete])
    await writePack('two.json', [
      { ...complete, card: { ...complete.card, goal: 'A different source goal.' } },
    ])
    const catalog = await load()
    expect(catalog.tasks[0]).toMatchObject({
      scenarioId: 'task-a',
      conflict: true,
      taskBrief: null,
      sourcePacks: ['one', 'two'],
    })
    expect(catalog.tasks[0]?.variants).toHaveLength(2)
  })

  it('filters independently by task id, contract facets, journey, and persona', async () => {
    await writePack('suite.json', [
      complete,
      {
        ...complete,
        scenario_id: 'task-b',
        suite: 'stress',
        journey_id: 'refund-journey',
        card: {
          ...complete.card,
          issue: 'order_status',
          language: 'ko',
          id_knowledge: 'exact',
          persistence: 'demands_human',
          style: [],
        },
      },
    ])
    const catalog = await load()

    expect(filterAceTasks(catalog.tasks, { id: 'TASK-B' }).map((task) => task.scenarioId)).toEqual([
      'task-b',
    ])
    expect(
      filterAceTasks(catalog.tasks, {
        suite: 'stress',
        issue: 'order_status',
        language: 'ko',
        journey: 'refund-journey',
        persona: 'demands_human',
      }).map((task) => task.scenarioId),
    ).toEqual(['task-b'])
    expect(filterAceTasks(catalog.tasks, { journey: '__standalone__' })).toHaveLength(1)
  })

  it('reports matching traces and a matched baseline/optimized compare pair', () => {
    const coverage = traceCoverageFor('task-a', [
      trace('baseline-chat', 'schedule:task-a:7'),
      trace('optimized-chat', 'schedule:task-a:7'),
      trace('baseline-responses', 'schedule:task-a:7'),
      trace('unrelated', undefined, 'task-b'),
      {
        meta: { instanceId: 'task-a', runId: 'production-collision', corpusId: 'production' },
        evaluation: { outcome: 'runtime_error' },
      } as TraceSummary,
    ])
    expect(coverage).toMatchObject({
      traceCount: 3,
      runCount: 3,
      runIds: ['baseline-chat', 'baseline-responses', 'optimized-chat'],
      matchedPairCount: 1,
      compareRunIds: ['baseline-chat', 'optimized-chat'],
      status: {
        status: 'ungraded',
        outcomes: { pass: 0, fail: 0, invalid: 0, runtime_error: 0, ungraded: 3 },
        scoredDenominator: 0,
        passRate: null,
        definitionProvenance: {
          matchingCurrentDefinition: 0,
          historicalDefinition: 0,
          unavailable: 3,
        },
      },
    })
  })

  it('keeps debug and counterfactual traces out of formal task status', () => {
    const formal = evaluatedTrace({
      runId: 'formal',
      outcome: 'pass',
      timestamp: '2026-08-06T00:00:00.000Z',
      checks: [],
    })
    formal.meta.pairKey = 'schedule:task-a:1'
    const debug = evaluatedTrace({
      runId: 'debug',
      outcome: 'fail',
      timestamp: '2026-08-06T00:00:01.000Z',
      checks: [],
    })
    const exploratory = {
      ...debug,
      meta: {
        ...debug.meta,
        pairKey: 'schedule:task-a:2',
        extra: { run_kind: 'debug' },
      },
    } as TraceSummary

    const coverage = traceCoverageFor('task-a', [formal, exploratory])
    expect(coverage).toMatchObject({
      traceCount: 1,
      exploratoryTraceCount: 1,
      runIds: ['formal'],
      status: {
        status: 'all_pass',
        outcomes: { pass: 1, fail: 0 },
        scoredDenominator: 1,
        passRate: 1,
      },
    })
  })

  it('keeps recorded status and historical grader contracts separate from the current task', async () => {
    await writePack('graded.json', [{ ...complete, canary: 'CURRENT_SECRET' }])
    const currentChecks = [
      ['ACTIONS', true],
      ['MUST_PRECEDE', false],
      ['FORBIDDEN', false],
      ['OUTCOME', true],
      ['WORLD_DIFF', true],
      ['REQUIRED_INFO', false],
      ['WRITE_SAFETY', true],
      ['CONSENT', false],
      ['PROMISE', false],
    ].map(([name, gating]) => ({ name: String(name), gating: Boolean(gating) }))
    const historicalChecks = currentChecks
      .filter((check) => check.name !== 'PROMISE')
      .map((check) => (check.name === 'REQUIRED_INFO' ? { ...check, gating: true } : check))
    const traces = [
      evaluatedTrace({
        runId: 'current-run',
        outcome: 'pass',
        timestamp: '2026-08-06T02:00:00.000Z',
        checks: currentChecks,
        snapshot: { ...complete, canary: 'TRACE_SECRET' },
      }),
      evaluatedTrace({
        runId: 'historical-run',
        outcome: 'fail',
        timestamp: '2026-08-06T01:00:00.000Z',
        checks: historicalChecks,
        snapshot: {
          ...complete,
          card: { ...complete.card, goal: 'Historical goal.' },
          canary: 'OLD_SECRET',
        },
      }),
      evaluatedTrace({
        runId: 'legacy-run',
        outcome: 'invalid',
        timestamp: '2026-08-06T00:00:00.000Z',
        checks: [],
      }),
    ]
    const catalog = await load(traces)
    const task = catalog.tasks[0]

    expect(task?.traceCoverage.status).toMatchObject({
      status: 'needs_attention',
      outcomes: { pass: 1, fail: 1, invalid: 1, runtime_error: 0, ungraded: 0 },
      scoredDenominator: 2,
      passRate: 0.5,
      latestTraceAt: '2026-08-06T02:00:00.000Z',
      definitionProvenance: {
        matchingCurrentDefinition: 1,
        historicalDefinition: 1,
        unavailable: 1,
      },
    })
    expect(task?.runCoverage).toHaveLength(3)
    expect(task?.observedScoringContracts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          traceCount: 1,
          matchesCurrentCheckShape: true,
          outcomes: expect.objectContaining({ pass: 1 }),
        }),
        expect.objectContaining({
          traceCount: 1,
          matchesCurrentCheckShape: false,
          outcomes: expect.objectContaining({ fail: 1 }),
        }),
      ]),
    )
    expect(JSON.stringify(task)).not.toContain('CURRENT_SECRET')
    expect(JSON.stringify(task)).not.toContain('TRACE_SECRET')
    expect(JSON.stringify(task)).not.toContain('OLD_SECRET')
  })

  it('searches machine-checkable actions, outcomes, and reward bases', async () => {
    await writePack('graded.json', [complete])
    const catalog = await load()
    expect(filterAceTasks(catalog.tasks, { q: 'refund_order' })).toHaveLength(1)
    expect(filterAceTasks(catalog.tasks, { q: 'OUTCOME' })).toHaveLength(1)
    expect(filterAceTasks(catalog.tasks, { q: 'refund' })).toHaveLength(1)
  })

  it('uses runtime-exported REQUIRED_INFO gating and split instead of copied TS rules', async () => {
    await writePack('graded.json', [
      { ...complete, reward_basis: ['ACTIONS', 'OUTCOME', 'REQUIRED_INFO'] },
    ])
    const catalog = await load()
    const variant = catalog.tasks[0]?.variants[0]

    expect(catalog.scoring?.primaryGrader).toMatchObject({
      available: true,
      authority: { status: 'verified', method: 'fixed_python_runtime_probe' },
    })
    expect(catalog.scoring?.splitResolver).toMatchObject({
      available: true,
      symbol: 'src/ace/db.py::Database.split_of',
      authority: { status: 'verified' },
    })
    expect(variant).toMatchObject({
      split: 'holdout',
      pythonAuthority: { status: 'verified' },
    })
    expect(variant?.effectiveChecks?.find(({ name }) => name === 'REQUIRED_INFO')).toMatchObject({
      effectiveGating: true,
      basis: 'Runtime probe returned gating=true.',
    })
  })

  it('fails closed when Python output no longer matches the current scoring source', async () => {
    await writePack('graded.json', [complete])
    const staleExporter: AceTaskScoringExporter = async (projectRoot, scenarios) => {
      const result = await verifiedExporter(projectRoot, scenarios)
      await fs.appendFile(path.join(projectRoot, 'src', 'ace', 'scenario.py'), '\n# drift\n')
      return result
    }
    const catalog = await loadAceTaskCatalog(root, [], { scoringExporter: staleExporter })
    const variant = catalog.tasks[0]?.variants[0]

    expect(catalog.scoring?.primaryGrader).toMatchObject({
      available: false,
      authority: {
        status: 'mismatch',
        reason: 'source_digest_mismatch',
      },
    })
    expect(catalog.source.splitContract).toBeUndefined()
    expect(variant).toMatchObject({
      split: null,
      pythonAuthority: { status: 'mismatch', reason: 'source_digest_mismatch' },
    })
    expect(variant?.effectiveChecks).toBeUndefined()
  })

  it('keeps task cards usable but marks semantics unavailable when Python cannot load', async () => {
    await writePack('graded.json', [complete])
    const catalog = await loadAceTaskCatalog(root, [], {
      scoringExporter: async () => {
        throw new Error('fixture import failed')
      },
    })

    expect(catalog.tasks).toHaveLength(1)
    expect(catalog.tasks[0]?.taskBrief).toBe('Get the eligible refund.')
    expect(catalog.tasks[0]?.variants[0]).toMatchObject({
      split: null,
      pythonAuthority: { status: 'unavailable', reason: 'python_probe_failed' },
    })
    expect(catalog.scoring?.primaryGrader.available).toBe(false)
  })
})
