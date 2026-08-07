import { describe, expect, it } from 'vitest'
import type { AceCheckpointSummary, AceReplayRequest } from './ace'

describe('ACE replay schema', () => {
  it('carries the immutable fork boundary through request and checkpoint contracts', () => {
    const request: AceReplayRequest = {
      sourceTraceUid: 'simulation:run:trace',
      checkpointId: 4,
      forkMessageId: 'message-17',
      mode: 'exact',
      costCapUsd: 2,
    }
    const checkpoint: AceCheckpointSummary = {
      id: 4,
      phase: 'bot',
      message_count: 18,
      fork_message_id: 'message-17',
      branchable: true,
    }

    expect(request.forkMessageId).toBe(checkpoint.fork_message_id)
  })
})
