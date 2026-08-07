import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  defaultReviewBlindSecretPath,
  loadOrCreateReviewBlindSecret,
  REVIEW_BLIND_SECRET_BYTES,
} from './blindSecret'

let temporaryDirectory = ''

beforeEach(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-review-blind-secret-'))
})

afterEach(async () => {
  await fs.rm(temporaryDirectory, { recursive: true, force: true })
})

describe('review blind secret', () => {
  it('uses the machine-local path without touching it during path resolution', () => {
    expect(defaultReviewBlindSecretPath('/fake-home')).toBe(
      path.join('/fake-home', '.trace-viewer', 'review-blind-secret'),
    )
  })

  it('creates a 0600 secret once and reuses the same bytes', async () => {
    const secretPath = path.join(temporaryDirectory, '.trace-viewer', 'review-blind-secret')
    const first = loadOrCreateReviewBlindSecret(secretPath)
    const second = loadOrCreateReviewBlindSecret(secretPath)

    expect(first).toHaveLength(REVIEW_BLIND_SECRET_BYTES)
    expect(second.equals(first)).toBe(true)
    expect((await fs.stat(secretPath)).mode & 0o777).toBe(0o600)
    expect((await fs.readFile(secretPath, 'utf8')).trim()).toBe(first.toString('base64url'))
  })

  it('fails closed instead of replacing an invalid existing secret', async () => {
    const secretPath = path.join(temporaryDirectory, 'review-blind-secret')
    await fs.writeFile(secretPath, 'not-a-valid-secret\n', { mode: 0o644 })

    expect(() => loadOrCreateReviewBlindSecret(secretPath)).toThrow(
      `invalid review blind secret at ${secretPath}`,
    )
    expect(await fs.readFile(secretPath, 'utf8')).toBe('not-a-valid-secret\n')
    expect((await fs.stat(secretPath)).mode & 0o777).toBe(0o600)
  })
})
