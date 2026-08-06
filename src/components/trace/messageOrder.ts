import type { Message } from '@shared/schema/types'

const SOURCE_TIMESTAMP_SECONDS = 'sourceTimestampSeconds'

/**
 * Millisecond timestamp used only for display ordering. Connectors can retain a
 * higher-precision source value in metadata when canonical ISO milliseconds
 * would collapse distinct events into a tie.
 */
export function messageTimestampMs(message: Message): number | undefined {
  const sourceSeconds = message.metadata?.[SOURCE_TIMESTAMP_SECONDS]
  if (typeof sourceSeconds === 'number' && Number.isFinite(sourceSeconds)) {
    return sourceSeconds * 1000
  }

  if (message.timestamp === undefined) return undefined
  const parsed = Date.parse(message.timestamp)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function timestampedMessageCount(messages: readonly Message[]): number {
  let count = 0
  for (const message of messages) {
    if (messageTimestampMs(message) !== undefined) count += 1
  }
  return count
}

/** Adjacent backwards jumps among timestamped source messages. */
export function timestampRegressionCount(messages: readonly Message[]): number {
  let previous: number | undefined
  let regressions = 0
  for (const message of messages) {
    const current = messageTimestampMs(message)
    if (current === undefined) continue
    if (previous !== undefined && current < previous) regressions += 1
    previous = current
  }
  return regressions
}

/**
 * Stable ascending timestamp projection. The input and message objects are
 * never mutated, so ids such as m-0/m-1 remain source-order evidence.
 *
 * Untimestamped messages are conservative boundaries: each contiguous run of
 * timestamped messages is sorted independently, while an unknown-time message
 * and everything across that boundary retain their source-side relationship.
 */
export function orderMessagesByTimestamp(messages: readonly Message[]): Message[] {
  const ordered = [...messages]
  let start = 0

  while (start < ordered.length) {
    while (start < ordered.length && messageTimestampMs(ordered[start]) === undefined) start += 1
    if (start >= ordered.length) break

    let end = start + 1
    while (end < ordered.length && messageTimestampMs(ordered[end]) !== undefined) end += 1

    const run = ordered
      .slice(start, end)
      .map((message, sourceOffset) => ({
        message,
        sourceOffset,
        timestamp: messageTimestampMs(message) as number,
      }))
      .sort((a, b) => a.timestamp - b.timestamp || a.sourceOffset - b.sourceOffset)

    for (let i = 0; i < run.length; i++) ordered[start + i] = run[i].message
    start = end + 1
  }

  return ordered
}
