import { randomBytes } from 'node:crypto'
import { chmodSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const REVIEW_BLIND_SECRET_BYTES = 32

export function defaultReviewBlindSecretPath(homeDirectory = os.homedir()): string {
  return path.join(homeDirectory, '.trace-viewer', 'review-blind-secret')
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function decodeSecret(encoded: string, filePath: string): Buffer {
  const value = encoded.trim()
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new Error(`invalid review blind secret at ${filePath}`)
  }
  const secret = Buffer.from(value, 'base64url')
  if (secret.length !== REVIEW_BLIND_SECRET_BYTES || secret.toString('base64url') !== value) {
    throw new Error(`invalid review blind secret at ${filePath}`)
  }
  return secret
}

function readSecret(filePath: string): Buffer {
  const metadata = lstatSync(filePath)
  if (!metadata.isFile()) {
    throw new Error(`review blind secret is not a regular file: ${filePath}`)
  }
  chmodSync(filePath, 0o600)
  return decodeSecret(readFileSync(filePath, 'utf8'), filePath)
}

/**
 * Loads the stable machine-local HMAC key used for Calibration aliases.
 * The first writer wins atomically; an existing malformed file is never replaced.
 */
export function loadOrCreateReviewBlindSecret(filePath = defaultReviewBlindSecretPath()): Buffer {
  try {
    return readSecret(filePath)
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') throw error
  }

  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
  const secret = randomBytes(REVIEW_BLIND_SECRET_BYTES)
  try {
    writeFileSync(filePath, `${secret.toString('base64url')}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    chmodSync(filePath, 0o600)
    return secret
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'EEXIST') throw error
    return readSecret(filePath)
  }
}

export function copyInjectedReviewBlindSecret(secret: Buffer): Buffer {
  if (!Buffer.isBuffer(secret) || secret.length !== REVIEW_BLIND_SECRET_BYTES) {
    throw new Error(`review blind secret must be a ${REVIEW_BLIND_SECRET_BYTES}-byte Buffer`)
  }
  return Buffer.from(secret)
}
