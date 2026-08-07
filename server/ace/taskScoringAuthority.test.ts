import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runAceTaskScoringExport } from './taskScoringAuthority'

describe('fixed ACE Python scoring authority probe', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ace-scoring-authority-'))
    await fs.mkdir(path.join(root, '.venv', 'bin'), { recursive: true })
    await fs.mkdir(path.join(root, 'src', 'ace', 'evaluation', 'grading'), { recursive: true })
    await fs.mkdir(path.join(root, 'src', 'ace', 'simulation', 'environment'), {
      recursive: true,
    })
    for (const file of [
      ['ace', '__init__.py'],
      ['ace', 'evaluation', '__init__.py'],
      ['ace', 'evaluation', 'grading', '__init__.py'],
      ['ace', 'simulation', '__init__.py'],
      ['ace', 'simulation', 'environment', '__init__.py'],
    ]) {
      await fs.writeFile(path.join(root, 'src', ...file), '')
    }
    const python = path.join(root, '.venv', 'bin', 'python')
    await fs.writeFile(python, '#!/bin/sh\nexec python3 "$@"\n')
    await fs.chmod(python, 0o755)
    await fs.writeFile(
      path.join(root, 'src', 'ace', 'simulation', 'environment', 'database.py'),
      `class Database:
    @staticmethod
    def split_of(order_id):
        """Fixture split intentionally differs from the old TypeScript formula."""
        return "calibration" if order_id == "order_runtime" else "dev"
`,
    )
    await fs.writeFile(
      path.join(root, 'src', 'ace', 'evaluation', 'scenarios.py'),
      `from ace.simulation.environment.database import Database

class Scenario:
    def __init__(self, scenario_id, card, reward_basis, journey_id=None):
        self.scenario_id = scenario_id
        self.card = card
        self.reward_basis = tuple(reward_basis)
        self.journey_id = journey_id

    @classmethod
    def from_json(cls, value):
        return cls(value["scenario_id"], value["card"], value.get("reward_basis", ["ACTIONS"]), value.get("journey_id"))

    @property
    def split(self):
        return Database.split_of(self.card["order_id"])

    @property
    def journey_key(self):
        return self.journey_id or self.scenario_id
`,
    )
    await fs.writeFile(
      path.join(root, 'src', 'ace', 'evaluation', 'grading', 'atomic.py'),
      `

def _check_expected_actions(*args):
    """Checks expected actions from the current Python source."""
    return True, "ok"

def _check_required_info(*args):
    """Checks required information from the current Python source."""
    return True, "ok"

def _grade_checks(scenario, result, fixture, scored_tier):
    """REQUIRED_INFO gates iff the current task lists it in reward_basis."""
    results = {
        "ACTIONS": _check_expected_actions(scenario, result, scored_tier),
        "REQUIRED_INFO": _check_required_info(scenario, result),
    }
    checks, passed = [], True
    for name, (ok, detail) in results.items():
        gating = name in scenario.reward_basis
        checks.append({"name": name, "ok": ok, "gating": gating, "detail": detail})
    if result.status != "completed":
        checks.append({"name": "TERMINATION", "ok": False, "gating": True, "detail": "stopped"})
    return passed, checks

def grade_atomic(*args):
    """Binary product over current gating checks."""
    return {}
`,
    )
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('executes current REQUIRED_INFO gating and Scenario.split semantics', async () => {
    const exported = await runAceTaskScoringExport(root, [
      {
        key: 'definition-a',
        scenario: {
          scenario_id: 'task-runtime',
          journey_id: null,
          card: { order_id: 'order_runtime' },
          reward_basis: ['ACTIONS', 'REQUIRED_INFO'],
        },
      },
    ])

    expect(exported.scenarios).toEqual([
      expect.objectContaining({
        key: 'definition-a',
        status: 'verified',
        scenarioId: 'task-runtime',
        split: 'calibration',
        journeyKey: 'task-runtime',
        effectiveChecks: expect.arrayContaining([
          expect.objectContaining({ name: 'REQUIRED_INFO', effectiveGating: true }),
          expect.objectContaining({ name: 'TERMINATION', effectiveGating: true }),
        ]),
      }),
    ])
    expect(exported.grader.digest).toMatch(/^[a-f0-9]{64}$/)
    expect(exported.splitResolver.sourceContract).toContain('intentionally differs')
  })
})
