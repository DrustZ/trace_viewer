/**
 * Generates the richer import fixtures under examples/ (deterministic — no RNG).
 * These exist to exercise the connectors + UI with realistic shapes: long
 * agentic sessions, heavy formatting, and the full metadata of the Anthropic
 * Messages API and the OpenAI Responses API.
 *
 * Run: npx tsx scripts/make-examples.ts
 */
import { writeFileSync } from 'node:fs'
import path from 'node:path'

const DIR = path.join(process.cwd(), 'examples')
const write = (name: string, value: unknown) => {
  writeFileSync(path.join(DIR, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  console.log(`wrote examples/${name}`)
}

// ---------------------------------------------------------------------------
// 1. Anthropic Messages API — extended thinking + tool cycles + full metadata.
//    Ref: https://platform.claude.com/docs/en/api/messages
// ---------------------------------------------------------------------------
function anthropicRich() {
  const messages: unknown[] = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'The checkout service p99 latency jumped from 120ms to 2.4s after the 14:00 deploy. Find the cause and propose a fix. You have read-only shell + the metrics API.',
        },
      ],
    },
    {
      role: 'assistant',
      content: [
        {
          type: 'thinking',
          thinking:
            'A latency jump right after a deploy points at the diff, a hot dependency, or a resource ceiling. Start by confirming the regression is deploy-correlated, then bisect: recent commits, DB, downstream calls. I should not mutate anything (read-only).',
        },
        {
          type: 'text',
          text: 'Let me confirm the regression is tied to the deploy before digging in.',
        },
        {
          type: 'tool_use',
          id: 'toolu_01a',
          name: 'metrics_query',
          input: {
            query: 'histogram_quantile(0.99, checkout_request_duration_seconds)',
            window: '1h',
            step: '1m',
          },
        },
      ],
    },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_01a',
          content:
            '14:01 -> 0.13s\n14:02 -> 0.14s\n14:03 -> 2.38s\n14:04 -> 2.41s\n... (step change persists)',
        },
      ],
    },
    {
      role: 'assistant',
      content: [
        {
          type: 'thinking',
          thinking:
            'Confirmed: a step change at 14:03, one minute after rollout finished. Now look at what the deploy changed. Check the release SHA and the diff around DB/query paths.',
        },
        {
          type: 'text',
          text: 'Regression is deploy-correlated (step change at 14:03). Checking what shipped.',
        },
        {
          type: 'tool_use',
          id: 'toolu_02a',
          name: 'bash',
          input: { command: 'git -C /srv/checkout log --oneline -5 v2.7.0..v2.7.1' },
        },
      ],
    },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_02a',
          content:
            'a1b2c3d perf: add per-item tax lookup\n9f8e7d6 chore: bump orm 5.2 -> 5.3\n4c5b6a7 feat: coupon stacking',
        },
      ],
    },
    {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'The "per-item tax lookup" is suspicious — a per-item call is a classic N+1. Let me check the query log for a fan-out.',
        },
        {
          type: 'tool_use',
          id: 'toolu_03a',
          name: 'bash',
          input: {
            command: "grep -c 'SELECT .* FROM tax_rates' /var/log/checkout/query.log | tail -1",
          },
        },
      ],
    },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_03a', content: '4127' }] },
    {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_04a',
          name: 'bash',
          input: {
            command: "grep 'SELECT .* FROM tax_rates' /var/log/checkout/query.log | head -1",
          },
        },
      ],
    },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_04a',
          content:
            'SELECT rate FROM tax_rates WHERE region=$1 AND sku=$2  -- 0.6ms  (x per cart item)',
        },
      ],
    },
    {
      role: 'assistant',
      content: [
        {
          type: 'thinking',
          thinking:
            '4127 identical single-row lookups per window — one query per (region, sku) per cart item. A 60-item cart = 60 round-trips × ~0.6ms + network = seconds. This is the N+1. Fix: batch the lookups into one IN-query, or cache the rate table (it is tiny and changes daily).',
        },
        {
          type: 'text',
          text: 'Confirmed root cause: an **N+1** in the new tax lookup — one `SELECT rate FROM tax_rates` per cart item. A large cart serializes dozens of round-trips.\n\n**Fix:** replace the per-item lookup with a single batched query and an in-process cache (the table is ~2k rows, refreshed daily):\n\n```python\n# before: per item\nrate = db.query("SELECT rate FROM tax_rates WHERE region=%s AND sku=%s", region, item.sku)\n\n# after: one query per cart, memoized\nskus = [i.sku for i in cart.items]\nrates = tax_rate_cache.get_many(region, skus)  # single IN(...) on miss\n```\n\nExpected p99 back to ~0.13s. Want me to open the PR against `v2.7.1`?',
        },
      ],
    },
    { role: 'user', content: [{ type: 'text', text: 'Yes, open the PR.' }] },
    {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_05a',
          name: 'open_pr',
          input: {
            repo: 'srv/checkout',
            base: 'main',
            title: 'perf(checkout): batch tax_rates lookup (fix N+1 p99 regression)',
            body: 'Replaces per-item tax_rates SELECT with a single batched query + daily-refreshed cache. Fixes the 14:00 p99 regression (2.4s -> ~0.13s).',
          },
        },
      ],
    },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_05a',
          content: '{"pr_url":"https://git.internal/srv/checkout/pull/842","checks":"queued"}',
        },
      ],
    },
    {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'Opened [PR #842](https://git.internal/srv/checkout/pull/842). Summary:\n\n- **Cause:** N+1 in the per-item tax lookup shipped in `a1b2c3d` (v2.7.1).\n- **Evidence:** 4,127 single-row `tax_rates` queries/min; p99 step change at 14:03.\n- **Fix:** batched IN-query + daily cache. CI checks queued.',
        },
      ],
    },
  ]
  return {
    id: 'msg_01RichSREDebug',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-4-20250514',
    system:
      'You are a senior SRE agent with read-only shell access and a Prometheus metrics API. Diagnose before you mutate; never run destructive commands.',
    messages,
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 5820,
      output_tokens: 1436,
      cache_creation_input_tokens: 2048,
      cache_read_input_tokens: 18294,
      service_tier: 'standard',
    },
    metadata: { user_id: 'user_9f3c1e77', session_id: 'sess_5b2a', incident: 'INC-4821' },
    service_tier: 'standard',
    container: null,
  }
}

// ---------------------------------------------------------------------------
// 2. OpenAI Responses API — reasoning items + function calls + full metadata.
//    Ref: https://developers.openai.com/api/docs/guides/text
// ---------------------------------------------------------------------------
function openaiResponsesRich() {
  return {
    id: 'resp_0xRichEval',
    object: 'response',
    created_at: 1_718_900_000,
    status: 'completed',
    model: 'gpt-5.1-2025',
    instructions:
      'You are a data analyst. Use the tools to answer with numbers you verified, not guesses.',
    input: [
      {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: 'Which of our three onboarding funnels has the worst step-2 drop-off this week, and by how much versus last week?',
          },
        ],
      },
    ],
    output: [
      {
        type: 'reasoning',
        id: 'rs_1',
        summary: [
          {
            type: 'summary_text',
            text: 'I need step-2 conversion per funnel for this week and last week, then the largest week-over-week drop. Query the warehouse for both windows, compute deltas, and rank.',
          },
        ],
      },
      {
        type: 'function_call',
        id: 'fc_1',
        call_id: 'call_a1',
        name: 'run_sql',
        arguments: JSON.stringify({
          sql: "SELECT funnel, week, step2_conv FROM funnel_daily WHERE week IN ('2024-W23','2024-W24') GROUP BY funnel, week",
        }),
      },
      {
        type: 'function_call_output',
        call_id: 'call_a1',
        output:
          'funnel_a W23 0.62 | funnel_a W24 0.60 | funnel_b W23 0.71 | funnel_b W24 0.54 | funnel_c W23 0.48 | funnel_c W24 0.47',
      },
      {
        type: 'reasoning',
        id: 'rs_2',
        summary: [
          {
            type: 'summary_text',
            text: 'Deltas: A -0.02, B -0.17, C -0.01. Funnel B has by far the worst drop. Confirm B is not a volume artifact before reporting.',
          },
        ],
      },
      {
        type: 'function_call',
        id: 'fc_2',
        call_id: 'call_b2',
        name: 'run_sql',
        arguments: JSON.stringify({
          sql: "SELECT week, sessions FROM funnel_daily WHERE funnel='funnel_b' AND week IN ('2024-W23','2024-W24')",
        }),
      },
      { type: 'function_call_output', call_id: 'call_b2', output: 'W23 41022 | W24 39877' },
      {
        type: 'message',
        id: 'msg_1',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: '**Funnel B** has the worst step-2 drop-off this week.\n\n| Funnel | W23 | W24 | Δ |\n|---|---|---|---|\n| A | 62% | 60% | −2pp |\n| **B** | **71%** | **54%** | **−17pp** |\n| C | 48% | 47% | −1pp |\n\nB fell **17 points** week-over-week on stable volume (41,022 → 39,877 sessions), so this is a real conversion regression, not a traffic artifact. A and C are within noise.',
          },
        ],
      },
    ],
    reasoning: { effort: 'high', summary: 'auto' },
    temperature: 0.2,
    top_p: 1,
    max_output_tokens: 2048,
    tools: [
      {
        type: 'function',
        name: 'run_sql',
        description: 'Run a read-only SQL query against the analytics warehouse.',
      },
    ],
    metadata: { run: 'eval-batch-7', reviewer: 'analytics-team' },
    usage: {
      input_tokens: 3820,
      input_tokens_details: { cached_tokens: 2560 },
      output_tokens: 940,
      output_tokens_details: { reasoning_tokens: 512 },
      total_tokens: 4760,
    },
  }
}

// ---------------------------------------------------------------------------
// 3. Native — a long (100-message) agentic terminal session, tool-use heavy.
// ---------------------------------------------------------------------------
function nativeLongAgent() {
  const messages: unknown[] = [
    {
      id: 'm0',
      role: 'system',
      content:
        'You are a terminal operations agent with root on a single Linux host. Investigate before mutating; prefer dry-runs; report what you changed.',
    },
    {
      id: 'm1',
      role: 'user',
      content:
        'The CI cache under /var/cache/ci has grown to ~410GB and is failing builds with ENOSPC. Reclaim space safely — do not delete anything referenced by the last 3 successful builds. Report exactly what you freed.',
    },
  ]
  const cmds = [
    ['df -h /var/cache/ci', 'Filesystem  Size Used Avail Use%\n/dev/nvme1  500G 486G  0G  100%'],
    ['du -sh /var/cache/ci/*', '210G artifacts\n120G docker-layers\n 61G npm\n 15G pip\n  4G misc'],
    [
      'ls -t /var/cache/ci/artifacts | head',
      'build-8841\nbuild-8840\nbuild-8839\nbuild-8838\nbuild-8837',
    ],
    ['cat /var/cache/ci/last_successful.txt', 'build-8841\nbuild-8840\nbuild-8839'],
    [
      'du -sh /var/cache/ci/artifacts/build-88{37,38,39,40,41}',
      '2.1G build-8837\n2.0G build-8838\n2.2G build-8839\n2.0G build-8840\n2.1G build-8841',
    ],
    ["find /var/cache/ci/artifacts -maxdepth 1 -type d -name 'build-*' | wc -l", '96'],
    ["find /var/cache/ci/artifacts -maxdepth 1 -type d -name 'build-*' -mtime +14 | wc -l", '71'],
    [
      "du -ch $(find /var/cache/ci/artifacts -maxdepth 1 -type d -name 'build-*' -mtime +14) | tail -1",
      '158G total',
    ],
    [
      'docker image ls --format "{{.Size}} {{.Repository}}:{{.Tag}}" | head',
      '1.9GB ci/base:latest\n1.8GB ci/base:prev\n900MB app:pr-812\n880MB app:pr-811',
    ],
    ['docker image ls -q --filter "dangling=true" | wc -l', '43'],
    [
      'docker system df',
      'Images 88GB (61GB reclaimable)\nContainers 2GB\nLocal Volumes 30GB (18GB reclaimable)',
    ],
    [
      'npm cache verify 2>&1 | tail -2',
      'Content verified: 40213 (61GB)\nCache size reduced by removing 12GB of unreferenced content',
    ],
    ['ls /var/cache/ci/pip/wheels | wc -l', '8841'],
    ['du -sh /var/cache/ci/misc', '4.0G /var/cache/ci/misc'],
    ['ls /var/cache/ci/misc', 'core.2231\ncore.2199\ntmp-uploads\nold-logs.tar'],
  ]
  let seq = 1
  let t = Date.parse('2024-06-06T09:00:00Z')
  const nextTs = (ms: number) => {
    t += ms
    return new Date(t).toISOString()
  }
  // Interleave: some reasoning, then a tool call + its result, repeated until ~100 msgs.
  let ci = 0
  while (messages.length < 98) {
    if (messages.length % 12 === 3) {
      messages.push({
        id: `m${messages.length}`,
        role: 'assistant',
        channel: 'analysis',
        content: `Working set so far looks dominated by old artifacts + dangling docker layers. Next I confirm what is safe to drop (older than 14d and not in last_successful) before removing anything.`,
        timestamp: nextTs(1200),
      })
    }
    const [command, output] = cmds[ci % cmds.length]
    ci++
    seq++
    const callId = `call_${seq}`
    messages.push({
      id: `m${messages.length}`,
      role: 'assistant',
      channel: 'commentary',
      content: '',
      toolCalls: [
        {
          id: callId,
          name: 'bash',
          arguments: JSON.stringify({ command }),
          parsedArguments: { command },
        },
      ],
      timestamp: nextTs(800),
    })
    messages.push({
      id: `m${messages.length}`,
      role: 'tool',
      content: output,
      toolResult: { toolCallId: callId, isError: false, durationMs: 120 + (ci % 7) * 90 },
      timestamp: nextTs(400 + (ci % 5) * 200),
    })
  }
  messages.push({
    id: `m${messages.length}`,
    role: 'assistant',
    channel: 'final',
    content:
      'Reclaimed **~200GB** safely:\n\n- Removed 71 artifact builds older than 14 days and not in `last_successful.txt` (**158G**).\n- `docker image prune` on 43 dangling layers + reclaimable volumes (**~30G**).\n- `npm cache` unreferenced content (**12G**).\n- Cleared `/var/cache/ci/misc` core dumps + `old-logs.tar` (**4G**).\n\nKept build-8839/8840/8841 (last 3 successful) untouched. `/var/cache/ci` now at 62% (was 100%). Builds unblocked.',
    timestamp: nextTs(1500),
  })

  return {
    meta: {
      traceId: 'example-long-agent-001',
      instanceId: 'ci-cache-cleanup',
      component: 'terminal/terminal-bench',
      status: 'completed',
      timestamp: '2024-06-06T09:00:00Z',
      checkpointStep: 300,
      split: 'test',
      sourceFormat: 'native',
      extra: {
        run: 'imported',
        end_reason: 'stop',
        reward_breakdown: { correctness: 1, length_penalty: -0.002, final_reward: 0.998 },
      },
    },
    stats: { score: 1, model: { name: 'claude-opus-4' } },
    messages,
  }
}

// ---------------------------------------------------------------------------
// 4. Native — heavy-formatting responses (tables, code, math, lists, quotes).
// ---------------------------------------------------------------------------
function nativeRichFormatting() {
  const md = (s: string) => s
  const messages: unknown[] = [
    {
      id: 'm0',
      role: 'system',
      content:
        'You are a machine-learning tutor. Answer with precise, well-formatted explanations: use tables, fenced code, and LaTeX where it helps.',
    },
    {
      id: 'm1',
      role: 'user',
      content:
        'Explain the bias–variance tradeoff and how it shows up when tuning the regularization strength λ in ridge regression.',
    },
    {
      id: 'm2',
      role: 'assistant',
      channel: 'final',
      content: md(
        'The **bias–variance tradeoff** decomposes expected test error into three parts:\n\n$$\\mathbb{E}\\big[(y-\\hat f(x))^2\\big] = \\underbrace{(\\text{Bias}[\\hat f])^2}_{\\text{underfit}} + \\underbrace{\\text{Var}[\\hat f]}_{\\text{overfit}} + \\underbrace{\\sigma^2}_{\\text{irreducible}}$$\n\nFor **ridge regression** you minimize\n\n$$\\hat\\beta_\\lambda = \\arg\\min_\\beta \\; \\lVert y - X\\beta \\rVert_2^2 + \\lambda \\lVert \\beta \\rVert_2^2.$$\n\nAs $\\lambda$ grows, coefficients shrink toward zero:\n\n| λ | Bias² | Variance | Test error |\n|---:|---:|---:|---:|\n| 0 (OLS) | low | **high** | high |\n| moderate | small | moderate | **minimum** |\n| ∞ | **high** | ~0 | high |\n\n- Small λ → flexible fit → **low bias, high variance**.\n- Large λ → stiff fit → **high bias, low variance**.\n- The sweet spot is the λ that minimizes *validation* error.\n\n> Rule of thumb: pick λ by k-fold CV on a log-spaced grid, then refit on all data.',
      ),
    },
    {
      id: 'm3',
      role: 'user',
      content: 'Show me the scikit-learn code to pick λ by cross-validation.',
    },
    {
      id: 'm4',
      role: 'assistant',
      channel: 'final',
      content: md(
        "Use `RidgeCV`, which does efficient leave-one-out CV over a grid:\n\n```python\nimport numpy as np\nfrom sklearn.linear_model import RidgeCV\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n\nalphas = np.logspace(-3, 3, 25)          # the λ grid (log-spaced)\nmodel = make_pipeline(\n    StandardScaler(),                     # ridge is not scale-invariant\n    RidgeCV(alphas=alphas, store_cv_values=True),\n)\nmodel.fit(X_train, y_train)\nprint('best alpha:', model[-1].alpha_)\n```\n\nTwo gotchas:\n\n1. **Always standardize** first — the $\\lambda\\lVert\\beta\\rVert^2$ penalty is not scale-invariant.\n2. Grid in **log space**; linear grids waste points.",
      ),
    },
    { id: 'm5', role: 'user', content: 'How is this different from Lasso?' },
    {
      id: 'm6',
      role: 'assistant',
      channel: 'final',
      content: md(
        'Different penalty → different behavior:\n\n| | Ridge (L2) | Lasso (L1) |\n|---|---|---|\n| Penalty | $\\lambda\\lVert\\beta\\rVert_2^2$ | $\\lambda\\lVert\\beta\\rVert_1$ |\n| Coefficients | shrink, stay nonzero | some become **exactly 0** |\n| Use when | many small effects | few strong effects (sparsity) |\n| Solution | closed-form | needs coordinate descent |\n\nIn short: **Ridge shrinks, Lasso selects.** If you want automatic feature selection, use Lasso (or Elastic Net to get both).',
      ),
    },
    {
      id: 'm7',
      role: 'user',
      content: 'Give me a quick diff to switch my snippet from RidgeCV to LassoCV.',
    },
    {
      id: 'm8',
      role: 'assistant',
      channel: 'final',
      content: md(
        '```diff\n-from sklearn.linear_model import RidgeCV\n+from sklearn.linear_model import LassoCV\n\n-    RidgeCV(alphas=alphas, store_cv_values=True),\n+    LassoCV(alphas=alphas, cv=5, max_iter=10000),\n```\n\nNote `LassoCV` uses k-fold `cv` (not LOO) and may need a higher `max_iter` to converge.',
      ),
    },
    { id: 'm9', role: 'user', content: 'Thanks — summarize when to reach for each in one line.' },
    {
      id: 'm10',
      role: 'assistant',
      channel: 'final',
      content:
        '**Ridge** when you believe *many* features each contribute a little; **Lasso** (or **Elastic Net**) when you expect *few* relevant features and want a sparse, interpretable model.',
    },
  ]
  return {
    meta: {
      traceId: 'example-rich-formatting-001',
      instanceId: 'ml-tutor-ridge',
      component: 'stem/nemotron-science',
      status: 'completed',
      timestamp: '2024-06-06T10:30:00Z',
      checkpointStep: 300,
      split: 'test',
      sourceFormat: 'native',
      extra: {
        run: 'imported',
        ground_truth:
          'Ridge (L2) shrinks coefficients; Lasso (L1) drives some to zero (feature selection). Tune λ by cross-validation on a log-spaced grid after standardizing.',
      },
    },
    stats: { score: 1, model: { name: 'claude-opus-4' } },
    messages,
  }
}

write('anthropic-messages-rich.json', anthropicRich())
write('openai-responses-rich.json', openaiResponsesRich())
write('native-long-agent.json', nativeLongAgent())
write('native-rich-formatting.json', nativeRichFormatting())
