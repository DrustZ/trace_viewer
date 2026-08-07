import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AceTaskEffectiveCheck } from '../../shared/schema/aceTasks'
import { aceChildEnvironment } from './childEnvironment'

const SCRIPT = fileURLToPath(new URL('./task_scoring_export.py', import.meta.url))
const OUTPUT_LIMIT = 16 * 1024 * 1024
const STDERR_LIMIT = 256 * 1024
const TIMEOUT_MS = 30_000

export interface AceTaskScoringProbeInput {
  key: string
  scenario: Record<string, unknown>
}

export interface AceTaskScoringProbeVerifiedScenario {
  key: string
  status: 'verified'
  scenarioId: string
  split: 'dev' | 'calibration' | 'holdout'
  journeyKey: string
  effectiveChecks: AceTaskEffectiveCheck[]
}

export interface AceTaskScoringProbeUnavailableScenario {
  key: string
  status: 'unavailable'
  reason: 'scenario_rejected'
}

export type AceTaskScoringProbeScenario =
  | AceTaskScoringProbeVerifiedScenario
  | AceTaskScoringProbeUnavailableScenario

export interface AceTaskScoringExport {
  schemaVersion: 1
  grader: {
    file: 'src/ace/scenario.py'
    digest: string
    symbol: 'src/ace/scenario.py::grade_atomic'
    sourceContract: string
  }
  splitResolver: {
    file: 'src/ace/db.py'
    digest: string
    symbol: 'src/ace/db.py::Database.split_of'
    sourceContract: string
  }
  scenarios: AceTaskScoringProbeScenario[]
}

export type AceTaskScoringExporter = (
  projectRoot: string,
  scenarios: readonly AceTaskScoringProbeInput[],
) => Promise<AceTaskScoringExport>

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function requiredString(owner: Record<string, unknown>, key: string): string {
  const value = owner[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`ACE scoring authority returned invalid ${key}`)
  }
  return value
}

function digest(owner: Record<string, unknown>, key: string): string {
  const value = requiredString(owner, key)
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`ACE scoring authority returned invalid ${key}`)
  }
  return value
}

function check(value: unknown): AceTaskEffectiveCheck {
  const row = object(value)
  if (!row || typeof row.effectiveGating !== 'boolean') {
    throw new Error('ACE scoring authority returned an invalid check')
  }
  return {
    name: requiredString(row, 'name'),
    sourceSymbol: requiredString(row, 'sourceSymbol'),
    purpose: requiredString(row, 'purpose'),
    gatingRule: requiredString(row, 'gatingRule'),
    effectiveGating: row.effectiveGating,
    basis: requiredString(row, 'basis'),
  }
}

function parseExport(value: unknown): AceTaskScoringExport {
  const root = object(value)
  if (root?.schemaVersion !== 1) {
    throw new Error('ACE scoring authority returned an unsupported response')
  }
  const grader = object(root.grader)
  const splitResolver = object(root.splitResolver)
  if (!grader || !splitResolver || !Array.isArray(root.scenarios)) {
    throw new Error('ACE scoring authority returned an incomplete response')
  }
  if (
    grader.file !== 'src/ace/scenario.py' ||
    grader.symbol !== 'src/ace/scenario.py::grade_atomic' ||
    splitResolver.file !== 'src/ace/db.py' ||
    splitResolver.symbol !== 'src/ace/db.py::Database.split_of'
  ) {
    throw new Error('ACE scoring authority returned unexpected source identities')
  }
  const seenKeys = new Set<string>()
  const scenarios = root.scenarios.map((value): AceTaskScoringProbeScenario => {
    const row = object(value)
    if (!row) throw new Error('ACE scoring authority returned an invalid scenario')
    const key = requiredString(row, 'key')
    if (seenKeys.has(key)) throw new Error('ACE scoring authority returned duplicate scenarios')
    seenKeys.add(key)
    if (row.status === 'unavailable' && row.reason === 'scenario_rejected') {
      return { key, status: 'unavailable', reason: 'scenario_rejected' }
    }
    if (
      row.status !== 'verified' ||
      (row.split !== 'dev' && row.split !== 'calibration' && row.split !== 'holdout') ||
      !Array.isArray(row.effectiveChecks)
    ) {
      throw new Error('ACE scoring authority returned an invalid scenario status')
    }
    const effectiveChecks = row.effectiveChecks.map(check)
    if (new Set(effectiveChecks.map(({ name }) => name)).size !== effectiveChecks.length) {
      throw new Error('ACE scoring authority returned duplicate checks')
    }
    return {
      key,
      status: 'verified',
      scenarioId: requiredString(row, 'scenarioId'),
      split: row.split,
      journeyKey: requiredString(row, 'journeyKey'),
      effectiveChecks,
    }
  })
  return {
    schemaVersion: 1,
    grader: {
      file: 'src/ace/scenario.py',
      digest: digest(grader, 'digest'),
      symbol: 'src/ace/scenario.py::grade_atomic',
      sourceContract: requiredString(grader, 'sourceContract'),
    },
    splitResolver: {
      file: 'src/ace/db.py',
      digest: digest(splitResolver, 'digest'),
      symbol: 'src/ace/db.py::Database.split_of',
      sourceContract: requiredString(splitResolver, 'sourceContract'),
    },
    scenarios,
  }
}

/** Execute the fixed, read-only probe with the sibling ACE virtual environment. */
export const runAceTaskScoringExport: AceTaskScoringExporter = (projectRoot, scenarios) =>
  new Promise((resolve, reject) => {
    const python = path.join(path.resolve(projectRoot), '.venv', 'bin', 'python')
    const existingPythonPath = process.env.PYTHONPATH
    const child = spawn(python, [SCRIPT], {
      cwd: path.resolve(projectRoot),
      env: {
        ...aceChildEnvironment(),
        PYTHONPATH: existingPythonPath
          ? `${path.resolve(projectRoot)}${path.delimiter}${existingPythonPath}`
          : path.resolve(projectRoot),
      },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let exceeded = false
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback()
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (stdout.length + chunk.length > OUTPUT_LIMIT) {
        exceeded = true
        child.kill('SIGTERM')
      } else stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_LIMIT)
    })
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish(() => reject(new Error('ACE scoring authority probe timed out')))
    }, TIMEOUT_MS)
    child.once('error', () => {
      finish(() => reject(new Error('ACE scoring authority Python runtime is unavailable')))
    })
    child.once('close', (code) => {
      finish(() => {
        if (exceeded) {
          reject(new Error('ACE scoring authority response exceeded its limit'))
          return
        }
        if (code !== 0) {
          reject(
            new Error(
              stderr.trim()
                ? 'ACE scoring authority probe failed in the current Python worktree'
                : 'ACE scoring authority probe failed',
            ),
          )
          return
        }
        try {
          resolve(parseExport(JSON.parse(stdout)))
        } catch {
          reject(new Error('ACE scoring authority returned invalid JSON'))
        }
      })
    })
    // Prevent an EPIPE from a probe that exits before reading stdin from
    // surfacing as an uncaught 'error' event; error/close above already report.
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify({ schemaVersion: 1, scenarios }))
  })
