import { expect, type Page, type Route, test } from 'playwright/test'

const traces = ['trace-a', 'trace-b'] as const

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

function subject(traceUid: string) {
  return {
    corpusId: 'simulation',
    runId: 'review-run',
    traceUid,
    rubricVersion: 'judge_v2',
    annotator: 'local',
    mode: 'assisted' as const,
  }
}

function automatic(traceUid: string) {
  return {
    outcome: 'fail',
    failures: [
      {
        id: `failure-${traceUid}`,
        code: `policy_failure_${traceUid}`,
        origin: 'grader',
        severity: 'major',
        message: `Visible failure for ${traceUid}`,
      },
    ],
  }
}

async function stubReviewApi(page: Page) {
  await page.addInitScript(() => {
    class QuietEventSource {
      addEventListener() {}
      close() {}
    }
    Object.defineProperty(window, 'EventSource', { configurable: true, value: QuietEventSource })
  })

  await page.route('http://127.0.0.1:4173/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const pathname = url.pathname

    if (pathname === '/api/reviews/queue') {
      await fulfillJson(route, {
        total: traces.length,
        limit: 200,
        offset: 0,
        items: traces.map((traceUid, index) => ({
          subject: subject(traceUid),
          trace: {
            corpusId: 'simulation',
            runId: 'review-run',
            traceUid,
            sourceTraceId: `source-${traceUid}`,
            title: `Case ${index === 0 ? 'A' : 'B'}`,
            instanceId: `scenario-${index + 1}`,
          },
          state: 'unreviewed',
          revision: 0,
          locked: false,
          priority: 'none',
          rootCauseTags: [],
          automatic: automatic(traceUid),
        })),
      })
      return
    }
    if (pathname === '/api/reviews/calibration') {
      await fulfillJson(route, {
        records: 0,
        recordsWithAutomaticVerdicts: 0,
        dimensions: [],
        disagreements: [],
      })
      return
    }
    if (pathname.startsWith('/api/reviews/') && pathname.endsWith('/draft')) {
      const traceUid = decodeURIComponent(pathname.split('/')[3] ?? '')
      if (request.method() === 'PUT') {
        const body = request.postDataJSON()
        await fulfillJson(route, {
          ...body.subject,
          ...body.review,
          revision: body.expectedRevision ?? 1,
          key: `draft-${traceUid}`,
          locked: false,
          createdAt: '2026-08-06T00:00:00.000Z',
          updatedAt: '2026-08-06T00:00:00.000Z',
        })
        return
      }
      await fulfillJson(route, {
        subject: subject(traceUid),
        trace: {
          corpusId: 'simulation',
          runId: 'review-run',
          traceUid,
          sourceTraceId: `source-${traceUid}`,
          title: traceUid === 'trace-a' ? 'Case A' : 'Case B',
          transcript: [
            { id: `${traceUid}-message`, role: 'user', content: `Transcript for ${traceUid}` },
          ],
          rubric: [{ dimensionId: 'resolution', label: 'Resolution' }],
          groundTruth: { status: 'available', authoritative: true },
        },
        draft: null,
        latestFinal: null,
        nextRevision: 1,
        visibility: 'revealed',
        automatic: automatic(traceUid),
      })
      return
    }
    if (pathname.startsWith('/api/reviews/') && pathname.endsWith('/submit')) {
      const body = request.postDataJSON()
      await fulfillJson(route, {
        record: {
          ...body.subject,
          ...body.review,
          revision: body.expectedRevision ?? 1,
          key: `final-${body.subject.traceUid}`,
          locked: true,
          createdAt: '2026-08-06T00:00:00.000Z',
          submittedAt: '2026-08-06T00:00:00.000Z',
        },
        visibility: 'revealed',
        automatic: automatic(body.subject.traceUid),
      })
      return
    }

    await route.fulfill({
      status: 404,
      body: `unexpected request: ${request.method()} ${pathname}`,
    })
  })
}

test('review presets and safe classification shortcuts work end to end', async ({ page }) => {
  await stubReviewApi(page)
  await page.goto(
    '/reviews?mode=assisted&annotator=local&rubricVersion=judge_v2&corpusId=simulation&state=unreviewed',
  )

  await page.getByLabel('Review filter preset name').fill('Needs triage')
  await page.getByRole('button', { name: 'Save current' }).click()
  await expect(page.getByText('Saved “Needs triage” in this browser.')).toBeVisible()

  await page.getByLabel('Review priority').selectOption('high')
  await expect(page).toHaveURL(/priority=high/)
  await page.getByRole('button', { name: 'Apply' }).click()
  await expect(page).not.toHaveURL(/priority=/)

  await page.reload()
  await page
    .getByLabel('Saved review filter preset', { exact: true })
    .selectOption({ label: 'Needs triage' })
  await page.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('Deleted “Needs triage” from this browser.')).toBeVisible()

  await page.getByText('Case A', { exact: true }).click()
  await expect(page.getByText('Transcript for trace-a')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Focused · C / X' })).toBeVisible()

  await page.keyboard.press('p')
  await expect(page.getByLabel('Overall verdict')).toHaveValue('pass')
  await page.keyboard.press('c')
  const decisionNote = page.getByPlaceholder('Decision note')
  await expect(decisionNote).toBeVisible()
  await decisionNote.focus()
  await page.keyboard.type('fx')
  await expect(decisionNote).toHaveValue('fx')
  await expect(page.getByLabel('Overall verdict')).toHaveValue('pass')
  await expect(page.getByRole('button', { name: 'confirmed' })).toHaveClass(/bg-blue-600/)

  await page.keyboard.press('Alt+ArrowDown')
  await expect(page.getByText('Transcript for trace-a')).toBeVisible()
  await page.getByRole('button', { name: 'Focused · C / X' }).click()
  await page.keyboard.press('x')
  await expect(page.getByRole('button', { name: 'false positive' })).toHaveClass(/bg-blue-600/)
  await page.keyboard.press('f')
  await expect(page.getByLabel('Overall verdict')).toHaveValue('fail')

  await page.keyboard.press('Alt+ArrowDown')
  await expect(page.getByText('Transcript for trace-b')).toBeVisible()
  await page.getByRole('button', { name: 'Focused · C / X' }).click()
  await page.keyboard.press('Control+Enter')
  await expect(
    page.getByText('Submitted and locked. Automatic evaluation is now revealed'),
  ).toBeVisible()
})
