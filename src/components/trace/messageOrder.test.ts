import type { Message } from '@shared/schema/types'
import { describe, expect, it } from 'vitest'
import {
  messageTimestampMs,
  orderMessagesByTimestamp,
  timestampedMessageCount,
  timestampRegressionCount,
} from './messageOrder'

function message(id: string, timestamp?: string, sourceTimestampSeconds?: number): Message {
  return {
    id,
    role: 'user',
    content: id,
    ...(timestamp !== undefined ? { timestamp } : {}),
    ...(sourceTimestampSeconds !== undefined ? { metadata: { sourceTimestampSeconds } } : {}),
  }
}

describe('message timestamp ordering', () => {
  it('sorts stably without mutating the source array or source ids', () => {
    const source = [
      message('m-0', '2026-01-01T00:00:03.000Z'),
      message('m-1', '2026-01-01T00:00:01.000Z'),
      message('m-2', '2026-01-01T00:00:01.000Z'),
    ]

    const ordered = orderMessagesByTimestamp(source)

    expect(ordered.map((item) => item.id)).toEqual(['m-1', 'm-2', 'm-0'])
    expect(source.map((item) => item.id)).toEqual(['m-0', 'm-1', 'm-2'])
    expect(ordered[0]).toBe(source[1])
  })

  it('uses retained source precision when ISO milliseconds are tied', () => {
    const laterResult = message('m-0', '2026-01-01T00:00:00.400Z', 1767225600.40092)
    const earlierCall = message('m-1', '2026-01-01T00:00:00.400Z', 1767225600.400775)

    expect(messageTimestampMs(earlierCall)).toBeLessThan(messageTimestampMs(laterResult) as number)
    expect(orderMessagesByTimestamp([laterResult, earlierCall]).map((item) => item.id)).toEqual([
      'm-1',
      'm-0',
    ])
  })

  it('keeps untimestamped messages as boundaries between independently sorted runs', () => {
    const source = [
      message('m-0', '2026-01-01T00:00:02.000Z'),
      message('m-1'),
      message('m-2', '2026-01-01T00:00:04.000Z'),
      message('m-3', '2026-01-01T00:00:03.000Z'),
    ]

    expect(orderMessagesByTimestamp(source).map((item) => item.id)).toEqual([
      'm-0',
      'm-1',
      'm-3',
      'm-2',
    ])
  })

  it('counts valid timestamps and backwards jumps while skipping invalid values', () => {
    const source = [
      message('m-0', '2026-01-01T00:00:02.000Z'),
      message('m-1', 'not-a-date'),
      message('m-2', '2026-01-01T00:00:01.000Z'),
      message('m-3', '2026-01-01T00:00:03.000Z'),
    ]

    expect(timestampedMessageCount(source)).toBe(3)
    expect(timestampRegressionCount(source)).toBe(1)
  })
})
