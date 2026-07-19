import { TraceBuilder } from '../build'
import {
  HUGE_TASK,
  hugeLogLine,
  pad2,
  TERM_ANALYSES,
  TERM_DEVELOPER_PROMPTS,
  TERM_ITEMS,
  TERM_SYSTEM_PROMPTS,
} from '../content'
import {
  CANCELLED_RESULT,
  corruptJson,
  MALFORMED_RESULT,
  TIMEOUT_RESULT,
  truncateMidSentence,
} from '../failures'
import type { Rng } from '../rng'
import type { FailureRegion, Scenario, ScenarioOutput, TracePlan } from '../types'

function bashArgs(cmd: string): string {
  return JSON.stringify({ command: cmd })
}

const HUGE_ROUNDS = 400
const HUGE_LINES_PER_ROUND = 84

function hugeTrace(plan: TracePlan, rng: Rng): ScenarioOutput {
  const b = new TraceBuilder(plan.startMs, rng)
  b.system(rng.pick(TERM_SYSTEM_PROMPTS))
  b.developer(rng.pick(TERM_DEVELOPER_PROMPTS))
  b.user(HUGE_TASK)
  b.analysis(
    'Twenty-four hosts, one at a time through the bastion. Plan: for each host pull the recent slice of each February daily log, count ERROR and slow-query lines as I go, and keep a running tally for the final per-host summary.',
  )
  for (let i = 0; i < HUGE_ROUNDS; i++) {
    const host = `web-${pad2(1 + (i % 24))}`
    const day = 1 + (Math.floor(i / 24) % 28)
    if (i > 0 && i % 48 === 0) {
      b.analysis(
        `Hosts up to ${host} scanned so far. Error density is holding under 6% except on the hosts serving /api/v2/traces/search; noting those for the summary and continuing.`,
        rng.int(400, 1200),
      )
    }
    const call = b.toolCall(
      'bash',
      bashArgs(
        `ssh ${host} tail -n ${HUGE_LINES_PER_ROUND} /var/log/app/app-2026-02-${pad2(day)}.log`,
      ),
      { durationMs: rng.int(150, 600) },
    )
    const lines: string[] = []
    for (let j = 0; j < HUGE_LINES_PER_ROUND; j++) lines.push(hugeLogLine(rng, day))
    b.toolResult(call, lines.join('\n'), { durationMs: rng.int(300, 2500) })
  }
  const check = b.toolCall('bash', bashArgs('wc -l /tmp/audit-summary.tsv'))
  b.toolResult(check, '24 /tmp/audit-summary.tsv', { durationMs: rng.int(20, 120) })
  b.final(
    'Audit complete: 400 log slices pulled across the 24 web hosts covering February. ERROR spikes cluster on the search route (web-07, web-13, web-19 worst, up to 6% of lines during the 02-14 to 02-16 window); slow-query warnings track the same hosts. Per-host tallies written to /tmp/audit-summary.tsv, one row per host.',
  )
  return {
    messages: b.messages,
    score: 1,
    status: 'completed',
    rewardDetails: { checker: 1 },
    extra: {
      success_criteria: 'checker: /tmp/audit-summary.tsv holds one summary row per host (24 lines)',
    },
    truncated: false,
  }
}

export const terminalBench: Scenario = (plan, rng): ScenarioOutput => {
  if (plan.huge) return hugeTrace(plan, rng)

  const item = TERM_ITEMS[(plan.instanceIdx - 1) % TERM_ITEMS.length]
  const extra = {
    success_criteria: `checker \`${item.checkCmd}\` prints "${item.checkPass}"`,
  }
  const b = new TraceBuilder(plan.startMs, rng)
  const regions: FailureRegion[] = []
  b.system(rng.pick(TERM_SYSTEM_PROMPTS))
  b.developer(rng.pick(TERM_DEVELOPER_PROMPTS))
  b.user(item.task)
  b.analysis(TERM_ANALYSES[0])

  const failure = plan.failure
  const success =
    failure === null || failure === 'tool_timeout_retry' || failure === 'malformed_tool_json'
      ? plan.success
      : false

  const roundCount =
    failure === 'budget_exceeded' ? rng.int(7, 9) : Math.min(rng.int(3, 9), item.rounds.length)
  const timeoutAt = failure === 'tool_timeout_retry' ? rng.int(0, roundCount - 1) : -1
  const malformedAt = failure === 'malformed_tool_json' ? rng.int(0, roundCount - 1) : -1
  const stopAfter = plan.executing ? rng.int(1, roundCount) : -1

  for (let i = 0; i < roundCount; i++) {
    const round = item.rounds[i % item.rounds.length]
    if (i > 0 && rng.bernoulli(0.3)) {
      b.analysis(rng.pick(TERM_ANALYSES), rng.int(400, 3000))
    }
    const args = bashArgs(round.cmd)
    if (i === malformedAt) {
      const bad = corruptJson(args, rng)
      const call = b.toolCall('bash', bad, { malformed: true })
      regions.push({ messageIndex: b.lastIndex, text: bad })
      b.toolResult(call, MALFORMED_RESULT, { isError: true, durationMs: rng.int(5, 40) })
      const retry = b.toolCall('bash', args)
      b.toolResult(retry, round.out)
    } else if (i === timeoutAt) {
      const call = b.toolCall('bash', args)
      b.toolResult(call, TIMEOUT_RESULT, { isError: true, durationMs: 30000 })
      const retry = b.toolCall('bash', args)
      if (rng.bernoulli(0.3)) {
        b.toolResult(retry, TIMEOUT_RESULT, { isError: true, durationMs: 30000 })
      } else {
        b.toolResult(retry, round.out)
      }
    } else {
      const call = b.toolCall('bash', args)
      b.toolResult(call, round.out)
    }
    if (i + 1 === stopAfter) {
      return { messages: b.messages, score: null, status: 'executing', extra, truncated: false }
    }
  }

  if (failure === 'cancelled') {
    const call = b.toolCall('bash', bashArgs(item.checkCmd))
    b.toolResult(call, CANCELLED_RESULT, { isError: true, durationMs: rng.int(200, 4000) })
    return { messages: b.messages, score: null, status: 'failed', extra, truncated: false }
  }

  if (failure === 'budget_exceeded') {
    b.analysis(rng.pick(TERM_ANALYSES), rng.int(400, 3000))
    b.toolCall('bash', bashArgs(item.checkCmd))
    return {
      messages: b.messages,
      score: 0,
      status: 'completed',
      rewardDetails: { checker: 0 },
      extra: { ...extra, end_reason: 'budget_exceeded' },
      truncated: false,
    }
  }

  b.analysis(TERM_ANALYSES[4], rng.int(400, 3000))
  const check = b.toolCall('bash', bashArgs(item.checkCmd))
  b.toolResult(check, success ? item.checkPass : item.checkFail, {
    durationMs: rng.int(20, 400),
  })

  const summary = success ? item.summary : item.failSummary
  if (failure === 'truncation') {
    b.final(truncateMidSentence(summary, rng))
    return {
      messages: b.messages,
      score: 0,
      status: 'completed',
      rewardDetails: { checker: 0 },
      extra,
      truncated: true,
    }
  }

  b.final(summary)
  if (failure === 'wrong_answer') {
    regions.push({ messageIndex: b.lastIndex, text: summary })
  }
  return {
    messages: b.messages,
    score: success ? 1 : 0,
    status: 'completed',
    rewardDetails: { checker: success ? 1 : 0 },
    extra,
    truncated: false,
    failureRegions: regions,
  }
}
