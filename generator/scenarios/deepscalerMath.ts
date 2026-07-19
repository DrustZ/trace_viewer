import { padWithFillers, TraceBuilder } from '../build'
import { MATH_FILLERS, MATH_ITEMS, MATH_SYSTEM_PROMPTS } from '../content'
import { truncateMidSentence } from '../failures'
import type { FailureRegion, Scenario, ScenarioOutput } from '../types'

export const deepscalerMath: Scenario = (plan, rng): ScenarioOutput => {
  const item = MATH_ITEMS[(plan.instanceIdx - 1) % MATH_ITEMS.length]
  const extra = { ground_truth: item.answer }
  const b = new TraceBuilder(plan.startMs, rng)
  b.system(rng.pick(MATH_SYSTEM_PROMPTS))
  b.user(item.problem)

  const success = plan.failure === null && plan.success
  const paragraphs = success ? item.derivation : [...item.derivation.slice(0, -1), item.slip]
  const target = rng.int(600, 2200)
  b.analysis(padWithFillers(paragraphs.join('\n\n'), MATH_FILLERS, rng, target, 2500))

  if (plan.executing) {
    return { messages: b.messages, score: null, status: 'executing', extra, truncated: false }
  }

  const value = success ? item.answer : item.wrong
  const boxed = `\\boxed{${value}}`
  const finalText = `Working through the ${success ? 'derivation' : 'computation'} above, the value comes out to $${boxed}$.`
  const regions: FailureRegion[] = []

  if (plan.failure === 'truncation') {
    b.final(truncateMidSentence(finalText, rng))
    return {
      messages: b.messages,
      score: 0,
      status: 'completed',
      rewardDetails: { math_verify: 0 },
      extra,
      truncated: true,
    }
  }

  b.final(finalText)
  if (plan.failure === 'wrong_answer') {
    regions.push({ messageIndex: b.lastIndex, text: boxed })
  }
  return {
    messages: b.messages,
    score: success ? 1 : 0,
    status: 'completed',
    rewardDetails: { math_verify: success ? 1 : 0 },
    extra,
    truncated: false,
    failureRegions: regions,
  }
}
