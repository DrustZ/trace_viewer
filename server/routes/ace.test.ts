import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express, { type ErrorRequestHandler } from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ParsedTrace } from '../../shared/connectors/types'
import { AceLaunchLineageStore } from '../ace/launchLineageStore'
import { SearchIndex } from '../search/searchIndex'
import { TraceStore } from '../store/traceStore'
import { type AceRouteBridge, type AceRouteConfig, aceRoutes } from './ace'
import type { RouteCtx } from './context'

interface BridgeCall {
  command: string
  params: Record<string, unknown>
  timeoutMs?: number
}

class FakeBridge implements AceRouteBridge {
  calls: BridgeCall[] = []
  starts: Array<{ runId: string; params: Record<string, unknown> }> = []
  responses = new Map<string, unknown>()
  activeEntries = new Map<string, { pid: number | undefined; startedAt: string }>()

  call<T>(command: string, params: Record<string, unknown>, timeoutMs?: number): Promise<T> {
    this.calls.push({ command, params, timeoutMs })
    const fallback =
      command === 'control'
        ? { run_id: params.runId, control: { desired_state: params.command } }
        : command === 'checkpoints'
          ? {
              checkpoints: [{ id: 0, phase: 'await_bot', branchable: true }],
              capabilities: { exact_fork: true },
              cockpit_fork: { missing: [] },
              source: { checkpoint_path: params.checkpointPath },
            }
          : { ok: true }
    return Promise.resolve((this.responses.get(command) ?? fallback) as T)
  }

  start(runId: string, params: Record<string, unknown>) {
    this.starts.push({ runId, params })
    return { runId, startedAt: '2026-08-06T20:00:00.000Z' }
  }

  active(runId: string) {
    return this.activeEntries.get(runId) ?? null
  }

  activeRunIds(): string[] {
    return [...this.activeEntries.keys()]
  }
}

function traceFixture(
  traceId: string,
  corpusId: 'production' | 'simulation',
  runId: string,
): ParsedTrace {
  return {
    meta: {
      traceId,
      sourceTraceId: traceId,
      corpusId,
      runId,
      instanceId: 'scenario-01',
      component: 'ace/test',
      status: 'completed',
      timestamp: '2026-08-06T20:00:00.000Z',
      checkpointStep: 0,
      split: 'test',
      sourceFormat: 'agent-conversation',
      extra: { environment_seed: 3 },
    },
    messages: [{ id: 'm-0', role: 'user', content: 'help' }],
    warnings: [],
  }
}

const jsonErrorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  const candidate = error as { status?: unknown; message?: unknown }
  const status = typeof candidate.status === 'number' ? candidate.status : 500
  res.status(status).json({ error: String(candidate.message ?? 'internal error') })
}

function buildApp(
  store: TraceStore,
  bridge: FakeBridge,
  config: AceRouteConfig,
  launchLineage = new AceLaunchLineageStore(path.join(config.projectRoot, 'lineage.jsonl')),
) {
  const ctx: RouteCtx = {
    store,
    searchIndex: new SearchIndex(store),
    dataRoots: [],
    importDir: path.join(config.projectRoot, 'imports'),
  }
  const app = express()
  app.use(express.json())
  app.use(aceRoutes(ctx, config, bridge, launchLineage))
  app.use(jsonErrorHandler)
  return app
}

describe('ACE cockpit routes', () => {
  let root: string
  let config: AceRouteConfig
  let store: TraceStore
  let bridge: FakeBridge

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-viewer-ace-routes-'))
    config = {
      projectRoot: root,
      runRoot: path.join(root, 'runs', 'episodes'),
      python: path.join(root, '.venv', 'bin', 'python'),
    }
    await fs.mkdir(config.runRoot, { recursive: true })
    store = new TraceStore()
    bridge = new FakeBridge()
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  async function addTrace(
    traceId: string,
    corpusId: 'production' | 'simulation',
    runId: string,
    extension = '.json',
    aceOwned = false,
  ) {
    const sourcePath = aceOwned
      ? path.join(
          root,
          corpusId === 'production' ? 'data' : path.join('runs', 'episodes'),
          runId,
          `${traceId}${extension}`,
        )
      : path.join(root, runId, `${traceId}${extension}`)
    await fs.mkdir(path.dirname(sourcePath), { recursive: true })
    await fs.writeFile(sourcePath, '{}')
    const trace = store.upsert(traceFixture(traceId, corpusId, runId), sourcePath)
    return { sourcePath, traceUid: trace.meta.traceUid as string }
  }

  it('aggregates repeated exact run ids and rejects unsafe scope before analysis', async () => {
    await addTrace('trace-a', 'simulation', 'run-a')
    await addTrace('trace-a-long', 'simulation', 'run-a-long')
    await addTrace('trace-production', 'production', 'production')
    bridge.responses.set('analyze', {
      bundle: {
        schema_version: 1,
        traces: {
          'trace-production': {
            language: 'English',
            issues: ['delivery'],
            failures: [
              {
                code: 'PRODUCTION_FINDING',
                severity: 'major',
                raw_index: 0,
                source: { tier: 'hard_fact', family: 'agent' },
              },
            ],
          },
        },
      },
    })
    const app = buildApp(store, bridge, config)

    const response = await request(app).get(
      '/api/ace/dashboard?runId=run-a&runId=production&runId=run-a',
    )
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      total: 2,
      pass: 0,
      fail: 0,
      ungraded: 2,
      scope: {
        mode: 'selected',
        requestedRunIds: ['run-a', 'production'],
        selectedRunIds: ['run-a', 'production'],
        unmatchedRunIds: [],
      },
      failureCodes: [{ code: 'PRODUCTION_FINDING', count: 1 }],
      detectorTiers: [{ code: 'hard_fact', count: 1 }],
    })
    expect(response.body.scope.availableRuns).toMatchObject([
      { runId: 'production', traces: 1, corpusIds: ['production'], runKind: 'production' },
      { runId: 'run-a', traces: 1, corpusIds: ['simulation'], runKind: 'scored' },
      { runId: 'run-a-long', traces: 1, corpusIds: ['simulation'], runKind: 'scored' },
    ])
    expect(bridge.calls.filter((call) => call.command === 'analyze')).toHaveLength(1)

    const missing = await request(app).get('/api/ace/dashboard?runId=missing')
    expect(missing.status).toBe(200)
    expect(missing.body).toMatchObject({
      total: 0,
      scope: {
        mode: 'selected',
        selectedRunIds: [],
        unmatchedRunIds: ['missing'],
      },
    })
    // The resolved analysis promise is cached across scoped snapshots.
    expect(bridge.calls.filter((call) => call.command === 'analyze')).toHaveLength(1)

    const unsafe = await request(app).get('/api/ace/dashboard?runId=../escape')
    expect(unsafe.status).toBe(400)
    expect(bridge.calls.filter((call) => call.command === 'analyze')).toHaveLength(1)
  })

  it('returns every exact-run trace uncapped and reconciles it against the manifest schedule', async () => {
    const scheduled = await addTrace('scheduled-s1', 'simulation', 'reconcile-run', '.json', true)
    const orphan = await addTrace('orphan-s1', 'simulation', 'reconcile-run', '.json', true)
    const batchDirectory = path.join(config.runRoot, 'reconcile-run')
    await fs.writeFile(
      path.join(batchDirectory, 'batch.json'),
      JSON.stringify({
        schema_version: 3,
        batch_id: 'reconcile-run',
        run_kind: 'debug',
        lifecycle: { status: 'completed' },
        totals: { episodes: 2, cost_usd: 0.4 },
        episode_states: [
          {
            scenario_id: 'scenario-01',
            environment_seed: 1,
            file: 'scheduled-s1.json',
            status: 'completed',
          },
          {
            scenario_id: 'scenario-02',
            environment_seed: 2,
            file: 'missing-s2.json',
            status: 'completed',
          },
        ],
        episodes: [],
      }),
    )
    const app = buildApp(store, bridge, config)

    const response = await request(app).get('/api/ace/runs/reconcile-run')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      runId: 'reconcile-run',
      runKind: 'debug',
      traces: [
        { traceUid: orphan.traceUid, sourceTraceId: 'orphan-s1' },
        { traceUid: scheduled.traceUid, sourceTraceId: 'scheduled-s1' },
      ],
      reconciliation: {
        scheduledEpisodes: 2,
        manifestEpisodes: 2,
        ingestedTraces: 2,
        matchedTraces: 1,
        pendingTraceFiles: 0,
        missingTerminalTraces: 1,
        orphanTraces: 1,
      },
    })
    expect(response.body.episodes[0].traceUid).toBe(scheduled.traceUid)
    expect(response.body.episodes[1].traceUid).toBeUndefined()
  })

  it('exposes a scheduled running run before its first trace without calling it ungraded', async () => {
    const batchDirectory = path.join(config.runRoot, 'batch-only')
    await fs.mkdir(batchDirectory)
    await fs.writeFile(
      path.join(batchDirectory, 'batch.json'),
      JSON.stringify({
        schema_version: 3,
        batch_id: 'batch-only',
        run_kind: 'scored',
        lifecycle: { status: 'running', heartbeat_at: '2026-08-06T20:00:00Z' },
        totals: { episodes: 2, cost_usd: 0.1 },
        episode_states: [
          {
            scenario_id: 'scenario-01',
            environment_seed: 1,
            file: 'scenario-01-s1.json',
            status: 'running',
          },
          {
            scenario_id: 'scenario-02',
            environment_seed: 1,
            file: 'scenario-02-s1.json',
            status: 'queued',
          },
        ],
        episodes: [],
      }),
    )
    const app = buildApp(store, bridge, config)

    const response = await request(app).get('/api/ace/dashboard')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      total: 0,
      ungraded: 0,
      scheduledEpisodes: 2,
      terminalEpisodes: 0,
      inProgressEpisodes: 2,
      awaitingTraceIngest: 0,
      totalCostUsd: 0.1,
      scope: {
        selectedRunIds: ['batch-only'],
        availableRuns: [
          {
            runId: 'batch-only',
            lifecycle: 'running',
            traces: 0,
            scheduledEpisodes: 2,
            inProgressEpisodes: 2,
          },
        ],
      },
    })
  })

  it('invalidates detector analysis only when the production source fingerprint changes', async () => {
    const production = await addTrace('production-cache', 'production', 'production')
    bridge.responses.set('analyze', {
      bundle: {
        schema_version: 1,
        traces: {
          'production-cache': {
            language: 'English',
            issues: ['delivery'],
            failures: [
              {
                code: 'CACHE_FINDING',
                severity: 'major',
                raw_index: 0,
                source: { tier: 'hard_fact', family: 'agent' },
              },
            ],
          },
        },
      },
    })
    const app = buildApp(store, bridge, config)
    const analyzeCalls = () => bridge.calls.filter((call) => call.command === 'analyze')

    expect((await request(app).get('/api/ace/analysis')).status).toBe(200)
    expect(analyzeCalls()).toHaveLength(1)
    // applyAceAnalysisBundle updated evaluation/meta/message projections, but
    // those detector outputs are not part of the source cache key.
    expect((await request(app).get('/api/ace/analysis')).status).toBe(200)
    expect(analyzeCalls()).toHaveLength(1)

    await addTrace('simulation-cache', 'simulation', 'batch-cache')
    expect((await request(app).get('/api/ace/analysis')).status).toBe(200)
    expect(analyzeCalls()).toHaveLength(1)

    const replacement = traceFixture('production-cache', 'production', 'production')
    replacement.messages[0].content = 'The production transcript changed.'
    store.upsert(replacement, production.sourcePath)
    expect((await request(app).get('/api/ace/analysis')).status).toBe(200)
    expect(analyzeCalls()).toHaveLength(2)
    expect((await request(app).get('/api/ace/analysis')).status).toBe(200)
    expect(analyzeCalls()).toHaveLength(2)

    const added = await addTrace('production-added', 'production', 'production')
    expect((await request(app).get('/api/ace/analysis')).status).toBe(200)
    expect(analyzeCalls()).toHaveLength(3)

    store.remove(added.sourcePath)
    expect((await request(app).get('/api/ace/analysis')).status).toBe(200)
    expect(analyzeCalls()).toHaveLength(4)
  })

  it('starts a run with translated fixed parameters and rejects injected fields', async () => {
    const app = buildApp(store, bridge, config)
    const response = await request(app)
      .post('/api/ace/runs')
      .send({
        scenarioFile: 'atomic.json',
        scenarioIds: ['scenario-01'],
        seeds: [3],
        batchId: 'safe-run',
        runKind: 'scored',
        prompt: 'baseline',
        transport: 'responses',
        maxMessages: 20,
        costCapUsd: 5,
      })

    expect(response.status).toBe(202)
    expect(response.body).toEqual({
      runId: 'safe-run',
      lifecycle: 'queued',
      startedAt: '2026-08-06T20:00:00.000Z',
      checkpoints: true,
    })
    expect(bridge.starts).toEqual([
      {
        runId: 'safe-run',
        params: {
          runId: 'safe-run',
          scenariosFile: 'atomic.json',
          scenarioIds: ['scenario-01'],
          seeds: [3],
          runKind: 'scored',
          promptPreset: 'baseline',
          transport: 'responses',
          maxMessages: 20,
          costCapUsd: 5,
        },
      },
    ])

    const rejected = await request(app)
      .post('/api/ace/runs')
      .send({
        scenarioFile: 'atomic.json',
        seeds: [3],
        batchId: 'safe-run-2',
        runKind: 'scored',
        prompt: 'baseline',
        transport: 'responses',
        maxMessages: 20,
        costCapUsd: 5,
        shellCommand: 'touch /tmp/owned',
      })
    expect(rejected.status).toBe(400)
    expect(bridge.starts).toHaveLength(1)
  })

  it('resolves and persists trusted fresh-rerun lineage without changing bridge semantics', async () => {
    const parent = await addTrace('parent-trace', 'simulation', 'parent-run')
    const launchLineage = new AceLaunchLineageStore(path.join(root, 'lineage.jsonl'))
    const app = buildApp(store, bridge, config, launchLineage)
    const response = await request(app)
      .post('/api/ace/runs')
      .send({
        scenarioFile: 'atomic.json',
        scenarioIds: ['scenario-01'],
        seeds: [3],
        batchId: 'fresh-child',
        runKind: 'counterfactual',
        prompt: 'optimized',
        transport: 'responses',
        maxMessages: 20,
        costCapUsd: 5,
        sourceTraceUid: parent.traceUid,
      })

    expect(response.status).toBe(202)
    expect(bridge.starts).toHaveLength(1)
    expect(bridge.starts[0]).toMatchObject({
      runId: 'fresh-child',
      params: {
        runId: 'fresh-child',
        scenariosFile: 'atomic.json',
        scenarioIds: ['scenario-01'],
        seeds: [3],
        runKind: 'counterfactual',
      },
    })
    expect(bridge.starts[0].params).not.toHaveProperty('checkpointPath')
    expect(bridge.starts[0].params).not.toHaveProperty('checkpointId')
    expect(bridge.starts[0].params).not.toHaveProperty('lineage')
    expect(await launchLineage.get('fresh-child')).toEqual({
      relation: 'fresh_task_rerun',
      parentTraceUid: parent.traceUid,
      parentSourceTraceId: 'parent-trace',
      parentRunId: 'parent-run',
      fidelity: 'scenario_fresh_rerun_state_regenerated',
      stateExact: false,
      configExact: false,
      llmExact: false,
      policyChanged: true,
    })
    bridge.activeEntries.set('fresh-child', {
      pid: 123,
      startedAt: '2026-08-06T20:00:00.000Z',
    })
    const catalog = await request(app).get('/api/ace/runs')
    expect(catalog.status).toBe(200)
    expect(catalog.body.items).toContainEqual(
      expect.objectContaining({
        runId: 'fresh-child',
        lineage: expect.objectContaining({
          relation: 'fresh_task_rerun',
          parentTraceUid: parent.traceUid,
        }),
      }),
    )

    const production = await addTrace('production-parent', 'production', 'production')
    const rejectedProduction = await request(app)
      .post('/api/ace/runs')
      .send({
        scenarioFile: 'atomic.json',
        scenarioIds: ['scenario-01'],
        seeds: [3],
        runKind: 'debug',
        prompt: 'baseline',
        transport: 'chat',
        maxMessages: 20,
        costCapUsd: 5,
        sourceTraceUid: production.traceUid,
      })
    expect(rejectedProduction.status).toBe(422)
    expect(rejectedProduction.body.error).toContain('runnable regression scenario')

    const mismatched = await request(app)
      .post('/api/ace/runs')
      .send({
        scenarioFile: 'atomic.json',
        scenarioIds: ['different-task'],
        seeds: [3],
        runKind: 'debug',
        prompt: 'baseline',
        transport: 'chat',
        maxMessages: 20,
        costCapUsd: 5,
        sourceTraceUid: parent.traceUid,
      })
    expect(mismatched.status).toBe(422)
    expect(mismatched.body).toMatchObject({ sourceScenarioId: 'scenario-01' })
    expect(bridge.starts).toHaveLength(1)

    const mismatchedSeed = await request(app)
      .post('/api/ace/runs')
      .send({
        scenarioFile: 'atomic.json',
        scenarioIds: ['scenario-01'],
        seeds: [4],
        runKind: 'debug',
        prompt: 'baseline',
        transport: 'chat',
        maxMessages: 20,
        costCapUsd: 5,
        sourceTraceUid: parent.traceUid,
      })
    expect(mismatchedSeed.status).toBe(422)
    expect(mismatchedSeed.body).toMatchObject({ sourceEnvironmentSeed: 3 })
    expect(bridge.starts).toHaveLength(1)
  })

  it('does not commit immutable lineage when the bridge rejects a launch', async () => {
    const firstParent = await addTrace('parent-one', 'simulation', 'parent-run-one')
    const secondParent = await addTrace('parent-two', 'simulation', 'parent-run-two')
    const launchLineage = new AceLaunchLineageStore(path.join(root, 'lineage-failure.jsonl'))
    const failingBridge = new FakeBridge()
    failingBridge.start = () => {
      throw new Error('spawn failed')
    }
    const failedApp = buildApp(store, failingBridge, config, launchLineage)
    const requestBody = {
      scenarioFile: 'atomic.json',
      scenarioIds: ['scenario-01'],
      seeds: [3],
      batchId: 'retryable-child',
      runKind: 'debug' as const,
      prompt: 'optimized',
      transport: 'responses' as const,
      maxMessages: 20,
      costCapUsd: 5,
    }

    const failed = await request(failedApp)
      .post('/api/ace/runs')
      .send({ ...requestBody, sourceTraceUid: firstParent.traceUid })

    expect(failed.status).toBe(500)
    expect(await launchLineage.get('retryable-child')).toBeUndefined()

    const retryBridge = new FakeBridge()
    const retryApp = buildApp(store, retryBridge, config, launchLineage)
    const retried = await request(retryApp)
      .post('/api/ace/runs')
      .send({ ...requestBody, sourceTraceUid: secondParent.traceUid })

    expect(retried.status).toBe(202)
    expect(await launchLineage.get('retryable-child')).toMatchObject({
      parentTraceUid: secondParent.traceUid,
      parentRunId: 'parent-run-two',
    })

    const conflictingBridge = new FakeBridge()
    const conflictingApp = buildApp(store, conflictingBridge, config, launchLineage)
    const conflicting = await request(conflictingApp)
      .post('/api/ace/runs')
      .send({ ...requestBody, sourceTraceUid: firstParent.traceUid })
    expect(conflicting.status).toBe(500)
    expect(conflictingBridge.starts).toHaveLength(0)
  })

  it('validates the run id before forwarding pause/resume/cancel', async () => {
    const app = buildApp(store, bridge, config)
    const paused = await request(app)
      .post('/api/ace/runs/safe-run/control')
      .send({ action: 'pause' })
    expect(paused.status).toBe(200)
    expect(paused.body).toMatchObject({ runId: 'safe-run', desiredState: 'pause' })
    expect(bridge.calls[0]).toMatchObject({
      command: 'control',
      params: { runId: 'safe-run', command: 'pause' },
    })

    const rejected = await request(app)
      .post('/api/ace/runs/not!safe/control')
      .send({ action: 'cancel' })
    expect(rejected.status).toBe(400)
    expect(bridge.calls).toHaveLength(1)
  })

  it('inspects checkpoints by canonical uid and redacts every returned path casing', async () => {
    const { sourcePath, traceUid } = await addTrace('episode-01', 'simulation', 'batch-a')
    const checkpointPath = sourcePath.replace(/\.json$/, '.checkpoints.json')
    await fs.writeFile(checkpointPath, '{}')
    bridge.responses.set('checkpoints', {
      checkpoints: [{ id: 1, phase: 'await_user', branchable: true }],
      capabilities: { exact_fork: true },
      cockpit_fork: { missing: [] },
      source: {
        checkpoint_path: checkpointPath,
        sidecarPath: path.join(root, 'private.meta.json'),
        parent_checkpoint: checkpointPath,
      },
    })
    const app = buildApp(store, bridge, config)

    const response = await request(app).get(`/api/ace/traces/${traceUid}/checkpoints`)
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      traceUid,
      available: true,
      historicalReplayAvailable: false,
      checkpoints: [{ id: 1, phase: 'await_user', branchable: true }],
      source: {
        checkpoint_path: 'episode-01.checkpoints.json',
        sidecarPath: 'private.meta.json',
        parent_checkpoint: 'episode-01.checkpoints.json',
      },
    })
    expect(JSON.stringify(response.body)).not.toContain(root)
    expect(bridge.calls[0]).toMatchObject({
      command: 'checkpoints',
      params: { checkpointPath },
    })
  })

  it('returns candidates for an ambiguous legacy trace id without choosing one', async () => {
    const first = await addTrace('duplicate', 'simulation', 'batch-a')
    const second = await addTrace('duplicate', 'simulation', 'batch-b')
    const app = buildApp(store, bridge, config)

    const response = await request(app).get('/api/ace/traces/duplicate/checkpoints')
    expect(response.status).toBe(409)
    expect(response.body).toEqual({
      error: 'legacy trace id is ambiguous',
      sourceTraceId: 'duplicate',
      candidates: [first.traceUid, second.traceUid].sort(),
    })
    expect(bridge.calls).toHaveLength(0)
  })

  it('keeps restore exact, counterfactual, and historical replay semantics distinct', async () => {
    const simulation = await addTrace('episode-02', 'simulation', 'batch-a')
    const production = await addTrace('production-02', 'production', 'prod')
    bridge.responses.set('replay', { fidelity: 'state_exact_no_execution' })
    bridge.responses.set('fork', {
      lineage: { parent_checkpoint: simulation.sourcePath.replace(/\.json$/, '.checkpoints.json') },
    })
    bridge.responses.set('historical-replay', {
      fidelity: 'historical_tool_replay',
      llm_exact_replay: false,
    })
    const app = buildApp(store, bridge, config)

    const restore = await request(app).post('/api/ace/replays').send({
      sourceTraceUid: simulation.traceUid,
      checkpointId: 2,
      mode: 'restore',
    })
    expect(restore.status).toBe(201)
    expect(bridge.calls.at(-1)).toMatchObject({
      command: 'replay',
      params: {
        checkpointPath: simulation.sourcePath.replace(/\.json$/, '.checkpoints.json'),
        checkpointId: 2,
      },
    })

    const exact = await request(app).post('/api/ace/replays').send({
      sourceTraceUid: simulation.traceUid,
      checkpointId: 1,
      mode: 'exact',
      childRunId: 'fork-exact',
      childTraceId: 'child-1',
      costCapUsd: 2,
    })
    expect(exact.status).toBe(201)
    expect(JSON.stringify(exact.body)).not.toContain(root)
    expect(bridge.calls.at(-1)).toMatchObject({
      command: 'fork',
      timeoutMs: 1_800_000,
      params: {
        childRunId: 'fork-exact',
        childTraceId: 'child-1',
        mode: 'exact',
        costCapUsd: 2,
        parentTraceUid: simulation.traceUid,
      },
    })

    const counterfactual = await request(app).post('/api/ace/replays').send({
      sourceTraceUid: simulation.traceUid,
      checkpointId: 0,
      mode: 'counterfactual',
      childRunId: 'fork-counterfactual',
      costCapUsd: 3,
      nextUserMessage: 'I changed my mind.',
      prompt: 'Use the revised local policy.',
      model: 'openai/gpt-5-mini',
      temperature: 0.4,
    })
    expect(counterfactual.status).toBe(201)
    expect(bridge.calls.at(-1)).toMatchObject({
      command: 'fork',
      params: {
        childRunId: 'fork-counterfactual',
        mode: 'counterfactual',
        nextUserMessage: 'I changed my mind.',
        promptText: 'Use the revised local policy.',
        model: 'openai/gpt-5-mini',
        temperature: 0.4,
      },
    })

    const historical = await request(app).post('/api/ace/replays').send({
      sourceTraceUid: production.traceUid,
      mode: 'historical_tools',
    })
    expect(historical.status).toBe(201)
    expect(bridge.calls.at(-1)).toMatchObject({
      command: 'historical-replay',
      params: { tracePath: production.sourcePath },
    })
  })

  it('rejects invalid or capability-crossing replay payloads before the bridge', async () => {
    const simulation = await addTrace('episode-03', 'simulation', 'batch-a')
    const app = buildApp(store, bridge, config)
    const cases = [
      {
        body: {
          sourceTraceUid: simulation.traceUid,
          mode: 'historical_tools',
        },
        status: 422,
      },
      {
        body: {
          sourceTraceUid: simulation.traceUid,
          mode: 'exact',
          costCapUsd: 1,
          prompt: 'override forbidden',
        },
        status: 400,
      },
      {
        body: {
          sourceTraceUid: simulation.traceUid,
          mode: 'counterfactual',
          costCapUsd: 1,
        },
        status: 400,
      },
      {
        body: {
          sourceTraceUid: simulation.traceUid,
          mode: 'counterfactual',
          costCapUsd: 1,
          model: 'bad\nmodel',
        },
        status: 400,
      },
      {
        body: {
          sourceTraceUid: simulation.traceUid,
          mode: 'counterfactual',
          costCapUsd: 1,
          temperature: 3,
        },
        status: 400,
      },
      {
        body: {
          sourceTraceUid: simulation.traceUid,
          mode: 'exact',
          costCapUsd: 1,
          childTraceId: '../escape',
        },
        status: 400,
      },
      {
        body: {
          sourceTraceUid: simulation.traceUid,
          mode: 'restore',
          checkpointId: -2,
        },
        status: 400,
      },
      {
        body: {
          sourceTraceUid: simulation.traceUid,
          mode: 'restore',
          checkpointId: 0,
          nextUserMessage: 'must not be silently ignored',
        },
        status: 400,
      },
    ]

    for (const testCase of cases) {
      const before = bridge.calls.length
      const response = await request(app).post('/api/ace/replays').send(testCase.body)
      expect(response.status, JSON.stringify(testCase.body)).toBe(testCase.status)
      expect(bridge.calls).toHaveLength(before)
    }
  })

  it('does not reinterpret a non-JSON durable source as its own checkpoint archive', async () => {
    const trace = await addTrace('episode-jsonl', 'simulation', 'batch-a', '.jsonl')
    const app = buildApp(store, bridge, config)

    const inspect = await request(app).get(`/api/ace/traces/${trace.traceUid}/checkpoints`)
    expect(inspect.status).toBe(200)
    expect(inspect.body).toMatchObject({ available: false, checkpoints: [] })

    const replay = await request(app).post('/api/ace/replays').send({
      sourceTraceUid: trace.traceUid,
      checkpointId: 0,
      mode: 'restore',
    })
    expect(replay.status).toBe(422)
    expect(bridge.calls).toHaveLength(0)
  })

  it('saves a validated chronological prefix through the fixed regression bridge only', async () => {
    const saved = await addTrace('episode-regression', 'simulation', 'batch-a', '.json', true)
    const lookup = store.lookup(saved.traceUid)
    if (lookup.kind !== 'found') throw new Error('fixture trace missing')
    lookup.stored.trace.messages = [
      {
        id: 'm-raw-1',
        role: 'assistant',
        content: 'hello',
        rawIndex: 1,
        chronologicalIndex: 0,
      },
      {
        id: 'm-raw-0',
        role: 'user',
        content: 'help',
        rawIndex: 0,
        chronologicalIndex: 1,
      },
    ]
    lookup.stored.trace.meta.extra = {
      scenario_snapshot: {
        scenario_id: 'scenario-01',
        card: {
          issue: 'order_status',
          language: 'en',
          id_knowledge: 'exact',
          patience: 4,
          persistence: 'accepts_refusal',
          style: [],
          order_id: 'order_1',
          goal: 'status',
        },
      },
      config_snapshot: { runner: { run_kind: 'debug' } },
    }
    bridge.responses.set('save-regression', {
      regression_id: 'regression-one',
      artifact_kind: 'runnable_scenario_pack',
      runnable: true,
      deduplicated: false,
      artifact: 'regressions/regression-one/manifest.json',
      scenario_pack: 'regressions/regression-one/scenario.json',
      draft: null,
      missing_required_fields: [],
      fidelity: { level: 'scenario_rerun_observed_user_script' },
      anchor: {
        kind: 'message_prefix',
        index_space: 'chronological',
        inclusive: true,
        message_id: 'm-raw-0',
        raw_index: 0,
        chronological_index: 1,
      },
    })
    const sourceBytes = await fs.readFile(saved.sourcePath)
    const app = buildApp(store, bridge, config)

    const capability = await request(app).get(
      `/api/ace/traces/${saved.traceUid}/regression-capability`,
    )
    expect(capability.status).toBe(200)
    expect(capability.body).toMatchObject({
      available: true,
      expectedArtifactKind: 'runnable_scenario_pack',
      scenarioSnapshotAvailable: true,
      messageCount: 2,
    })
    expect(JSON.stringify(capability.body)).not.toContain('scenario_id')

    const response = await request(app).post('/api/ace/regressions').send({
      sourceTraceUid: saved.traceUid,
      boundaryMessageId: 'm-raw-0',
      regressionId: 'regression-one',
    })
    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      regressionId: 'regression-one',
      runnable: true,
      artifactKind: 'runnable_scenario_pack',
      anchor: {
        kind: 'message_prefix',
        indexSpace: 'chronological',
        messageId: 'm-raw-0',
        rawIndex: 0,
        chronologicalIndex: 1,
      },
    })
    expect(bridge.calls.at(-1)).toMatchObject({
      command: 'save-regression',
      params: {
        tracePath: saved.sourcePath,
        sourceTraceUid: saved.traceUid,
        regressionId: 'regression-one',
        anchor: {
          kind: 'message_prefix',
          raw_index: 0,
          chronological_index: 1,
        },
        transcriptPrefix: [
          {
            id: 'm-raw-1',
            raw_index: 1,
            chronological_index: 0,
          },
          {
            id: 'm-raw-0',
            raw_index: 0,
            chronological_index: 1,
          },
        ],
      },
    })
    expect(await fs.readFile(saved.sourcePath)).toEqual(sourceBytes)

    const before = bridge.calls.length
    const rejected = await request(app)
      .post('/api/ace/regressions')
      .send({
        sourceTraceUid: saved.traceUid,
        outputPath: path.join(root, 'escape'),
      })
    expect(rejected.status).toBe(400)
    expect(bridge.calls).toHaveLength(before)
  })

  it('labels production save-as-regression without a snapshot as a draft capability', async () => {
    const production = await addTrace('production-regression', 'production', 'prod', '.json', true)
    const app = buildApp(store, bridge, config)

    const response = await request(app).get(
      `/api/ace/traces/${production.traceUid}/regression-capability`,
    )
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      available: true,
      expectedArtifactKind: 'regression_draft',
      scenarioSnapshotAvailable: false,
    })
    expect(response.body.explanation).toContain('non-runnable draft')
  })

  it('does not advertise regression writes for viewer traces outside fixed ACE roots', async () => {
    const ordinary = await addTrace('viewer-demo', 'simulation', 'demo-run')
    const app = buildApp(store, bridge, config)

    const capability = await request(app).get(
      `/api/ace/traces/${ordinary.traceUid}/regression-capability`,
    )
    expect(capability.status).toBe(200)
    expect(capability.body).toMatchObject({
      available: false,
      missing: ['ACE-owned data/runs source'],
    })
    const before = bridge.calls.length
    const save = await request(app).post('/api/ace/regressions').send({
      sourceTraceUid: ordinary.traceUid,
    })
    expect(save.status).toBe(422)
    expect(bridge.calls).toHaveLength(before)
  })
})
