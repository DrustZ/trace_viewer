import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Message, Trace, TraceStats } from '../../shared/schema/types'

interface OpenAIToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface OpenAIMessage {
  role: 'system' | 'developer' | 'user' | 'assistant' | 'tool'
  content?: string
  reasoning_content?: string
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
}

interface OpenAIChatFile {
  id: string
  created: number
  model: string
  messages: OpenAIMessage[]
  choices: Array<{
    index: number
    message: OpenAIMessage
    logprobs: { content: Array<{ token: string; logprob: number }> } | null
    finish_reason: string
  }>
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

function toToolCalls(m: Message): OpenAIToolCall[] {
  return (m.toolCalls ?? []).map((c) => ({
    id: c.id,
    type: 'function' as const,
    function: { name: c.name, arguments: c.arguments },
  }))
}

export function renderOpenAI(trace: Trace): OpenAIChatFile {
  const history: OpenAIMessage[] = []
  let finalMessage: Message | undefined
  let pendingReasoning: string | undefined

  for (const m of trace.messages) {
    if (m.role === 'assistant') {
      if (m.channel === 'analysis') {
        pendingReasoning = pendingReasoning ? `${pendingReasoning}\n\n${m.content}` : m.content
        continue
      }
      if (m.toolCalls && m.toolCalls.length > 0) {
        history.push({
          role: 'assistant',
          ...(pendingReasoning !== undefined ? { reasoning_content: pendingReasoning } : {}),
          tool_calls: toToolCalls(m),
        })
        pendingReasoning = undefined
        continue
      }
      finalMessage = m
      continue
    }
    if (m.role === 'tool' && m.toolResult) {
      history.push({ role: 'tool', tool_call_id: m.toolResult.toolCallId, content: m.content })
      continue
    }
    history.push({ role: m.role, content: m.content })
  }

  const logprobs = finalMessage?.tokens
    ? { content: finalMessage.tokens.map((t) => ({ token: t.token, logprob: t.logprob })) }
    : null

  return {
    id: `chatcmpl-${trace.meta.traceId}`,
    created: Math.floor(Date.parse(trace.meta.timestamp) / 1000),
    model: trace.stats.model?.name ?? 'harmony-32b',
    messages: history,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: finalMessage?.content ?? '',
          ...(pendingReasoning !== undefined ? { reasoning_content: pendingReasoning } : {}),
        },
        logprobs,
        finish_reason: trace.stats.truncated ? 'length' : 'stop',
      },
    ],
    usage: {
      prompt_tokens: trace.stats.inputTokens,
      completion_tokens: trace.stats.outputTokens,
      total_tokens: trace.stats.totalTokens,
    },
  }
}

/**
 * Writes <traceId>.json plus a <traceId>.meta.json sidecar carrying
 * { meta, statsOverrides } — mirroring writeHarmony. Without it the connector
 * defaults these showcase traces to the 'imported/openai-chat' component; the
 * sidecar puts them back under their real component/run.
 */
export function writeOpenAI(
  outDir: string,
  trace: Trace,
  statsOverrides: Partial<TraceStats>,
): { paths: string[]; bytes: number } {
  const dir = join(outDir, 'openai')
  mkdirSync(dir, { recursive: true })
  const jsonRel = join('openai', `${trace.meta.traceId}.json`)
  const metaRel = join('openai', `${trace.meta.traceId}.meta.json`)
  const body = `${JSON.stringify(renderOpenAI(trace), null, 2)}\n`
  const sidecar = `${JSON.stringify({ meta: trace.meta, statsOverrides }, null, 2)}\n`
  writeFileSync(join(outDir, jsonRel), body)
  writeFileSync(join(outDir, metaRel), sidecar)
  return { paths: [jsonRel, metaRel], bytes: Buffer.byteLength(body) + Buffer.byteLength(sidecar) }
}
