import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  emptyReviewPayload,
  type ReviewPayload,
  type ReviewSubject,
  reviewSubjectKey,
} from '../../shared/reviews/types'
import { ReviewLockedError, ReviewStore, resolveReviewStorePaths } from './reviewStore'

let temporaryDirectory = ''

beforeEach(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-review-store-'))
})

afterEach(async () => {
  await fs.rm(temporaryDirectory, { recursive: true, force: true })
})

function makeStore(): ReviewStore {
  let tick = 0
  return new ReviewStore({
    finalsPath: path.join(temporaryDirectory, 'labels', 'reviews.jsonl'),
    draftsDir: path.join(temporaryDirectory, 'labels', 'drafts'),
    clock: () => new Date(Date.UTC(2026, 7, 6, 0, 0, tick++)),
  })
}

function subject(overrides: Partial<ReviewSubject> = {}): ReviewSubject {
  return {
    corpusId: 'simulation',
    runId: 'batch-a',
    traceUid: 'trace-1',
    rubricVersion: 'judge_v2',
    annotator: 'local',
    mode: 'calibration',
    ...overrides,
  }
}

function payload(overrides: Partial<ReviewPayload> = {}): ReviewPayload {
  return {
    ...emptyReviewPayload(),
    overallVerdict: 'fail',
    priority: 'high',
    rootCauseTags: ['policy'],
    note: 'Needs a real refund state check.',
    rubricReviews: [
      {
        dimensionId: 'resolution',
        verdict: 'fail',
        critique: 'The order state did not change.',
        evidenceMessageIds: ['m-2'],
      },
    ],
    ...overrides,
  }
}

describe('ReviewStore', () => {
  it('atomically replaces a separate draft and appends immutable final JSONL', async () => {
    const store = makeStore()
    const key = subject()
    const first = await store.saveDraft(key, payload(), 1)
    expect(first.revision).toBe(1)
    expect(first.locked).toBe(false)

    const replaced = await store.saveDraft(key, payload({ note: 'Updated draft' }), 1)
    expect(replaced.createdAt).toBe(first.createdAt)
    expect(replaced.updatedAt).not.toBe(first.updatedAt)
    expect((await store.listDrafts()).map((draft) => draft.note)).toEqual(['Updated draft'])
    expect((await fs.readdir(store.draftsDir)).some((name) => name.endsWith('.tmp'))).toBe(false)

    const final = await store.submit(
      key,
      payload({ reviewStatus: 'reviewed', note: 'Locked result' }),
      { judgeVerdicts: { resolution: { verdict: 'fail' } } },
      1,
    )
    expect(final).toMatchObject({ revision: 1, locked: true, note: 'Locked result' })
    expect(await store.getDraft(key)).toBeNull()

    const lines = (await fs.readFile(store.finalsPath, 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toEqual(final)
  })

  it('locks calibration finals while assisted reviews append later revisions', async () => {
    const store = makeStore()
    await store.submit(subject(), payload({ reviewStatus: 'reviewed' }), undefined, 1)
    await expect(store.saveDraft(subject(), payload(), 2)).rejects.toBeInstanceOf(ReviewLockedError)

    const assisted = subject({ mode: 'assisted' })
    await store.submit(assisted, payload({ reviewStatus: 'reviewed' }), undefined, 1)
    await store.saveDraft(assisted, payload({ note: 'Revision two' }), 2)
    const second = await store.submit(
      assisted,
      payload({ reviewStatus: 'reviewed', note: 'Revision two' }),
      undefined,
      2,
    )
    expect(second.revision).toBe(2)
    expect(await store.listFinals()).toHaveLength(3)
  })

  it('repairs a torn final tail on the next submit instead of gluing records together', async () => {
    const store = makeStore()
    const first = await store.submit(subject(), payload({ reviewStatus: 'reviewed' }), undefined, 1)
    // Simulate a crash mid-append: a partial record with no trailing newline.
    await fs.appendFile(store.finalsPath, '{"torn', 'utf8')
    expect(await store.listFinals()).toHaveLength(1)

    const assisted = subject({ mode: 'assisted' })
    const second = await store.submit(assisted, payload({ reviewStatus: 'reviewed' }), undefined, 1)
    expect((await store.listFinals()).map((record) => record.key)).toEqual([first.key, second.key])

    // The unparseable fragment is gone and every stored line parses again.
    const lines = (await fs.readFile(store.finalsPath, 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(2)
    for (const line of lines) JSON.parse(line)
  })

  it('keeps a parseable record that lost only its trailing newline', async () => {
    const store = makeStore()
    const first = await store.submit(subject(), payload({ reviewStatus: 'reviewed' }), undefined, 1)
    const contents = await fs.readFile(store.finalsPath, 'utf8')
    await fs.writeFile(store.finalsPath, contents.slice(0, -1), 'utf8')

    const assisted = subject({ mode: 'assisted' })
    const second = await store.submit(assisted, payload({ reviewStatus: 'reviewed' }), undefined, 1)
    expect((await store.listFinals()).map((record) => record.key)).toEqual([first.key, second.key])
  })

  it('keeps corpus, run, rubric, annotator, mode, and revision in collision-safe keys', async () => {
    const store = makeStore()
    const variants = [
      subject(),
      subject({ runId: 'batch-b' }),
      subject({ corpusId: 'production' }),
      subject({ rubricVersion: 'judge_v3' }),
      subject({ annotator: 'reviewer-b' }),
      subject({ mode: 'assisted' }),
    ]
    expect(new Set(variants.map(reviewSubjectKey)).size).toBe(variants.length)
    await Promise.all(variants.map((item) => store.saveDraft(item, payload(), 1)))
    expect(await store.listDrafts()).toHaveLength(variants.length)
  })

  it('uses ACE runs/labels by default and honors every path override', () => {
    const defaults = resolveReviewStorePaths({})
    expect(defaults.finalsPath).toMatch(/ac_express\/runs\/labels\/reviews\.jsonl$/)
    expect(defaults.draftsDir).toMatch(/ac_express\/runs\/labels\/drafts$/)

    const configured = resolveReviewStorePaths({ ACE_RUNS_DIR: '/tmp/example-runs' })
    expect(configured).toEqual({
      finalsPath: '/tmp/example-runs/labels/reviews.jsonl',
      draftsDir: '/tmp/example-runs/labels/drafts',
    })

    const colocated = new ReviewStore({ finalsPath: '/tmp/custom-labels/final.jsonl' })
    expect(colocated.draftsDir).toBe('/tmp/custom-labels/drafts')
  })
})
