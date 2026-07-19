import { TraceBuilder } from '../build'
import { LEET_ANALYSES, LEET_ITEMS, LEET_SYSTEM_PROMPTS } from '../content'
import { CANCELLED_RESULT, truncateMidSentence } from '../failures'
import type { Rng } from '../rng'
import type { FailureRegion, Scenario, ScenarioOutput } from '../types'

function caseResults(passed: number, total: number, failNote: string, rng: Rng): string {
  const lines = [`Running ${total} test cases...`]
  for (let i = 1; i <= total; i++) {
    if (i <= passed) lines.push(`case ${String(i).padStart(2, '0')}: PASS (${rng.int(2, 60)}ms)`)
    else lines.push(`case ${String(i).padStart(2, '0')}: FAIL — ${failNote}`)
  }
  lines.push(`${passed}/${total} cases passed`)
  return lines.join('\n')
}

export const leetcode: Scenario = (plan, rng): ScenarioOutput => {
  const item = LEET_ITEMS[(plan.instanceIdx - 1) % LEET_ITEMS.length]
  const extra = {
    ground_truth: item.groundTruth,
    golden_response: `Reference approach (passes all ${item.casesTotal} cases):\n\n\`\`\`python\n${item.solution}\n\`\`\``,
  }
  const b = new TraceBuilder(plan.startMs, rng)
  const regions: FailureRegion[] = []
  b.system(rng.pick(LEET_SYSTEM_PROMPTS))
  b.user(`${item.title}\n\n${item.statement}`)
  b.analysis(rng.shuffle(LEET_ANALYSES).slice(0, rng.int(2, 4)).join('\n\n'))

  const total = item.casesTotal
  let passed: number
  if (plan.failure === 'wrong_answer' || plan.failure === 'truncation') {
    passed = 0
  } else {
    const p = Math.min(1, Math.max(0, plan.pSuccess + rng.jitter(0.15)))
    passed = Math.min(total, Math.max(0, Math.round(p * total)))
  }
  const perfect = passed === total
  const code = perfect ? item.solution : item.buggy
  const args = JSON.stringify({ language: 'python3', code })
  const tool = rng.pick(['run_tests', 'execute_code'])

  const call = b.toolCall(tool, args)
  if (plan.executing) {
    return { messages: b.messages, score: null, status: 'executing', extra, truncated: false }
  }
  if (plan.failure === 'cancelled') {
    b.toolResult(call, CANCELLED_RESULT, { isError: true, durationMs: rng.int(200, 4000) })
    return { messages: b.messages, score: null, status: 'failed', extra, truncated: false }
  }

  b.toolResult(call, caseResults(passed, total, item.failNote, rng))

  const score = Math.round((passed / total) * 10000) / 10000
  const summary = perfect
    ? `All ${total} test cases pass. The approach runs in a single pass with a hash map, well within the constraints.`
    : `${passed}/${total} test cases pass. The failing cases hit the known weak spot: ${item.failNote}. A revised submission would need to fix that branch.`

  if (plan.failure === 'truncation') {
    b.final(truncateMidSentence(summary, rng))
    return {
      messages: b.messages,
      score: 0,
      status: 'completed',
      rewardDetails: { cases_passed: passed, cases_total: total },
      extra,
      truncated: true,
    }
  }

  b.final(summary)
  if (plan.failure === 'wrong_answer') {
    regions.push({ messageIndex: b.lastIndex, text: item.failNote })
  }
  return {
    messages: b.messages,
    score,
    status: 'completed',
    rewardDetails: { cases_passed: passed, cases_total: total },
    extra,
    truncated: false,
    failureRegions: regions,
  }
}
