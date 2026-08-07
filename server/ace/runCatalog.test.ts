import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AceRunCatalog, readAceBatch } from './runCatalog'

describe('ACE live batch catalog', () => {
  const fixtures: string[] = []

  afterEach(async () => {
    await Promise.all(fixtures.splice(0).map((directory) => fs.rm(directory, { recursive: true })))
  })

  it('keeps scheduled episode states separate from completed grade totals', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ace-live-batch-'))
    fixtures.push(directory)
    const manifestPath = path.join(directory, 'batch.json')
    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        schema_version: 3,
        batch_id: 'live-run',
        run_kind: 'debug',
        schedule_digest: 'schedule-live',
        lineage: {
          relation: 'fresh_task_rerun',
          parent_trace_uid: 'simulation:parent:trace-1',
          parent_source_trace_id: 'trace-1',
          parent_run_id: 'parent',
          fidelity: 'scenario_fresh_rerun_state_regenerated',
          state_exact: false,
          config_exact: false,
          llm_exact: false,
          policy_changed: true,
        },
        lifecycle: {
          status: 'running',
          heartbeat_at: '2026-08-06T02:03:04Z',
        },
        episode_states: [
          {
            scenario_id: 'scenario-running',
            environment_seed: 1,
            file: 'scenario-running-s1.json',
            status: 'running',
            phase: 'tool_execution',
            tool_name: 'get_order_details',
            message_count: 5,
            updated_at: '2026-08-06T02:03:03Z',
          },
          {
            scenario_id: 'scenario-done',
            environment_seed: 2,
            file: 'scenario-done-s2.json',
            status: 'running',
            phase: 'model_response',
            message_count: 3,
          },
        ],
        totals: {
          episodes: 1,
          passed: 1,
          failed_grade: 0,
          error_state: 0,
        },
        episodes: [
          {
            scenario_id: 'scenario-done',
            environment_seed: 2,
            seed: 2,
            file: 'scenario-done-s2.json',
            status: 'completed',
            grade: {
              passed: true,
              checks: [{ name: 'OUTCOME', ok: true, gating: true }],
            },
          },
        ],
      }),
    )

    const batch = await readAceBatch(manifestPath)

    expect(batch).toMatchObject({
      runId: 'live-run',
      runKind: 'debug',
      schemaVersion: 3,
      manifestAvailable: true,
      controlsAvailable: true,
      lifecycle: 'running',
      updatedAt: '2026-08-06T02:03:04Z',
      lineage: {
        relation: 'fresh_task_rerun',
        parentTraceUid: 'simulation:parent:trace-1',
        parentSourceTraceId: 'trace-1',
        parentRunId: 'parent',
        fidelity: 'scenario_fresh_rerun_state_regenerated',
        stateExact: false,
        configExact: false,
        llmExact: false,
        policyChanged: true,
      },
      totals: {
        episodes: 2,
        passed: 1,
        failedGrade: 0,
        runtimeErrors: 0,
      },
    })
    expect(batch.episodes).toEqual([
      expect.objectContaining({
        scenarioId: 'scenario-running',
        status: 'running',
        phase: 'tool_execution',
        toolName: 'get_order_details',
        messageCount: 5,
        outcome: 'ungraded',
      }),
      expect.objectContaining({
        scenarioId: 'scenario-done',
        status: 'completed',
        outcome: 'pass',
      }),
    ])
  })

  it("keeps runtime, invalid, cancelled, and pending states out of each other's denominator", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ace-live-outcomes-'))
    fixtures.push(directory)
    const manifestPath = path.join(directory, 'batch.json')
    const episode = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
      scenario_id: id,
      environment_seed: 1,
      file: `${id}-s1.json`,
      status,
      ...extra,
    })
    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        schema_version: 3,
        batch_id: 'outcome-run',
        run_kind: 'scored',
        lifecycle: { status: 'running' },
        // This intentionally models a producer rolling counter whose
        // error_state includes every not-completed unit. The viewer must use
        // mutually exclusive episode states instead.
        totals: { episodes: 5, passed: 9, failed_grade: 9, error_state: 4 },
        episode_states: [
          episode('passed', 'completed'),
          episode('invalid', 'completed'),
          episode('runtime', 'failed'),
          episode('cancelled', 'cancelled'),
          episode('pending', 'running'),
        ],
        episodes: [
          episode('passed', 'completed', {
            grade: { passed: true, checks: [] },
            user_sim_attempts: 1,
            user_sim_invalid_attempts: 0,
          }),
          episode('invalid', 'completed', {
            invalid_user_sim: true,
            grade: null,
            user_sim_attempts: 2,
            user_sim_invalid_attempts: 1,
          }),
          episode('runtime', 'failed', { grade: { passed: true, checks: [] } }),
          episode('cancelled', 'cancelled'),
        ],
      }),
    )

    const batch = await readAceBatch(manifestPath)

    expect(batch.totals).toMatchObject({
      episodes: 5,
      passed: 1,
      failedGrade: 0,
      runtimeErrors: 1,
      invalidUserSim: 1,
      userSimAttempts: null,
      invalidUserSimAttempts: null,
      passRate: 1,
      userSimValidityRate: null,
      userSimAttemptValidityRate: null,
    })
    expect(batch.episodes?.map((row) => row.outcome)).toEqual([
      'pass',
      'invalid',
      'runtime_error',
      'ungraded',
      'ungraded',
    ])
  })

  it('never lets a partial state array shrink the declared scheduled denominator', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ace-partial-schedule-'))
    fixtures.push(directory)
    const manifestPath = path.join(directory, 'batch.json')
    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        schema_version: 3,
        batch_id: 'partial-schedule',
        run_kind: 'scored',
        lifecycle: { status: 'running' },
        totals: { episodes: 45 },
        episode_states: Array.from({ length: 10 }, (_, index) => ({
          scenario_id: `scenario-${index}`,
          environment_seed: 1,
          file: `scenario-${index}-s1.json`,
          status: 'running',
        })),
        episodes: [],
      }),
    )

    const batch = await readAceBatch(manifestPath)

    expect(batch.totals.episodes).toBe(45)
    expect(batch.episodes).toHaveLength(10)
    expect(batch.lifecycle).toBe('running')
  })

  it('reports attempt totals only when every parsed episode has both counters', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ace-complete-attempts-'))
    fixtures.push(directory)
    const manifestPath = path.join(directory, 'batch.json')
    const episode = (
      id: string,
      attempts: number | undefined,
      invalidAttempts: number | undefined,
    ) => ({
      scenario_id: id,
      environment_seed: 1,
      file: `${id}-s1.json`,
      status: 'completed',
      grade: { passed: true, checks: [] },
      ...(attempts === undefined ? {} : { user_sim_attempts: attempts }),
      ...(invalidAttempts === undefined ? {} : { user_sim_invalid_attempts: invalidAttempts }),
    })
    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        schema_version: 3,
        batch_id: 'complete-attempts',
        run_kind: 'scored',
        lifecycle: { status: 'completed' },
        totals: { episodes: 2, user_sim_validity_rate: 0.99 },
        episode_states: [],
        episodes: [episode('a', 2, 1), episode('b', 1, 0)],
      }),
    )

    const complete = await readAceBatch(manifestPath)
    expect(complete.totals).toMatchObject({
      userSimAttempts: 3,
      invalidUserSimAttempts: 1,
      userSimValidityRate: 2 / 3,
      userSimAttemptValidityRate: 2 / 3,
    })

    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        schema_version: 3,
        batch_id: 'partial-attempts',
        run_kind: 'scored',
        lifecycle: { status: 'completed' },
        totals: { episodes: 2, user_sim_validity_rate: 0.99 },
        episode_states: [],
        episodes: [episode('a', 2, 1), episode('b', 1, undefined)],
      }),
    )
    const partial = await readAceBatch(manifestPath)
    expect(partial.totals).toMatchObject({
      userSimAttempts: null,
      invalidUserSimAttempts: null,
      userSimValidityRate: null,
      userSimAttemptValidityRate: null,
    })
  })

  it('serves a last-good run snapshot during a temporary malformed manifest', async () => {
    const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ace-last-good-'))
    fixtures.push(runRoot)
    const runDirectory = path.join(runRoot, 'safe-run')
    await fs.mkdir(runDirectory)
    const manifestPath = path.join(runDirectory, 'batch.json')
    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        schema_version: 3,
        batch_id: 'safe-run',
        run_kind: 'counterfactual',
        lifecycle: { status: 'running' },
        episode_states: [],
        episodes: [],
        totals: { episodes: 0 },
      }),
    )
    const catalog = new AceRunCatalog()

    const fresh = await catalog.list(runRoot)
    expect(fresh).toEqual([expect.objectContaining({ runId: 'safe-run' })])
    expect(fresh[0]).not.toHaveProperty('staleManifest')
    await fs.writeFile(manifestPath, '{partial')
    expect(await catalog.list(runRoot)).toEqual([
      expect.objectContaining({
        runId: 'safe-run',
        runKind: 'counterfactual',
        staleManifest: true,
        manifestError: expect.any(String),
      }),
    ])
  })
})
