import type { Message, ToolCall } from '../shared/schema/types'
import { parseErrorFor } from './failures'
import type { Rng } from './rng'

/**
 * Message assembly with a monotonic clock: each message is stamped at the
 * current time and advances it by durationMs plus a small gap. Ids are left
 * empty — finalizeTrace assigns them.
 */
export class TraceBuilder {
  readonly messages: Message[] = []
  private clock: number
  private callSeq = 0
  private readonly rng: Rng

  constructor(startMs: number, rng: Rng) {
    this.clock = startMs
    this.rng = rng
  }

  get lastIndex(): number {
    return this.messages.length - 1
  }

  private push(m: Omit<Message, 'id' | 'timestamp' | 'durationMs'>, durationMs: number): Message {
    const msg: Message = {
      ...m,
      id: '',
      timestamp: new Date(this.clock).toISOString(),
      durationMs,
    }
    this.messages.push(msg)
    this.clock += durationMs + this.rng.int(30, 400)
    return msg
  }

  system(content: string): Message {
    return this.push({ role: 'system', content }, 0)
  }

  developer(content: string): Message {
    return this.push({ role: 'developer', content }, 0)
  }

  user(content: string): Message {
    return this.push({ role: 'user', content }, 0)
  }

  analysis(content: string, durationMs?: number): Message {
    return this.push(
      { role: 'assistant', channel: 'analysis', content },
      durationMs ?? this.rng.int(800, 15000),
    )
  }

  toolCall(
    name: string,
    args: string,
    opts?: { malformed?: boolean; durationMs?: number },
  ): ToolCall {
    this.callSeq += 1
    const call: ToolCall = { id: `call-${this.callSeq}`, name, arguments: args }
    if (opts?.malformed) call.parseError = parseErrorFor(args)
    else call.parsedArguments = JSON.parse(args)
    this.push(
      { role: 'assistant', channel: 'commentary', content: '', toolCalls: [call] },
      opts?.durationMs ?? this.rng.int(300, 1800),
    )
    return call
  }

  toolResult(
    call: ToolCall,
    content: string,
    opts?: { isError?: boolean; durationMs?: number },
  ): Message {
    const durationMs = opts?.durationMs ?? this.rng.int(80, 6000)
    return this.push(
      {
        role: 'tool',
        content,
        toolResult: { toolCallId: call.id, isError: opts?.isError ?? false, durationMs },
      },
      durationMs,
    )
  }

  final(content: string, durationMs?: number): Message {
    return this.push(
      { role: 'assistant', channel: 'final', content },
      durationMs ?? this.rng.int(600, 5000),
    )
  }
}

/** Grows `base` with filler paragraphs (shuffled, no repeats) until it reaches target chars. */
export function padWithFillers(
  base: string,
  fillers: readonly string[],
  rng: Rng,
  target: number,
  max: number,
): string {
  let out = base
  for (const filler of rng.shuffle(fillers)) {
    if (out.length >= target) break
    if (out.length + filler.length + 2 > max) break
    out = `${out}\n\n${filler}`
  }
  return out
}
