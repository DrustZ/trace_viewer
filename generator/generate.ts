import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import type { Split, TraceMeta, TraceStats } from '../shared/schema/types'
import { finalizeTrace } from '../shared/stats/computeStats'
import { pad2 } from './content'
import { writeHarmony } from './emit/harmony'
import { writeNative } from './emit/native'
import { writeOpenAI } from './emit/openai'
import { pickFailure } from './failures'
import { attachLogprobs } from './logprobs'
import { hashSeed, mulberry32 } from './rng'
import { browsecomp } from './scenarios/browsecomp'
import { deepscalerMath } from './scenarios/deepscalerMath'
import { leetcode } from './scenarios/leetcode'
import { nemotronScience } from './scenarios/nemotronScience'
import { swebench } from './scenarios/swebench'
import { terminalBench } from './scenarios/terminalBench'
import type { Scenario, TracePlan } from './types'

export const BASE_TIMESTAMP = '2026-03-01T00:00:00.000Z'
const BASE_MS = Date.parse(BASE_TIMESTAMP)
// Dense checkpoint grid: a checkpoint every 5 steps (plus step 1), like a real
// training run. Each train instance samples a handful of them; across all
// instances nearly every checkpoint has rollouts, so reward curves read as
// continuous training progress. Test instances evaluate every 25 steps.
const TRAIN_STEP_POOL = [1, ...Array.from({ length: 60 }, (_, i) => (i + 1) * 5)]
const TEST_STEPS = Array.from({ length: 12 }, (_, i) => (i + 1) * 25)
const HUGE_TRACE_ID = 'termbench-ihuge-s150-r01'
const CORRUPT_FILE = 'native/corrupt-example.json'
const CORRUPT_CONTENT = '{"meta": {"traceId": "corrupt-'

interface ComponentDef {
  component: string
  short: string
  scenario: Scenario
}

const COMPONENTS: readonly ComponentDef[] = [
  { component: 'stem/deepscaler-math', short: 'deepscaler', scenario: deepscalerMath },
  { component: 'stem/nemotron-science', short: 'nemotron', scenario: nemotronScience },
  { component: 'swe/swebench-verified-mini', short: 'swebench', scenario: swebench },
  { component: 'terminal/terminal-bench', short: 'termbench', scenario: terminalBench },
  { component: 'code/leetcode', short: 'leetcode', scenario: leetcode },
  { component: 'search/browsecomp-plus', short: 'browsecomp', scenario: browsecomp },
]

function logistic(step: number, difficulty: number): number {
  return 1 / (1 + Math.exp(-(step - (20 + 280 * difficulty)) / 45))
}

/** Spreads n rollouts over `buckets` steps as evenly as possible, extras first. */
function distribute(n: number, buckets: number): number[] {
  const base = Math.floor(n / buckets)
  const extra = n % buckets
  return Array.from({ length: buckets }, (_, i) => base + (i < extra ? 1 : 0))
}

function buildPlans(seed: number, scale: number): TracePlan[] {
  const instances = Math.max(2, Math.round(10 * scale))
  const rollouts = Math.max(4, Math.round(16 * scale))
  const testCount = Math.max(1, Math.round(instances * 0.2))
  const plans: TracePlan[] = []

  for (const comp of COMPONENTS) {
    for (let n = 1; n <= instances; n++) {
      const instanceId = `${comp.short}-i${pad2(n)}`
      const split: Split = n > instances - testCount ? 'test' : 'train'
      const irng = mulberry32(hashSeed(seed, instanceId))
      const difficulty = irng.next()
      const steps =
        split === 'train'
          ? irng
              .shuffle(TRAIN_STEP_POOL)
              .slice(0, 5)
              .sort((a, b) => a - b)
          : TEST_STEPS
      const perStep = distribute(rollouts, steps.length)
      for (let si = 0; si < steps.length; si++) {
        const step = steps[si]
        for (let r = 1; r <= perStep[si]; r++) {
          const traceId = `${comp.short}-i${pad2(n)}-s${step}-r${pad2(r)}`
          const drng = mulberry32(hashSeed(seed, traceId, 'plan'))
          const pSuccess = logistic(step, difficulty)
          plans.push({
            component: comp.component,
            short: comp.short,
            instanceIdx: n,
            instanceId,
            traceId,
            split,
            step,
            startMs: BASE_MS + step * 3600000 + Math.floor(drng.next() * 1800000),
            pSuccess,
            success: drng.bernoulli(pSuccess),
            failure: drng.bernoulli(0.25) ? pickFailure(drng, comp.short) : null,
            executing: false,
            withLogprobs: drng.bernoulli(0.25),
            huge: false,
            emit: 'native',
          })
        }
      }
    }
  }

  const hugeRng = mulberry32(hashSeed(seed, HUGE_TRACE_ID, 'plan'))
  plans.push({
    component: 'terminal/terminal-bench',
    short: 'termbench',
    instanceIdx: 0,
    instanceId: 'termbench-ihuge',
    traceId: HUGE_TRACE_ID,
    split: 'train',
    step: 150,
    startMs: BASE_MS + 150 * 3600000 + Math.floor(hugeRng.next() * 1800000),
    pSuccess: 1,
    success: true,
    failure: null,
    executing: false,
    withLogprobs: false,
    huge: true,
    emit: 'native',
  })

  const master = mulberry32(hashSeed(seed, 'master'))
  // A finished experiment only contains completed/failed traces; `executing`
  // exists because the run is still in flight — so in-flight rollouts can only
  // live at the newest checkpoint (the training frontier).
  const frontierStep = Math.max(...plans.map((p) => p.step))
  const execCandidates = master.shuffle(
    plans.map((_, i) => i).filter((i) => !plans[i].huge && plans[i].step === frontierStep),
  )
  for (const idx of execCandidates.slice(0, 2)) {
    plans[idx].executing = true
    plans[idx].failure = null
  }
  for (const comp of COMPONENTS) {
    let candidates = plans.filter(
      (p) => p.short === comp.short && !p.huge && !p.executing && p.failure === null,
    )
    if (candidates.length < 2) {
      candidates = plans.filter((p) => p.short === comp.short && !p.huge && !p.executing)
    }
    const chosen = master.shuffle(candidates)
    if (chosen.length > 0) chosen[0].emit = 'harmony'
    if (chosen.length > 1) chosen[1].emit = 'openai'
  }
  return plans
}

export interface GenerateOptions {
  seed: number
  out: string
  scale: number
  quiet?: boolean
}

export interface GenerateSummary {
  totalBytes: number
  counts: {
    total: number
    byComponent: Record<string, number>
    bySplit: Record<string, number>
    byStatus: Record<string, number>
    byFailureKind: Record<string, number>
    withLogprobs: number
  }
  byComponentSplit: Record<string, Record<string, number>>
  showcase: { harmony: string[]; openai: string[] }
}

function bump(rec: Record<string, number>, key: string): void {
  rec[key] = (rec[key] ?? 0) + 1
}

export function runGenerate(opts: GenerateOptions): GenerateSummary {
  const { seed, out, scale } = opts
  for (const sub of ['native', 'harmony', 'openai']) {
    rmSync(join(out, sub), { recursive: true, force: true })
  }
  rmSync(join(out, 'manifest.json'), { force: true })
  mkdirSync(join(out, 'native'), { recursive: true })
  mkdirSync(join(out, 'harmony'), { recursive: true })
  mkdirSync(join(out, 'openai'), { recursive: true })

  const scenarioByShort = new Map(COMPONENTS.map((c) => [c.short, c.scenario]))
  const plans = buildPlans(seed, scale)

  const summary: GenerateSummary = {
    totalBytes: 0,
    counts: {
      total: 0,
      byComponent: {},
      bySplit: {},
      byStatus: {},
      byFailureKind: {},
      withLogprobs: 0,
    },
    byComponentSplit: {},
    showcase: { harmony: [], openai: [] },
  }

  for (const plan of plans) {
    const scenario = scenarioByShort.get(plan.short)
    if (!scenario) throw new Error(`no scenario for ${plan.short}`)
    const output = scenario(plan, mulberry32(hashSeed(seed, plan.traceId, 'content')))

    let gotLogprobs = false
    if (plan.withLogprobs && !plan.huge) {
      gotLogprobs = attachLogprobs(
        output.messages,
        mulberry32(hashSeed(seed, plan.traceId, 'logprobs')),
        output.failureRegions ?? [],
      )
    }

    const meta: TraceMeta = {
      traceId: plan.traceId,
      instanceId: plan.instanceId,
      component: plan.component,
      status: output.status,
      timestamp: new Date(plan.startMs).toISOString(),
      checkpointStep: plan.step,
      split: plan.split,
      sourceFormat:
        plan.emit === 'harmony' ? 'harmony' : plan.emit === 'openai' ? 'openai-chat' : 'native',
      ...(output.rewardDetails ? { rewardDetails: output.rewardDetails } : {}),
      ...(output.extra ? { extra: output.extra } : {}),
    }
    const overrides: Partial<TraceStats> = {
      score: output.score,
      truncated: output.truncated,
      model: {
        name: 'harmony-32b',
        contextWindow: 128000,
        temperature: plan.split === 'train' ? 1.0 : 0.6,
        topP: 0.95,
      },
    }
    const trace = finalizeTrace(meta, output.messages, overrides)

    if (plan.emit === 'harmony') {
      summary.totalBytes += writeHarmony(out, trace, overrides).bytes
      summary.showcase.harmony.push(plan.traceId)
    } else if (plan.emit === 'openai') {
      summary.totalBytes += writeOpenAI(out, trace).bytes
      summary.showcase.openai.push(plan.traceId)
    } else {
      summary.totalBytes += writeNative(out, trace).bytes
    }

    summary.counts.total += 1
    bump(summary.counts.byComponent, plan.component)
    bump(summary.counts.bySplit, plan.split)
    bump(summary.counts.byStatus, output.status)
    if (plan.failure) bump(summary.counts.byFailureKind, plan.failure)
    if (gotLogprobs) summary.counts.withLogprobs += 1
    summary.byComponentSplit[plan.component] ??= {}
    bump(summary.byComponentSplit[plan.component], plan.split)
  }

  writeFileSync(join(out, CORRUPT_FILE), CORRUPT_CONTENT)
  summary.totalBytes += Buffer.byteLength(CORRUPT_CONTENT)

  const manifest = {
    seed,
    base_timestamp: BASE_TIMESTAMP,
    counts: summary.counts,
    showcase: summary.showcase,
    huge_trace: HUGE_TRACE_ID,
    corrupt_file: CORRUPT_FILE,
    approx_bytes: summary.totalBytes,
    notes: [
      `${CORRUPT_FILE} is deliberately invalid JSON to exercise scanner tolerance; it is not a trace.`,
      `${HUGE_TRACE_ID} (instance termbench-ihuge) is a single-rollout ~3-4MB stress trace, exempt from the >=3-checkpoint-steps-per-instance convention.`,
      'Showcase traces exist only under harmony/ and openai/ — they are excluded from native/ so traceIds are unique across the corpus.',
    ],
  }
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  if (!opts.quiet) printSummary(summary)
  return summary
}

function printSummary(summary: GenerateSummary): void {
  const components = Object.keys(summary.byComponentSplit)
  const wide = Math.max(...components.map((c) => c.length), 9) + 2
  const row = (a: string, b: string | number, c: string | number, d: string | number) =>
    `${a.padEnd(wide)}${String(b).padStart(7)}${String(c).padStart(7)}${String(d).padStart(7)}`
  const lines: string[] = []
  lines.push(row('component', 'train', 'test', 'total'))
  lines.push('-'.repeat(wide + 21))
  for (const c of components) {
    const train = summary.byComponentSplit[c].train ?? 0
    const test = summary.byComponentSplit[c].test ?? 0
    lines.push(row(c, train, test, train + test))
  }
  lines.push('-'.repeat(wide + 21))
  lines.push(
    row(
      'all',
      summary.counts.bySplit.train ?? 0,
      summary.counts.bySplit.test ?? 0,
      summary.counts.total,
    ),
  )
  lines.push('')
  const failures = Object.entries(summary.counts.byFailureKind)
    .map(([k, v]) => `${k}=${v}`)
    .join('  ')
  lines.push(`failures: ${failures || 'none'}`)
  const statuses = Object.entries(summary.counts.byStatus)
    .map(([k, v]) => `${k}=${v}`)
    .join('  ')
  lines.push(`status:   ${statuses}`)
  lines.push(
    `logprobs: ${summary.counts.withLogprobs} traces  |  showcase: ${summary.showcase.harmony.length} harmony + ${summary.showcase.openai.length} openai`,
  )
  lines.push(`size:     ${(summary.totalBytes / (1024 * 1024)).toFixed(1)} MB (approx)`)
  console.log(lines.join('\n'))
}

const isMain =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const { values } = parseArgs({
    options: {
      seed: { type: 'string', default: '42' },
      out: { type: 'string', default: 'data/traces' },
      scale: { type: 'string', default: '1' },
    },
  })
  runGenerate({
    seed: Number(values.seed),
    out: values.out,
    scale: Number(values.scale),
  })
}
