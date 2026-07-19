import type { ToolCall } from '../../shared/schema/types'
import { TraceBuilder } from '../build'
import {
  pytestFail,
  pytestPass,
  SWE_DEVELOPER_PROMPTS,
  SWE_EXTRA_ANALYSES,
  SWE_ITEMS,
  SWE_SYSTEM_PROMPTS,
  type SweItem,
} from '../content'
import {
  CANCELLED_RESULT,
  corruptJson,
  MALFORMED_RESULT,
  TIMEOUT_RESULT,
  truncateMidSentence,
} from '../failures'
import type { Rng } from '../rng'
import type { FailureRegion, Scenario, ScenarioOutput } from '../types'

function bashArgs(cmd: string): string {
  return JSON.stringify({ command: cmd })
}

function analysisFor(item: SweItem, i: number, rng: Rng): string {
  return i < item.analyses.length ? item.analyses[i] : rng.pick(SWE_EXTRA_ANALYSES)
}

export const swebench: Scenario = (plan, rng): ScenarioOutput => {
  const item = SWE_ITEMS[(plan.instanceIdx - 1) % SWE_ITEMS.length]
  const extra = {
    success_criteria: `all ${item.testsTotal} pytest tests in ${item.testFile} pass`,
  }
  const b = new TraceBuilder(plan.startMs, rng)
  const regions: FailureRegion[] = []
  b.system(rng.pick(SWE_SYSTEM_PROMPTS))
  b.developer(rng.pick(SWE_DEVELOPER_PROMPTS))
  b.user(`[${item.repo}] ${item.title}\n\n${item.body}`)

  const failure = plan.failure
  const success =
    failure === null || failure === 'tool_timeout_retry' || failure === 'malformed_tool_json'
      ? plan.success
      : false

  const exploreCount = failure === 'budget_exceeded' ? rng.int(5, 7) : rng.int(1, 4)
  const timeoutAt = failure === 'tool_timeout_retry' ? rng.int(0, exploreCount - 1) : -1
  const malformedAt = failure === 'malformed_tool_json' ? rng.int(0, exploreCount - 1) : -1
  const stopAfter = plan.executing ? rng.int(1, exploreCount) : -1

  for (let i = 0; i < exploreCount; i++) {
    const ex = item.explores[i % item.explores.length]
    b.analysis(analysisFor(item, i, rng))
    const args = bashArgs(ex.cmd)
    if (i === malformedAt) {
      const bad = corruptJson(args, rng)
      const call = b.toolCall('bash', bad, { malformed: true })
      regions.push({ messageIndex: b.lastIndex, text: bad })
      b.toolResult(call, MALFORMED_RESULT, { isError: true, durationMs: rng.int(5, 40) })
      const retry = b.toolCall('bash', args)
      b.toolResult(retry, ex.out)
    } else if (i === timeoutAt) {
      const call = b.toolCall('bash', args)
      b.toolResult(call, TIMEOUT_RESULT, { isError: true, durationMs: 30000 })
      const retry = b.toolCall('bash', args)
      if (rng.bernoulli(0.3)) {
        b.toolResult(retry, TIMEOUT_RESULT, { isError: true, durationMs: 30000 })
      } else {
        b.toolResult(retry, ex.out)
      }
    } else {
      const call = b.toolCall('bash', args)
      b.toolResult(call, ex.out)
    }
    if (i + 1 === stopAfter) {
      return { messages: b.messages, score: null, status: 'executing', extra, truncated: false }
    }
  }

  if (failure === 'cancelled') {
    b.analysis(rng.pick(SWE_EXTRA_ANALYSES))
    const call = b.toolCall('bash', bashArgs(item.testCmd))
    b.toolResult(call, CANCELLED_RESULT, { isError: true, durationMs: rng.int(200, 4000) })
    return { messages: b.messages, score: null, status: 'failed', extra, truncated: false }
  }

  if (failure === 'budget_exceeded') {
    b.analysis(rng.pick(SWE_EXTRA_ANALYSES))
    b.toolCall('bash', bashArgs(item.testCmd))
    return {
      messages: b.messages,
      score: 0,
      status: 'completed',
      rewardDetails: { tests_passed: 0, tests_total: item.testsTotal },
      extra: { ...extra, end_reason: 'budget_exceeded' },
      truncated: false,
    }
  }

  const failErr = pytestFail(
    item.testFile,
    item.testName,
    item.failErr,
    item.testsTotal - 1,
    item.testsTotal,
  )
  if (success && rng.bernoulli(0.7)) {
    b.analysis('Reproducing the failure first so the fix can be verified against a red baseline.')
    const pre: ToolCall = b.toolCall('bash', bashArgs(item.testCmd))
    b.toolResult(pre, failErr)
  }

  b.analysis(analysisFor(item, exploreCount, rng))
  const edit = b.toolCall(
    'str_replace_editor',
    JSON.stringify({
      command: 'str_replace',
      path: item.editPath,
      old_str: item.oldStr,
      new_str: item.newStr,
    }),
  )
  b.toolResult(edit, `The file ${item.editPath} has been edited successfully.`, {
    durationMs: rng.int(40, 300),
  })

  b.analysis('Running the target test suite to check the fix.')
  const run = b.toolCall('bash', bashArgs(item.testCmd))
  const passed = success ? item.testsTotal : rng.int(0, item.testsTotal - 1)
  b.toolResult(
    run,
    success
      ? pytestPass(item.testFile, item.testsTotal)
      : pytestFail(item.testFile, item.testName, item.failErr, passed, item.testsTotal),
  )

  const summary = success ? item.summary : item.failSummary
  if (failure === 'truncation') {
    b.final(truncateMidSentence(summary, rng))
    return {
      messages: b.messages,
      score: 0,
      status: 'completed',
      rewardDetails: { tests_passed: passed, tests_total: item.testsTotal },
      extra,
      truncated: true,
    }
  }

  b.final(summary)
  if (failure === 'wrong_answer') {
    regions.push({ messageIndex: b.lastIndex, text: summary.split(' — ')[0] })
  }
  return {
    messages: b.messages,
    score: success ? 1 : 0,
    status: 'completed',
    rewardDetails: { tests_passed: passed, tests_total: item.testsTotal },
    extra,
    truncated: false,
    failureRegions: regions,
  }
}
