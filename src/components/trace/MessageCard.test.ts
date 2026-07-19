import { describe, expect, it } from 'vitest'
import { messageNumber } from './MessageCard'

describe('messageNumber', () => {
  it('maps finalizeTrace ids m-<idx> to 1-based numbers', () => {
    expect(messageNumber('m-0')).toBe(1)
    expect(messageNumber('m-1')).toBe(2)
    expect(messageNumber('m-41')).toBe(42)
  })

  it('omits numbering for foreign id shapes', () => {
    expect(messageNumber('msg_abc')).toBeUndefined()
    expect(messageNumber('m-')).toBeUndefined()
    expect(messageNumber('m-3a')).toBeUndefined()
    expect(messageNumber('am-3')).toBeUndefined()
    expect(messageNumber('')).toBeUndefined()
  })
})
