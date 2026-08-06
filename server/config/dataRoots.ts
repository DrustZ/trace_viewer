import os from 'node:os'
import path from 'node:path'

/** Repository root, used so relative data paths do not depend on the launch directory. */
export const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..')

export interface DataRoot {
  /** Absolute filesystem path watched and scanned by the server. */
  path: string
  /** When set, every trace below this root belongs to this run. */
  run?: string
}

const RUN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Built-in roots are always enabled; TRACE_DATA_ROOTS only adds to (or labels) them. */
export const DEFAULT_DATA_ROOTS = [
  path.join(PROJECT_ROOT, 'data/runs'),
  path.join(PROJECT_ROOT, 'data/imported'),
]

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
): string[] {
  const roots = new Map<string, DataRoot>()
  for (const spec of DEFAULT_DATA_ROOTS) {
    const root = parseDataRootSpec(spec, baseDir)
    roots.set(root.path, root)
  }
  for (const spec of value?.split(path.delimiter) ?? []) {
    if (spec.trim().length === 0) continue
    const root = parseDataRootSpec(spec, baseDir)
    roots.set(root.path, root)
  }
  return [...roots.values()].map(formatDataRootSpec)
}
