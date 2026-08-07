import { describe, expect, it } from 'vitest'
import { applyAceArtifacts, parseAceBatchManifest } from './aceSidecar'
import type { ParsedTrace } from './types'

function parsed(): ParsedTrace {
  return {
    meta: {
      traceId: 'episode-s7',
      instanceId: 'episode-s7',
      component: 'conversations/beta',
      status: 'unknown',
      timestamp: '2026-01-01T00:00:00.000Z',
      checkpointStep: 0,
      split: 'unknown',
      sourceFormat: 'agent-conversation',
    },
    messages: [
      {
        id: 'm-0',
        role: 'user',
        content: 'please refund',
        rawIndex: 0,
        chronologicalIndex: 0,
      },
      {
        id: 'm-1',
        role: 'assistant',
        content: 'it is done',
        rawIndex: 1,
        chronologicalIndex: 1,
      },
    ],
    warnings: [],
  }
}

describe('ACE artifacts', () => {
  it('normalizes live episode_states and projects the pending phase onto a partial trace', () => {
    const batch = parseAceBatchManifest({
      schema_version: 3,
      batch_id: 'live-run',
      schedule_digest: 'live-schedule',
      config_snapshot: { run_kind: 'scored', max_messages: 40 },
      scenario_snapshot: [
        {
          scenario_id: 'episode-s7',
          expected_outcome: 'refund',
          expected_actions: [{ name: 'issue_refund' }],
          canary: 'CANARY::never-project',
        },
      ],
      lifecycle: { status: 'running', heartbeat_at: '2026-08-06T01:02:03Z' },
      episode_states: [
        {
          scenario_id: 'episode-s7',
          environment_seed: 7,
          file: 'episode-s7.json',
          status: 'running',
          phase: 'tool_execution',
          tool_name: 'get_order_details',
          message_count: 4,
          updated_at: '2026-08-06T01:02:02Z',
        },
        {
          scenario_id: 'finished-s8',
          environment_seed: 8,
          file: 'finished-s8.json',
          status: 'running',
          phase: 'model_response',
          message_count: 3,
        },
      ],
      episodes: [
        {
          scenario_id: 'finished-s8',
          environment_seed: 8,
          file: 'finished-s8.json',
          status: 'completed',
          grade: { passed: true },
        },
      ],
    })

    expect(batch).toMatchObject({
      lifecycle: 'running',
      heartbeat: '2026-08-06T01:02:03Z',
      episodes: [
        {
          phase: 'tool_execution',
          toolName: 'get_order_details',
          messageCount: 4,
        },
        { status: 'completed', gradePassed: true },
      ],
    })

    const trace = applyAceArtifacts(parsed(), undefined, {
      batch,
      sourceFile: 'episode-s7.json',
    })
    expect(trace.meta).toMatchObject({
      status: 'executing',
      extra: {
        pending_phase: 'tool_execution: get_order_details',
        pending_tool_name: 'get_order_details',
        message_count: 4,
        config_snapshot: { run_kind: 'scored', max_messages: 40 },
        scenario_snapshot: {
          scenario_id: 'episode-s7',
          expected_outcome: 'refund',
          expected_actions: [{ name: 'issue_refund' }],
        },
        scenario_snapshot_provenance: 'batch_manifest',
      },
    })
    expect(JSON.stringify(trace.meta.extra)).not.toContain('CANARY')
    expect(trace.evaluation?.lifecycle).toMatchObject({
      state: 'executing',
      pendingPhase: 'tool_execution: get_order_details',
    })
    expect(trace.evaluation?.outcome).toBe('ungraded')
  })

  it('normalizes the complete sidecar without mixing shadow findings into grade gating', () => {
    const batch = parseAceBatchManifest({
      schema_version: 2,
      batch_id: 'arm-a',
      config_digest: 'config-a',
      schedule_digest: 'schedule-a',
      spec: { prompt: 'optimized', transport: 'chat' },
      episodes: [
        {
          scenario_id: 'scenario-a',
          environment_seed: 7,
          file: 'episode-s7.json',
          status: 'completed',
          termination: 'hangup',
          split: 'holdout',
          suite: 'sealed',
          issue: 'refund',
          language: 'en',
          grade: { passed: false },
        },
      ],
    })
    const trace = applyAceArtifacts(
      parsed(),
      {
        meta: {
          component: 'sim/sealed',
          extra: {
            scenario_id: 'scenario-a',
            environment_seed: 7,
            journey_id: 'journey-a',
            journey_step: 2,
          },
        },
        statsOverrides: { score: 0 },
        evaluation: {
          grade: {
            passed: false,
            checks: [
              { name: 'OUTCOME', ok: false, gating: true, detail: 'state unchanged' },
              { name: 'CONSENT', ok: false, gating: false, detail: 'soft diagnostic' },
            ],
          },
          metrics: { status: 'completed', tool_unknown_outcomes: 1 },
          flags: [
            {
              detector: 'unsupported_completion',
              idx: 1,
              severity: 'major',
              tier: 'hard_fact',
              family: 'agent',
              note: 'claim has no matching write',
            },
          ],
          spec: { prompt: 'optimized', transport: 'chat' },
        },
        episode_record: {
          world_diff: [{ order_id: 'order_1', field: 'status', before: 'open', after: 'open' }],
          ledger: [
            {
              tier: 'beta',
              name: 'issue_refund',
              args: { order_id: 'order_1' },
              ok: false,
              result: 'Error: response lost',
              executed: true,
              outcome_known: false,
              actual_result: { success: true },
              ts: 10,
            },
          ],
        },
        user_sim_gate: {
          invalid: false,
          environment_seed: 7,
          user_sample_nonce: 8,
          violations: [{ rule: 'repetition', idx: 0, severity: 'minor' }],
        },
        judge: {
          model: 'claude-test',
          rubric_version: 'judge_v2',
          dimensions: { resolution: { verdict: 'fail', evidence: 'not resolved' } },
          outcome_second_opinion: { verdict: 'fail', evidence: 'world unchanged' },
          disagreement: false,
        },
        semantic_verify: {
          schema_version: 1,
          mode: 'shadow',
          engine: 'deterministic-first',
          claims: [
            {
              kind: 'action_done',
              verdict: 'contradicted',
              message_index: 1,
              quote: 'it is done',
            },
          ],
          contradicted_count: 1,
          findings: [
            {
              detector: 'contradicted_claim',
              idx: 1,
              severity: 'major',
              tier: 'semantic_shadow',
              evidence: 'it is done',
            },
          ],
        },
        lineage: {
          parent_trace_uid: 'trace_parent',
          checkpoint_id: 'cp-2',
          fidelity: 'counterfactual',
        },
      },
      { batch, sourceFile: 'episode-s7.json' },
    )

    expect(trace.meta).toMatchObject({
      component: 'sim/sealed',
      instanceId: 'scenario-a',
      pairKey: 'schedule-a:scenario-a:7',
      status: 'completed',
      split: 'test',
      extra: {
        prompt: 'optimized',
        transport: 'chat',
        suite: 'sealed',
        issue: 'refund',
        language: 'en',
        journey_id: 'journey-a',
        journey_step: 2,
      },
    })
    expect(trace.evaluation).toMatchObject({
      lifecycle: { state: 'completed', termination: 'hangup' },
      outcome: 'fail',
      checks: [
        { name: 'OUTCOME', ok: false, gating: true },
        { name: 'CONSENT', ok: false, gating: false },
      ],
      worldDiff: [{ orderId: 'order_1', field: 'status', before: 'open', after: 'open' }],
      ledger: [
        {
          name: 'issue_refund',
          ok: false,
          executed: true,
          outcomeKnown: false,
          actualResult: { success: true },
        },
      ],
      lineage: { parentTraceUid: 'trace_parent', checkpointId: 'cp-2' },
    })
    expect(trace.evaluation?.failures.map((failure) => failure.origin)).toEqual(
      expect.arrayContaining(['grader', 'detector', 'tool', 'user_sim', 'judge', 'semantic']),
    )
    expect(
      trace.evaluation?.failures.find((failure) => failure.code === 'contradicted_claim'),
    ).toMatchObject({ gating: false, messageId: 'm-1', rawIndex: 1, chronologicalIndex: 1 })
    expect(trace.messages[1].metadata?.aceFailures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'unsupported_completion',
          origin: 'detector',
          severity: 'major',
        }),
        expect.objectContaining({ code: 'contradicted_claim', origin: 'semantic' }),
      ]),
    )
    expect(trace.evaluation?.judge?.dimensions.resolution.verdict).toBe('fail')
    expect(trace.evaluation?.semanticVerify?.claims[0]).toMatchObject({
      messageId: 'm-1',
      rawIndex: 1,
      chronologicalIndex: 1,
    })
  })

  it('projects versioned provenance, numeric checkpoints, lineage, and review ground truth', () => {
    const trace = applyAceArtifacts(parsed(), {
      meta: { extra: { scenario_id: 'scenario-provenance', environment_seed: 9 } },
      episode_record: {
        world_diff: [{ order_id: 'order-1', field: 'status', before: 'open', after: 'cancelled' }],
      },
      provenance: {
        schema_version: 1,
        run_kind: 'counterfactual',
        config_digest: 'config-v3',
        schedule_digest: 'schedule-v3',
        pair_key: 'schedule-v3:scenario-provenance:9',
        prompt_digests: { bot: 'prompt-sha' },
        tool_digest: 'tools-sha',
        model_digest: 'model-sha',
        models: { bot_model: 'test-model' },
        config_snapshot: { spec: { transport: 'responses' } },
        scenario_snapshot: {
          scenario_id: 'scenario-provenance',
          expected_outcome: 'cancel',
          canary: 'CANARY::do-not-show',
        },
        world: { initial_digest: 'before', final_digest: 'after' },
        checkpoint: { enabled: true, archive: 'episode.checkpoints.json' },
        usage: { cost_usd: 0.01 },
        lineage: {
          parent_trace_uid: 'trace-parent',
          checkpoint_id: 3,
          fork_message_count: 8,
          mode: 'counterfactual',
          policy_changed: true,
          fidelity: 'state_exact_policy_changed_future_generation_nondeterministic',
        },
      },
    })

    expect(trace.meta).toMatchObject({
      instanceId: 'scenario-provenance',
      pairKey: 'schedule-v3:scenario-provenance:9',
      extra: {
        config_digest: 'config-v3',
        schedule_digest: 'schedule-v3',
        run_kind: 'counterfactual',
        prompt_digests: { bot: 'prompt-sha' },
        tool_digest: 'tools-sha',
        model_digest: 'model-sha',
        scenario_snapshot: {
          scenario_id: 'scenario-provenance',
          expected_outcome: 'cancel',
        },
        groundTruth: {
          scenario: {
            scenario_id: 'scenario-provenance',
            expected_outcome: 'cancel',
          },
          world: { initial_digest: 'before', final_digest: 'after' },
        },
      },
    })
    expect(trace.meta.extra?.scenario_snapshot).not.toHaveProperty('canary')
    expect(trace.evaluation?.lineage).toMatchObject({
      parentTraceUid: 'trace-parent',
      checkpointId: '3',
      forkMessageCount: 8,
      mode: 'counterfactual',
      policyChanged: true,
      runKind: 'counterfactual',
      configDigest: 'config-v3',
    })
  })
})
