import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Repository root, used so relative data paths do not depend on the launch directory. */
export const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..')
export const LOCAL_DATA_ROOTS_FILE = path.join(PROJECT_ROOT, '.trace-viewer', 'data-roots.json')

export interface DataRoot {
  /** Absolute filesystem path watched and scanned by the server. */
  path: string
  /** When set, every trace below this root belongs to this run. */
  run?: string
}

const RUN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export const MAX_DATA_ROOT_LABEL_LENGTH = 64

/** Labels become run ids, so keep them short and filename/URL friendly. */
export function isValidDataRootLabel(value: string): boolean {
  return value.length <= MAX_DATA_ROOT_LABEL_LENGTH && RUN_NAME.test(value)
}

/** Built-in roots are always enabled; TRACE_DATA_ROOTS only adds to (or labels) them. */
export const DEFAULT_DATA_ROOTS = [
  path.join(PROJECT_ROOT, 'data/runs'),
  path.join(PROJECT_ROOT, 'data/imported'),
]

/**
 * UI-added folders are intentionally constrained to explicit workspace
 * parents.  The default covers this repository and sibling projects (such as
 * ac_express) without granting a browser access to the whole home directory.
 */
export function resolveAllowedDataParents(
  value = process.env.TRACE_VIEWER_ALLOWED_DATA_PARENTS,
  baseDir = PROJECT_ROOT,
): string[] {
  const configured = value
    ?.split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  return (configured && configured.length > 0 ? configured : [path.dirname(PROJECT_ROOT)]).map(
    (entry) => path.resolve(baseDir, entry),
  )
}

/**
 * Parse one root spec. `run-name=/path/to/corpus` pins every trace to a run;
 * an unlabelled spec is just a path. The first `=` is treated as a label separator
 * only when its left-hand side is a valid run name.
 */
export function parseDataRootSpec(spec: string, baseDir = PROJECT_ROOT): DataRoot {
  const trimmed = spec.trim()
  const equals = trimmed.indexOf('=')
  const possibleRun = equals > 0 ? trimmed.slice(0, equals).trim() : ''
  const labelled = equals > 0 && RUN_NAME.test(possibleRun)
  const rawPath = (labelled ? trimmed.slice(equals + 1) : trimmed).trim()
  if (rawPath.length === 0) throw new Error(`invalid data root: ${JSON.stringify(spec)}`)
  return {
    path: path.resolve(baseDir, rawPath),
    ...(labelled ? { run: possibleRun } : {}),
  }
}

/** Canonical string representation kept compatible with RouteCtx's string[] dependency. */
export function formatDataRootSpec(root: DataRoot): string {
  return root.run ? `${root.run}=${root.path}` : root.path
}

/** Stable opaque id suitable for UI/API use without returning an absolute path. */
export function dataRootId(rootPath: string): string {
  return createHash('sha256').update(path.resolve(rootPath)).digest('hex').slice(0, 12)
}

/** A UI/API-safe locator that never contains the current account name or arbitrary parents. */
export function displayDataRootPath(rootPath: string): string {
  const projectRelative = path.relative(PROJECT_ROOT, rootPath)
  if (
    projectRelative !== '' &&
    !projectRelative.startsWith('..') &&
    !path.isAbsolute(projectRelative)
  ) {
    return projectRelative
  }
  const homeRelative = path.relative(os.homedir(), rootPath)
  if (homeRelative !== '' && !homeRelative.startsWith('..') && !path.isAbsolute(homeRelative)) {
    return path.join('~', homeRelative)
  }
  return path.basename(rootPath) || 'filesystem root'
}

/**
 * Resolve the complete root list. Entries in TRACE_DATA_ROOTS are separated with the
 * platform delimiter (`:` on macOS/Linux, `;` on Windows). Environment entries win when
 * the same directory is repeated, which allows a built-in root to be given an explicit run.
 */
export function resolveDataRoots(
  value = process.env.TRACE_DATA_ROOTS,
  baseDir = PROJECT_ROOT,
  discovery: {
    aceProjectRoot?: string
    aceRunRoot?: string
    persistedRoots?: readonly string[]
  } = {},
): string[] {
  const roots = new Map<string, DataRoot>()
  for (const spec of DEFAULT_DATA_ROOTS) {
    const root = parseDataRootSpec(spec, baseDir)
    roots.set(root.path, root)
  }
  for (const spec of discovery.persistedRoots ?? []) {
    const root = parseDataRootSpec(spec, baseDir)
    roots.set(root.path, root)
  }
  for (const spec of value?.split(path.delimiter) ?? []) {
    if (spec.trim().length === 0) continue
    const root = parseDataRootSpec(spec, baseDir)
    roots.set(root.path, root)
  }
  // Local ACE cockpit convention. An explicit TRACE_DATA_ROOTS entry still wins by path.
  // Auto-discovery is intentionally limited to the sibling project used by this workspace;
  // no arbitrary directory walking or upload occurs.
  const aceProject = path.resolve(
    discovery.aceProjectRoot ??
      process.env.ACE_PROJECT_ROOT ??
      path.join(PROJECT_ROOT, '..', 'ac_express'),
  )
  const aceCorpus = path.join(aceProject, 'data')
  const aceRuns = path.resolve(
    discovery.aceRunRoot ?? process.env.ACE_RUN_ROOT ?? path.join(aceProject, 'runs', 'episodes'),
  )
  if (existsSync(aceCorpus)) {
    const root = parseDataRootSpec(`production=${aceCorpus}`, baseDir)
    if (!roots.has(root.path)) roots.set(root.path, root)
  }
  if (existsSync(aceRuns)) {
    const root = parseDataRootSpec(aceRuns, baseDir)
    if (!roots.has(root.path)) roots.set(root.path, root)
  }
  return [...roots.values()].map(formatDataRootSpec)
}

/** Read the ignored, machine-local root registry. Invalid content fails closed at startup. */
export function loadLocalDataRoots(filePath = LOCAL_DATA_ROOTS_FILE): string[] {
  if (!existsSync(filePath)) return []
  const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('schemaVersion' in parsed) ||
    (parsed as { schemaVersion?: unknown }).schemaVersion !== 1 ||
    !('roots' in parsed) ||
    !Array.isArray((parsed as { roots?: unknown }).roots) ||
    !(parsed as { roots: unknown[] }).roots.every((item) => typeof item === 'string')
  ) {
    throw new Error('local data-root registry must be schemaVersion 1 with a string roots array')
  }
  const roots = (parsed as { roots: string[] }).roots
  for (const spec of roots) parseDataRootSpec(spec)
  return roots
}
