"""Read-only ACE task scoring/split authority probe for Trace Cockpit.

The TypeScript server invokes this fixed script with the sibling ACE virtual
environment.  It imports the *current worktree* grader, executes its gating
branch for each supplied scenario, and resolves ``Scenario.split``.  It does
not run an episode, call a provider, or write any files.
"""

from __future__ import annotations

import ast
import hashlib
import inspect
import json
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

SCHEMA_VERSION = 1
MAX_SCENARIOS = 10_000


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _first_paragraph(value: str | None) -> str:
    if not value:
        return "Defined by the active ACE Python grader."
    return value.strip().split("\n\n", 1)[0].replace("\n", " ")


def _result_calls(source: str) -> dict[str, str]:
    """Return the check-name -> function-name map from the atomic grader AST.

    Refusing non-literal/dynamic definitions is deliberate: if the grader is
    refactored beyond what this fixed probe can prove, the caller must show
    semantics as unavailable rather than retaining an old table.
    """

    tree = ast.parse(source)
    grade_checks = next(
        (
            node
            for node in tree.body
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            and node.name == "_grade_checks"
        ),
        None,
    )
    if grade_checks is None:
        raise RuntimeError("grade_checks_missing")
    for node in grade_checks.body:
        if not isinstance(node, ast.Assign):
            continue
        if not any(isinstance(target, ast.Name) and target.id == "results" for target in node.targets):
            continue
        if not isinstance(node.value, ast.Dict):
            raise RuntimeError("dynamic_check_registry")
        mapping: dict[str, str] = {}
        # Keep the probe runnable with the macOS system Python used by the
        # isolated fixture test; AST dict key/value lengths are guaranteed.
        for key, value in zip(node.value.keys, node.value.values):
            if (
                not isinstance(key, ast.Constant)
                or not isinstance(key.value, str)
                or not isinstance(value, ast.Call)
                or not isinstance(value.func, ast.Name)
            ):
                raise RuntimeError("dynamic_check_registry")
            mapping[key.value] = value.func.id
        if not mapping:
            raise RuntimeError("empty_check_registry")
        return mapping
    raise RuntimeError("check_registry_missing")


def _validated_checks(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        raise RuntimeError("invalid_check_result")
    checks: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            raise RuntimeError("invalid_check_result")
        name = item.get("name")
        gating = item.get("gating")
        if not isinstance(name, str) or not name or not isinstance(gating, bool) or name in seen:
            raise RuntimeError("invalid_check_result")
        seen.add(name)
        checks.append({"name": name, "gating": gating})
    return checks


def main() -> None:
    request = json.load(sys.stdin)
    if not isinstance(request, dict) or request.get("schemaVersion") != SCHEMA_VERSION:
        raise RuntimeError("unsupported_request")
    entries = request.get("scenarios")
    if not isinstance(entries, list) or len(entries) > MAX_SCENARIOS:
        raise RuntimeError("invalid_scenarios")

    project_root = Path.cwd().resolve()
    grader_path = (
        project_root / "src" / "ace" / "evaluation" / "grading" / "atomic.py"
    )
    split_path = (
        project_root
        / "src"
        / "ace"
        / "simulation"
        / "environment"
        / "database.py"
    )
    grader_source = grader_path.read_text(encoding="utf-8")
    check_functions = _result_calls(grader_source)

    # Import only after reading the exact source that will be fingerprinted.
    # A fresh subprocess prevents stale module state across catalog refreshes.
    import ace.evaluation.grading.atomic as grading_module
    from ace.evaluation.scenarios import Scenario
    from ace.simulation.environment.database import Database

    if not callable(getattr(grading_module, "_grade_checks", None)):
        raise RuntimeError("grade_checks_not_callable")
    if not callable(getattr(Database, "split_of", None)):
        raise RuntimeError("split_resolver_not_callable")

    originals: dict[str, Any] = {}
    check_docs: dict[str, dict[str, str]] = {}
    for check_name, function_name in check_functions.items():
        function = getattr(grading_module, function_name, None)
        if not callable(function):
            raise RuntimeError("check_function_missing")
        originals[function_name] = function
        check_docs[check_name] = {
            "sourceSymbol": f"src/ace/evaluation/grading/atomic.py::{function_name}",
            "purpose": _first_paragraph(inspect.getdoc(function)),
        }

    # The check bodies are irrelevant to gating and require full EpisodeResult
    # state.  Replacing only the functions referenced by the source AST lets us
    # execute the real `_grade_checks` gating branch without fabricating world
    # or tool outcomes.  Any registry refactor above fails closed.
    def successful_check(*_args: Any, **_kwargs: Any) -> tuple[bool, str]:
        return True, "authority probe"

    for function_name in originals:
        setattr(grading_module, function_name, successful_check)

    output_scenarios: list[dict[str, Any]] = []
    try:
        for entry in entries:
            if not isinstance(entry, dict):
                raise RuntimeError("invalid_scenario_entry")
            key = entry.get("key")
            payload = entry.get("scenario")
            if not isinstance(key, str) or not key or not isinstance(payload, dict):
                raise RuntimeError("invalid_scenario_entry")
            try:
                scenario = Scenario.from_json(payload)
                completed = SimpleNamespace(status="completed", termination=None)
                interrupted = SimpleNamespace(status="cancelled", termination="authority_probe")
                _, completed_raw = grading_module._grade_checks(
                    scenario, completed, object(), "episode"
                )
                _, interrupted_raw = grading_module._grade_checks(
                    scenario, interrupted, object(), "episode"
                )
                completed_checks = _validated_checks(completed_raw)
                interrupted_checks = _validated_checks(interrupted_raw)
                if {item["name"] for item in completed_checks} != set(check_functions):
                    raise RuntimeError("check_registry_result_mismatch")
                extras = [
                    item
                    for item in interrupted_checks
                    if item["name"] not in {check["name"] for check in completed_checks}
                ]
                combined = completed_checks + extras
                effective_checks = []
                for check in combined:
                    docs = check_docs.get(check["name"])
                    if docs is None:
                        docs = {
                            "sourceSymbol": (
                                "src/ace/evaluation/grading/atomic.py::_grade_checks"
                            ),
                            "purpose": "Conditional episode-status gate emitted by the active grader.",
                        }
                    conditional = check["name"] not in {
                        item["name"] for item in completed_checks
                    }
                    effective_checks.append(
                        {
                            "name": check["name"],
                            **docs,
                            "gatingRule": (
                                "Emitted by the current Python grader for a non-completed episode."
                                if conditional
                                else "Resolved by the current Python grader for this exact task with a fixture."
                            ),
                            "effectiveGating": check["gating"],
                            "basis": (
                                "Runtime probe: conditional non-completed-status check."
                                if conditional
                                else "Runtime probe: _grade_checks returned "
                                + ("gating=true." if check["gating"] else "gating=false.")
                            ),
                        }
                    )
                output_scenarios.append(
                    {
                        "key": key,
                        "status": "verified",
                        "scenarioId": scenario.scenario_id,
                        "split": scenario.split,
                        "journeyKey": scenario.journey_key,
                        "effectiveChecks": effective_checks,
                    }
                )
            except Exception:
                # A malformed/unsupported task is isolated; no exception text
                # or scenario contents are reflected back to the browser.
                output_scenarios.append(
                    {"key": key, "status": "unavailable", "reason": "scenario_rejected"}
                )
    finally:
        for function_name, function in originals.items():
            setattr(grading_module, function_name, function)

    grade_contract = inspect.getdoc(grading_module._grade_checks)
    atomic_contract = inspect.getdoc(grading_module.grade_atomic)
    print(
        json.dumps(
            {
                "schemaVersion": SCHEMA_VERSION,
                "grader": {
                    "file": "src/ace/evaluation/grading/atomic.py",
                    "digest": _sha256(grader_path),
                    "symbol": "src/ace/evaluation/grading/atomic.py::grade_atomic",
                    "sourceContract": "\n\n".join(
                        value for value in (grade_contract, atomic_contract) if value
                    ),
                },
                "splitResolver": {
                    "file": "src/ace/simulation/environment/database.py",
                    "digest": _sha256(split_path),
                    "symbol": (
                        "src/ace/simulation/environment/database.py::Database.split_of"
                    ),
                    "sourceContract": inspect.getdoc(Database.split_of),
                },
                "scenarios": output_scenarios,
            },
            separators=(",", ":"),
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Stable machine-readable failure.  The TypeScript side deliberately
        # does not infer semantics from source text after a failed probe.
        print(
            json.dumps(
                {
                    "schemaVersion": SCHEMA_VERSION,
                    "ok": False,
                    "error": "authority_probe_failed",
                },
                separators=(",", ":"),
            )
        )
        raise SystemExit(2)
