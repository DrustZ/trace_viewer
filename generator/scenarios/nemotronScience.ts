import { padWithFillers, TraceBuilder } from '../build'
import {
  JUDGE_MODEL,
  judgeReasoning,
  SCIENCE_FILLERS,
  SCIENCE_ITEMS,
  SCIENCE_SYSTEM_PROMPTS,
} from '../content'
import { truncateMidSentence } from '../failures'
import type { FailureRegion, Scenario, ScenarioOutput } from '../types'

export const nemotronScience: Scenario = (plan, rng): ScenarioOutput => {
  const item = SCIENCE_ITEMS[(plan.instanceIdx - 1) % SCIENCE_ITEMS.length]
  const extra: Record<string, unknown> = {
    ground_truth: item.answer,
    golden_response: `Correct answer: ${item.answer}\n\n${item.reasoning.join(' ')}`,
  }
  const b = new TraceBuilder(plan.startMs, rng)
  b.system(rng.pick(SCIENCE_SYSTEM_PROMPTS))
  b.user(item.question)

  const success = plan.failure === null && plan.success
  const reasoning = success
    ? item.reasoning.join('\n\n')
    : `${item.reasoning[0]}\n\nOn reflection, the stronger candidate is ${item.wrong.toLowerCase()} — committing to that.`
  b.analysis(padWithFillers(reasoning, SCIENCE_FILLERS, rng, rng.int(400, 1200), 1800))

  if (plan.executing) {
    return { messages: b.messages, score: null, status: 'executing', extra, truncated: false }
  }

  const value = success ? item.answer : item.wrong
  const finalText = `Answer: ${value}.`
  const regions: FailureRegion[] = []

  if (plan.failure === 'truncation') {
    const msg = b.final(
      truncateMidSentence(
        `${finalText} To recap the reasoning in one line: ${item.reasoning[0]}`,
        rng,
      ),
    )
    msg.score = 0
    msg.judgeOutput =
      'The response is cut off mid-sentence and never commits to a complete answer, so it cannot be matched against the reference. Verdict: incorrect.'
    extra.judge = {
      verdict: 0,
      reasoning: judgeReasoning(item, rng, 'truncated', ''),
      model: JUDGE_MODEL,
    }
    return {
      messages: b.messages,
      score: 0,
      status: 'completed',
      rewardDetails: { judge: 0 },
      extra,
      truncated: true,
    }
  }

  const msg = b.final(finalText)
  msg.score = success ? 1 : 0
  msg.judgeOutput = success ? item.judgePass : item.judgeFail
  extra.judge = {
    verdict: success ? 1 : 0,
    reasoning: judgeReasoning(item, rng, success ? 'pass' : 'fail', value),
    model: JUDGE_MODEL,
  }
  if (plan.failure === 'wrong_answer') {
    regions.push({ messageIndex: b.lastIndex, text: value })
  }
  return {
    messages: b.messages,
    score: success ? 1 : 0,
    status: 'completed',
    rewardDetails: { judge: success ? 1 : 0 },
    extra,
    truncated: false,
    failureRegions: regions,
  }
}
