import { withDefaultCheckpointProvenance } from '../schema/provenance'
import type { Message, TraceMeta } from '../schema/types'
import type { Connector, ParseContext, ParseResult } from './types'

const EPOCH = '1970-01-01T00:00:00.000Z'
const START = '<|start|>'
const MESSAGE = '<|message|>'
const END = '<|end|>'
const RETURN = '<|return|>'
const CHANNEL = '<|channel|>'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function djb2Hex(text: string): string {
  let hash = 5381
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0
  }
  return hash.toString(16).padStart(8, '0').slice(0, 8)
}

function parseArguments(args: string): { parsedArguments?: unknown; parseError?: string } {
  try {
    return { parsedArguments: JSON.parse(args) }
  } catch (e) {
    return { parseError: errorMessage(e) }
  }
}

function resultIsError(content: string): boolean {
  if (content.startsWith('ERROR')) return true
  try {
    const parsed = JSON.parse(content)
    return isRecord(parsed) && Boolean(parsed.error)
  } catch {
    return false
  }
}

/** Earliest of <|end|> / <|return|> after `from`, if it comes before `limit` (-1 = none). */
function findTerminator(
  text: string,
  from: number,
  limit: number,
): { index: number; length: number } | null {
  let best: { index: number; length: number } | null = null
  for (const marker of [END, RETURN]) {
    const idx = text.indexOf(marker, from)
    if (idx === -1) continue
    if (limit !== -1 && idx > limit) continue
    if (best === null || idx < best.index) best = { index: idx, length: marker.length }
  }
  return best
}

function parseHarmony(text: string, ctx: ParseContext): ParseResult {
  const warnings: string[] = []
  const messages: Message[] = []
  const openCalls: Array<{ id: string; name: string; matched: boolean }> = []
  let toolCallCount = 0
  let unmatchedCount = 0

  const pushBlock = (header: string, content: string): void => {
    if (header === 'system' || header === 'developer' || header === 'user') {
      messages.push({ id: '', role: header, content })
      return
    }
    if (header === 'assistant') {
      messages.push({ id: '', role: 'assistant', channel: 'final', content })
      return
    }
    if (header.startsWith(`assistant${CHANNEL}`)) {
      const channelSpec = header.slice(`assistant${CHANNEL}`.length).trim()
      if (channelSpec === 'analysis' || channelSpec === 'final' || channelSpec === 'commentary') {
        messages.push({ id: '', role: 'assistant', channel: channelSpec, content })
        return
      }
      const toolMatch = /^commentary\s+to=functions\.(\S+)$/.exec(channelSpec)
      if (toolMatch) {
        toolCallCount += 1
        const id = `fc-${toolCallCount}`
        const name = toolMatch[1]
        openCalls.push({ id, name, matched: false })
        messages.push({
          id: '',
          role: 'assistant',
          channel: 'commentary',
          content: '',
          toolCalls: [{ id, name, arguments: content, ...parseArguments(content) }],
        })
        return
      }
    }
    if (header.startsWith('functions.')) {
      const nameMatch = /^functions\.(\S+)/.exec(header)
      if (nameMatch) {
        const name = nameMatch[1]
        const open = [...openCalls].reverse().find((c) => !c.matched && c.name === name)
        let toolCallId: string
        if (open) {
          open.matched = true
          toolCallId = open.id
        } else {
          unmatchedCount += 1
          toolCallId = `fc-unmatched-${unmatchedCount}`
          warnings.push(`tool result for 'functions.${name}' has no matching tool call`)
        }
        messages.push({
          id: '',
          role: 'tool',
          content,
          toolResult: { toolCallId, isError: resultIsError(content) },
        })
        return
      }
    }
    warnings.push(`unknown header '${header}'`)
    messages.push({ id: '', role: 'user', content })
  }

  let pos = 0
  while (true) {
    const start = text.indexOf(START, pos)
    if (start === -1) break
    const headerStart = start + START.length
    const msgIdx = text.indexOf(MESSAGE, headerStart)
    const nextStart = text.indexOf(START, headerStart)
    if (msgIdx === -1 || (nextStart !== -1 && msgIdx > nextStart)) {
      warnings.push('block missing <|message|>; skipped')
      if (nextStart === -1) break
      pos = nextStart
      continue
    }
    const header = text.slice(headerStart, msgIdx).trim()
    const contentStart = msgIdx + MESSAGE.length
    const nextStartAfter = text.indexOf(START, contentStart)
    const terminator = findTerminator(text, contentStart, nextStartAfter)
    if (terminator) {
      pushBlock(header, text.slice(contentStart, terminator.index))
      pos = terminator.index + terminator.length
    } else if (nextStartAfter !== -1) {
      warnings.push(`unterminated block (header '${header}'); content salvaged`)
      pushBlock(header, text.slice(contentStart, nextStartAfter))
      pos = nextStartAfter
    } else {
      warnings.push('unterminated block at end of input')
      const partial = text.slice(contentStart)
      if (partial !== '') {
        messages.push({ id: '', role: 'assistant', channel: 'final', content: partial })
      }
      break
    }
  }

  if (messages.length === 0) {
    return { traces: [], warnings: warnings.length > 0 ? warnings : ['no harmony blocks found'] }
  }
  const traceId = `harmony-${djb2Hex(text)}`
  const meta: TraceMeta = {
    traceId,
    instanceId: traceId,
    component: 'imported/harmony',
    status: 'completed',
    timestamp: ctx.fallbackTimestamp ?? EPOCH,
    checkpointStep: 0,
    split: 'train',
    sourceFormat: 'harmony',
    dataLocation: ctx.sourcePath,
    extra: withDefaultCheckpointProvenance(),
  }
  return { traces: [{ meta, messages, warnings }], warnings: [] }
}

export const harmonyConnector: Connector = {
  id: 'harmony',
  displayName: 'Harmony text',
  extensions: ['.txt'],

  detect(text: string): boolean {
    return text.includes(START) && text.includes(MESSAGE)
  },

  parse(text: string, ctx: ParseContext): ParseResult {
    try {
      return parseHarmony(text, ctx)
    } catch (e) {
      return { traces: [], warnings: [`harmony parse failed: ${errorMessage(e)}`] }
    }
  },
}
