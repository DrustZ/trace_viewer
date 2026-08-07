import { expect, type Page, type Route, test } from 'playwright/test'

const TRACE_UID = 'simulation:smoke-run:uid-1'

const trace = {
  meta: {
    traceId: 'duplicate-source-id',
    traceUid: TRACE_UID,
    sourceTraceId: 'duplicate-source-id',
    corpusId: 'simulation',
    runId: 'smoke-run',
    instanceId: 'scenario-smoke',
    component: 'ace/support',
    status: 'failed',
    timestamp: '2026-08-06T00:00:00.000Z',
    checkpointStep: 0,
    split: 'test',
    sourceFormat: 'ace-episode',
    extra: { arm: 'never-render-this-arm' },
  },
  messages: [
    { id: 'm-0', role: 'user', content: 'Where is my order?', rawIndex: 0, chronologicalIndex: 0 },
    {
      id: 'm-1',
      role: 'assistant',
      content: 'I can look that up.',
      rawIndex: 1,
      chronologicalIndex: 1,
    },
  ],
  stats: {
    score: 0,
    hasError: false,
    truncated: false,
    model: { name: 'never-render-this-model' },
    inputTokens: 12,
    outputTokens: 8,
    thinkingTokens: 0,
    totalTokens: 20,
    turns: 1,
    toolUses: 0,
    sandboxExecutions: 0,
    thinkingPortion: 0,
  },
  evaluation: {
    lifecycle: { state: 'failed' },
    outcome: 'fail',
    checks: [],
    metrics: {},
    failures: [
      {
        origin: 'detector',
        code: 'never-render-this-detector',
        severity: 'major',
        gating: false,
        source: 'smoke',
      },
    ],
    flags: [],
    worldDiff: [],
    ledger: [],
  },
}

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

async function stubLocalApi(page: Page) {
  await page.addInitScript(() => {
    class QuietEventSource {
      addEventListener() {}
      close() {}
    }
    Object.defineProperty(window, 'EventSource', { configurable: true, value: QuietEventSource })
  })

  await page.route('http://127.0.0.1:4173/api/**', async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname

    if (pathname.endsWith('/neighbors')) {
      await fulfillJson(route, { prevId: null, nextId: null, position: 1, total: 1 })
      return
    }
    if (pathname.includes('/api/ace/traces/') && pathname.endsWith('/checkpoints')) {
      await fulfillJson(route, {
        traceUid: TRACE_UID,
        available: false,
        historicalReplayAvailable: true,
        missing: ['checkpoint archive', 'scenario snapshot'],
        checkpoints: [],
      })
      return
    }
    if (pathname === '/api/ace/replays' && request.method() === 'POST') {
      await fulfillJson(route, {
        result: {
          fidelity: 'historical_tool_replay',
          informative: 3,
          informative_matches: 2,
          skipped_orphans: 1,
        },
      })
      return
    }
    if (pathname.startsWith('/api/reviews/') && pathname.endsWith('/draft')) {
      await fulfillJson(route, {
        subject: {
          corpusId: 'simulation',
          runId: 'smoke-run',
          traceUid: TRACE_UID,
          rubricVersion: 'judge_v2',
          annotator: 'local',
          mode: 'calibration',
        },
        trace: {
          corpusId: 'simulation',
          runId: 'smoke-run',
          traceUid: TRACE_UID,
          sourceTraceId: 'duplicate-source-id',
          transcript: trace.messages,
          rubric: [{ dimensionId: 'resolution', label: 'Resolution' }],
          groundTruth: { policy: 'safe calibration context' },
        },
        draft: null,
        latestFinal: null,
        nextRevision: 1,
        visibility: 'hidden_until_submit',
      })
      return
    }
    if (pathname.startsWith('/api/traces/')) {
      await fulfillJson(route, trace)
      return
    }

    await route.fulfill({ status: 404, body: 'unexpected local API request' })
  })
}

test('local cockpit separates replay, assisted review, and blind calibration', async ({ page }) => {
  const externalRequests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) externalRequests.push(request.url())
  })
  await stubLocalApi(page)

  await page.goto(`/trace/${encodeURIComponent(TRACE_UID)}?tab=replay`)

  await expect(page.getByRole('button', { name: 'Replay & Fork' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Human Review' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'LLM-only continuation' })).toBeVisible()
  await page.getByTestId('historical-tool-replay').click()
  await expect(page.getByText('tool-only')).toBeVisible()

  await page.getByRole('button', { name: 'Human Review' }).click()
  await expect(page.getByText(/Inline trace review is Assisted/)).toBeVisible()
  await expect(page.getByRole('link', { name: /Open blind Calibration workspace/ })).toBeVisible()
  await expect(page.getByText(/Blind review is active/)).toHaveCount(0)
  expect(externalRequests).toEqual([])
})
