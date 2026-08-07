import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ParsedTrace } from '../../shared/connectors/types'
import { SearchIndex } from '../search/searchIndex'
import { DataRootManager } from '../store/dataRootManager'
import { TraceStore } from '../store/traceStore'
import { aceTasksRoutes } from './aceTasks'
import type { RouteCtx } from './context'

function parsedTrace(runId: string): ParsedTrace {
  return {
    meta: {
      traceId: `${runId}-trace`,
      sourceTraceId: `${runId}-trace`,
      corpusId: 'simulation',
      runId,
      instanceId: 'scenario-01',
      pairKey: 'schedule:scenario-01:7',
      component: 'ace/sealed',
      status: 'completed',
      timestamp: '2026-08-06T20:00:00.000Z',
      checkpointStep: 0,
      split: 'test',
      sourceFormat: 'agent-conversation',
      extra: { run_kind: 'scored' },
    },
    messages: [],
    warnings: [],
  }
}

describe('ACE task routes', () => {
  let root: string
  let store: TraceStore

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ace-task-routes-'))
    await fs.mkdir(path.join(root, 'configs', 'scenarios'), { recursive: true })
    await fs.mkdir(path.join(root, 'configs', 'rubrics'), { recursive: true })
    await fs.mkdir(path.join(root, 'src', 'ace'), { recursive: true })
    await fs.writeFile(
      path.join(root, 'src', 'ace', 'scenario.py'),
      `def _grade_checks():
    """Current source contract."""

def grade_atomic():
    """Binary gate product."""
`,
    )
    await fs.writeFile(
      path.join(root, 'configs', 'rubrics', 'semantic_verifier_v1.md'),
      '# Semantic shadow\n',
    )
    await fs.writeFile(
      path.join(root, 'configs', 'scenarios', 'sealed.json'),
      JSON.stringify([
        {
          scenario_id: 'scenario-01',
          suite: 'sealed',
          journey_id: null,
          journey_step: 0,
          card: {
            issue: 'cancel_order',
            language: 'en',
            id_knowledge: 'exact',
            patience: 4,
            persistence: 'pushes_back',
            style: [],
            order_id: 'order_1',
            goal: 'Cancel the order before it ships.',
            adversarial: false,
          },
          expected_actions: [{ name: 'cancel_order' }],
          forbidden_actions: [],
          expected_outcome: 'cancel',
          reward_basis: ['ACTIONS'],
          authorized_effects: [],
          required_info: [],
          expected_state_delta: [],
          must_precede: [],
          consent_required: true,
          promise_check: false,
          user_script: [],
        },
      ]),
    )
    store = new TraceStore()
    store.upsert(parsedTrace('baseline-chat'), path.join(root, 'baseline.json'))
    store.upsert(parsedTrace('optimized-chat'), path.join(root, 'optimized.json'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  function app(projectRoot = root) {
    const dataRootManager = new DataRootManager(store, [])
    const ctx: RouteCtx = {
      store,
      searchIndex: new SearchIndex(store),
      dataRoots: [],
      dataRootManager,
      importDir: path.join(root, 'imports'),
    }
    const value = express()
    value.use(aceTasksRoutes(ctx, { projectRoot }))
    return value
  }

  it('lists and filters normalized task cards without exposing an absolute path', async () => {
    const response = await request(app()).get(
      '/api/ace/tasks?suite=sealed&issue=cancel_order&language=en&persona=pushes_back',
    )
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      total: 1,
      filteredTotal: 1,
      source: {
        project: 'ACE',
        directory: 'configs/scenarios',
        schemaContract: 'src/ace/evaluation/scenarios.py::Scenario',
        readOnly: true,
        authority: 'current_worktree_catalog',
        traceDefinitionAuthority: 'trace_bound_snapshot_only',
      },
      items: [
        {
          scenarioId: 'scenario-01',
          taskBrief: 'Cancel the order before it ships.',
          traceCoverage: {
            traceCount: 2,
            exploratoryTraceCount: 0,
            runCount: 2,
            matchedPairCount: 1,
            compareRunIds: ['baseline-chat', 'optimized-chat'],
            status: {
              status: 'ungraded',
              outcomes: {
                pass: 0,
                fail: 0,
                invalid: 0,
                runtime_error: 0,
                ungraded: 2,
              },
              scoredDenominator: 0,
            },
          },
        },
      ],
    })
    expect(JSON.stringify(response.body)).not.toContain(root)
  })

  it('returns the complete definition by scenario id and a clear 404', async () => {
    const response = await request(app()).get('/api/ace/tasks/scenario-01')
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      scenarioId: 'scenario-01',
      conflict: false,
      variants: [
        {
          expectedOutcome: 'cancel',
          expectedActions: [{ name: 'cancel_order' }],
          consentRequired: true,
          promiseCheck: false,
          split: null,
          pythonAuthority: {
            status: 'unavailable',
            reason: 'python_probe_failed',
          },
        },
      ],
      scoring: {
        primaryGrader: {
          file: 'src/ace/evaluation/grading/atomic.py',
          available: false,
          symbol: 'src/ace/evaluation/grading/atomic.py::grade_atomic',
          gating: true,
          authority: { status: 'unavailable', reason: 'python_probe_failed' },
        },
        splitResolver: {
          available: false,
          symbol: 'src/ace/simulation/environment/database.py::Database.split_of',
        },
        shadowRubrics: [
          {
            file: 'configs/rubrics/semantic_verifier_v1.md',
            kind: 'semantic',
            gating: false,
            content: '# Semantic shadow\n',
          },
        ],
      },
      runCoverage: expect.arrayContaining([
        expect.objectContaining({ runId: 'baseline-chat', traceCount: 1 }),
      ]),
    })

    const missing = await request(app()).get('/api/ace/tasks/not-present')
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: 'ACE task not found' })
  })

  it('does not leak the configured project path when the fixed catalog is unavailable', async () => {
    const missingRoot = path.join(root, 'private', 'not-present')
    const response = await request(app(missingRoot)).get('/api/ace/tasks')
    expect(response.status).toBe(503)
    expect(response.body.error).toBe('ACE task catalog unavailable')
    expect(JSON.stringify(response.body)).not.toContain(missingRoot)
  })
})
