import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Message, Trace, TraceStats } from '../../shared/schema/types'

function toolNameFor(messages: readonly Message[], toolCallId: string): string {
  for (const m of messages) {
    for (const call of m.toolCalls ?? []) {
      if (call.id === toolCallId) return call.name
    }
  }
  return 'unknown'
}

/**
 * Renders a trace to the harmony text grammar. Only the last block — the
 * final answer — closes with <|return|>; everything else closes with <|end|>.
 */
export function renderHarmony(trace: Trace): string {
  const blocks: string[] = []
  const messages = trace.messages
  for (let idx = 0; idx < messages.length; idx++) {
    const m = messages[idx]
    if (m.role === 'tool' && m.toolResult) {
      const name = toolNameFor(messages, m.toolResult.toolCallId)
      blocks.push(
        `<|start|>functions.${name} to=assistant<|channel|>commentary<|message|>${m.content}<|end|>`,
      )
      continue
    }
    if (m.role === 'assistant') {
      if (m.toolCalls && m.toolCalls.length > 0) {
        for (const call of m.toolCalls) {
          blocks.push(
            `<|start|>assistant<|channel|>commentary to=functions.${call.name}<|message|>${call.arguments}<|end|>`,
          )
        }
        continue
      }
      const channel = m.channel ?? 'final'
      const closer = channel === 'final' && idx === messages.length - 1 ? '<|return|>' : '<|end|>'
      blocks.push(`<|start|>assistant<|channel|>${channel}<|message|>${m.content}${closer}`)
      continue
    }
    blocks.push(`<|start|>${m.role}<|message|>${m.content}<|end|>`)
  }
  return `${blocks.join('\n')}\n`
}

/**
 * Writes <traceId>.txt plus a <traceId>.meta.json sidecar carrying
 * { meta, statsOverrides } for the scanner to merge back in.
 */
export function writeHarmony(
  outDir: string,
  trace: Trace,
  statsOverrides: Partial<TraceStats>,
): { paths: string[]; bytes: number } {
  const dir = join(outDir, 'harmony')
  mkdirSync(dir, { recursive: true })
  const textRel = join('harmony', `${trace.meta.traceId}.txt`)
  const metaRel = join('harmony', `${trace.meta.traceId}.meta.json`)
  const text = renderHarmony(trace)
  const sidecar = `${JSON.stringify({ meta: trace.meta, statsOverrides }, null, 2)}\n`
  writeFileSync(join(outDir, textRel), text)
  writeFileSync(join(outDir, metaRel), sidecar)
  return { paths: [textRel, metaRel], bytes: Buffer.byteLength(text) + Buffer.byteLength(sidecar) }
}
