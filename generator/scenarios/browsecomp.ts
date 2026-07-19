import { TraceBuilder } from '../build'
import {
  SEARCH_FILLER_THOUGHTS,
  SEARCH_ITEMS,
  SEARCH_SYSTEM_PROMPTS,
  type SearchSnippet,
} from '../content'
import { CANCELLED_RESULT, corruptJson, MALFORMED_RESULT, truncateMidSentence } from '../failures'
import type { FailureRegion, Scenario, ScenarioOutput } from '../types'

function renderResults(results: readonly SearchSnippet[]): string {
  return results.map((r, i) => `${i + 1}. ${r.title} — ${r.url}\n   ${r.snippet}`).join('\n\n')
}

export const browsecomp: Scenario = (plan, rng): ScenarioOutput => {
  const item = SEARCH_ITEMS[(plan.instanceIdx - 1) % SEARCH_ITEMS.length]
  const extra = { ground_truth: item.answer }
  const b = new TraceBuilder(plan.startMs, rng)
  const regions: FailureRegion[] = []
  b.system(rng.pick(SEARCH_SYSTEM_PROMPTS))
  b.user(item.question)

  const failure = plan.failure
  const success = failure === null || failure === 'malformed_tool_json' ? plan.success : false

  const roundCount = Math.min(rng.int(2, 5), item.rounds.length)
  const malformedAt = failure === 'malformed_tool_json' ? rng.int(0, roundCount - 1) : -1
  const stopAfter = plan.executing ? rng.int(1, roundCount) : -1

  for (let i = 0; i < roundCount; i++) {
    const round = item.rounds[i % item.rounds.length]
    b.analysis(
      i < item.thoughts.length ? item.thoughts[i] : rng.pick(SEARCH_FILLER_THOUGHTS),
      rng.int(500, 4000),
    )
    const resultCount = Math.min(round.results.length, rng.int(2, 4))
    const args = JSON.stringify({ query: round.query })
    if (i === malformedAt) {
      const bad = corruptJson(args, rng)
      const call = b.toolCall('search', bad, { malformed: true })
      regions.push({ messageIndex: b.lastIndex, text: bad })
      b.toolResult(call, MALFORMED_RESULT, { isError: true, durationMs: rng.int(5, 40) })
      const retry = b.toolCall('search', args)
      b.toolResult(retry, renderResults(round.results.slice(0, resultCount)), {
        durationMs: rng.int(300, 2200),
      })
    } else {
      const call = b.toolCall('search', args)
      if (failure === 'cancelled' && i === roundCount - 1) {
        b.toolResult(call, CANCELLED_RESULT, { isError: true, durationMs: rng.int(100, 2000) })
        return { messages: b.messages, score: null, status: 'failed', extra, truncated: false }
      }
      b.toolResult(call, renderResults(round.results.slice(0, resultCount)), {
        durationMs: rng.int(300, 2200),
      })
    }
    if (i + 1 === stopAfter) {
      return { messages: b.messages, score: null, status: 'executing', extra, truncated: false }
    }
  }

  const answer = success ? item.answer : item.wrong
  if (failure === 'truncation') {
    b.final(truncateMidSentence(answer, rng))
    return {
      messages: b.messages,
      score: 0,
      status: 'completed',
      rewardDetails: { answer_match: 0 },
      extra,
      truncated: true,
    }
  }

  b.final(answer)
  if (failure === 'wrong_answer') {
    regions.push({ messageIndex: b.lastIndex, text: item.wrongClaim })
  }
  return {
    messages: b.messages,
    score: success ? 1 : 0,
    status: 'completed',
    rewardDetails: { answer_match: success ? 1 : 0 },
    extra,
    truncated: false,
    failureRegions: regions,
  }
}
