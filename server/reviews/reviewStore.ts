import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  type AutomaticReviewContext,
  type ReviewDraft,
  type ReviewPayload,
  type ReviewRecord,
  type ReviewSubject,
  reviewRecordKey,
  reviewSubjectKey,
} from '../../shared/reviews/types'
import { parseStoredDraft, parseStoredRecord } from './validation'

export interface ReviewStorePaths {
  finalsPath: string
  draftsDir: string
}

export interface ReviewStoreOptions extends Partial<ReviewStorePaths> {
  clock?: () => Date
}

export class ReviewStoreError extends Error {
  readonly status: number

  constructor(message: string, status = 500) {
    super(message)
    this.name = 'ReviewStoreError'
    this.status = status
  }
}

export class ReviewConflictError extends ReviewStoreError {
  constructor(message: string) {
    super(message, 409)
    this.name = 'ReviewConflictError'
  }
}

export class ReviewLockedError extends ReviewStoreError {
  constructor(message: string) {
    super(message, 423)
    this.name = 'ReviewLockedError'
  }
}

export class ReviewNotFoundError extends ReviewStoreError {
  constructor(message: string) {
    super(message, 404)
    this.name = 'ReviewNotFoundError'
  }
}

/**
 * Resolve storage under ACE by default while allowing explicit deployment
 * configuration. The code-relative fallback is stable regardless of cwd.
 */
export function resolveReviewStorePaths(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ReviewStorePaths {
  const defaultRunsDir = path.resolve(import.meta.dirname, '../../../ac_express/runs')
  const labelsDir = path.resolve(
    env.ACE_LABELS_DIR ?? path.join(env.ACE_RUNS_DIR ?? defaultRunsDir, 'labels'),
  )
  return {
    finalsPath: path.resolve(env.ACE_REVIEWS_PATH ?? path.join(labelsDir, 'reviews.jsonl')),
    draftsDir: path.resolve(env.ACE_REVIEW_DRAFTS_DIR ?? path.join(labelsDir, 'drafts')),
  }
}

function draftFilename(subject: ReviewSubject): string {
  const digest = createHash('sha256').update(reviewSubjectKey(subject)).digest('hex')
  return `${digest}.json`
}

function latestForSubject(
  records: readonly ReviewRecord[],
  subject: ReviewSubject,
): ReviewRecord | undefined {
  const key = reviewSubjectKey(subject)
  return records
    .filter((record) => reviewSubjectKey(record) === key)
    .sort((a, b) => b.revision - a.revision)[0]
}

/**
 * Append-only submitted records plus independently atomic drafts. Mutations are
 * serialized so two browser requests cannot allocate the same revision.
 */
export class ReviewStore {
  readonly finalsPath: string
  readonly draftsDir: string
  private readonly clock: () => Date
  private mutationTail: Promise<void> = Promise.resolve()

  constructor(options: ReviewStoreOptions = {}) {
    const defaults = resolveReviewStorePaths()
    this.finalsPath = path.resolve(options.finalsPath ?? defaults.finalsPath)
    this.draftsDir = path.resolve(
      options.draftsDir ??
        (options.finalsPath
          ? path.join(path.dirname(this.finalsPath), 'drafts')
          : defaults.draftsDir),
    )
    this.clock = options.clock ?? (() => new Date())
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation)
    this.mutationTail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private async settled(): Promise<void> {
    await this.mutationTail
  }

  private draftPath(subject: ReviewSubject): string {
    return path.join(this.draftsDir, draftFilename(subject))
  }

  private async readFinalsNow(): Promise<ReviewRecord[]> {
    let contents: string
    try {
      contents = await fs.readFile(this.finalsPath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }

    const records: ReviewRecord[] = []
    const lines = contents.split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim()
      if (line === '') continue
      try {
        records.push(parseStoredRecord(JSON.parse(line)))
      } catch (error) {
        // A process crash can leave only the final append incomplete. Preserve
        // every prior immutable record and ignore that recoverable tail.
        const isLastNonEmpty = lines.slice(index + 1).every((remaining) => remaining.trim() === '')
        if (isLastNonEmpty && !contents.endsWith('\n')) break
        const detail = error instanceof Error ? error.message : String(error)
        throw new ReviewStoreError(`invalid review JSONL at line ${index + 1}: ${detail}`)
      }
    }
    return records
  }

  async listFinals(): Promise<ReviewRecord[]> {
    await this.settled()
    return this.readFinalsNow()
  }

  async latestFinal(subject: ReviewSubject): Promise<ReviewRecord | null> {
    return latestForSubject(await this.listFinals(), subject) ?? null
  }

  private async readDraftNow(subject: ReviewSubject): Promise<ReviewDraft | null> {
    try {
      const parsed = parseStoredDraft(
        JSON.parse(await fs.readFile(this.draftPath(subject), 'utf8')),
      )
      if (reviewSubjectKey(parsed) !== reviewSubjectKey(subject)) {
        throw new ReviewStoreError('draft subject does not match its storage key')
      }
      return parsed
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async getDraft(subject: ReviewSubject): Promise<ReviewDraft | null> {
    await this.settled()
    return this.readDraftNow(subject)
  }

  async listDrafts(): Promise<ReviewDraft[]> {
    await this.settled()
    let names: string[]
    try {
      names = await fs.readdir(this.draftsDir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const drafts: ReviewDraft[] = []
    for (const name of names.sort()) {
      if (!name.endsWith('.json')) continue
      drafts.push(
        parseStoredDraft(JSON.parse(await fs.readFile(path.join(this.draftsDir, name), 'utf8'))),
      )
    }
    return drafts
  }

  async saveDraft(
    subject: ReviewSubject,
    review: ReviewPayload,
    expectedRevision?: number,
  ): Promise<ReviewDraft> {
    return this.serialize(async () => {
      const finals = await this.readFinalsNow()
      const latest = latestForSubject(finals, subject)
      if (subject.mode === 'calibration' && latest) {
        throw new ReviewLockedError('submitted calibration reviews are locked')
      }
      const revision = (latest?.revision ?? 0) + 1
      if (expectedRevision !== undefined && expectedRevision !== revision) {
        throw new ReviewConflictError(
          `review revision changed: expected ${expectedRevision}, current ${revision}`,
        )
      }
      const previous = await this.readDraftNow(subject)
      if (previous && previous.revision !== revision) {
        throw new ReviewConflictError('stale draft revision')
      }
      const now = this.clock().toISOString()
      const draft: ReviewDraft = {
        ...subject,
        ...review,
        revision,
        key: reviewRecordKey(subject, revision),
        locked: false,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      }

      await fs.mkdir(this.draftsDir, { recursive: true })
      const destination = this.draftPath(subject)
      const temporary = path.join(
        this.draftsDir,
        `.${path.basename(destination)}.${process.pid}.${randomUUID()}.tmp`,
      )
      try {
        await fs.writeFile(temporary, `${JSON.stringify(draft)}\n`, {
          encoding: 'utf8',
          mode: 0o600,
        })
        await fs.rename(temporary, destination)
      } catch (error) {
        await fs.rm(temporary, { force: true }).catch(() => undefined)
        throw error
      }
      return draft
    })
  }

  async submit(
    subject: ReviewSubject,
    review: ReviewPayload,
    automaticSnapshot?: AutomaticReviewContext,
    expectedRevision?: number,
  ): Promise<ReviewRecord> {
    return this.serialize(async () => {
      const finals = await this.readFinalsNow()
      const latest = latestForSubject(finals, subject)
      if (subject.mode === 'calibration' && latest) {
        throw new ReviewLockedError('submitted calibration reviews are locked')
      }
      const revision = (latest?.revision ?? 0) + 1
      if (expectedRevision !== undefined && expectedRevision !== revision) {
        throw new ReviewConflictError(
          `review revision changed: expected ${expectedRevision}, current ${revision}`,
        )
      }
      if (review.reviewStatus === 'in_review') {
        throw new ReviewConflictError('a submitted review must be reviewed or skipped')
      }
      const draft = await this.readDraftNow(subject)
      const now = this.clock().toISOString()
      const record: ReviewRecord = {
        ...subject,
        ...review,
        revision,
        key: reviewRecordKey(subject, revision),
        locked: true,
        createdAt: draft?.revision === revision ? draft.createdAt : now,
        submittedAt: now,
        ...(automaticSnapshot ? { automaticSnapshot } : {}),
      }

      await fs.mkdir(path.dirname(this.finalsPath), { recursive: true })
      await fs.appendFile(this.finalsPath, `${JSON.stringify(record)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      })
      await fs.rm(this.draftPath(subject), { force: true })
      return record
    })
  }
}
