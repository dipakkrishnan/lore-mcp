#!/usr/bin/env python
"""Run every check in this repo and hold each of them to its floor.

    uv run python tests/gate.py                # everything available
    uv run python tests/gate.py --require-node # fail instead of skipping the Worker

Two languages live here. The Python package in `lore/` is gated on coverage:
every file must reach 90% statement coverage *and* 90% branch coverage. Why not
just `fail_under = 90`? Because coverage.py checks one *global* combined number,
so a file at 96% statements and 70% branches hides behind it, and a well-covered
module can carry a bare one. This checks the two metrics separately, per file.

The Worker in `lore/node/` is gated on three things instead — it has no coverage
measurement, and pretending otherwise would be worse than saying so:

  * `tsc --noEmit`              — the source still type-checks
  * `wrangler deploy --dry-run` — it still bundles, which is what a deploy does
  * `npm test`                 — the Workerd component and unit tests

The Worker checks need `npm install` to have been run in `lore/node/`. Without
that they are reported as SKIPPED and the gate still passes, so a Python-only
contributor is not blocked by a Node toolchain. Pass
`--require-node` (what CI should do) to turn a skip into a failure.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

FLOOR = 90.0
ROOT = Path(__file__).resolve().parent.parent
NODE = ROOT / "lore/node"


def _percent(covered: int, total: int) -> float:
    """A file with nothing to measure is not a gap; treat it as fully covered."""
    return 100.0 if not total else 100.0 * covered / total


def _heading(text: str) -> None:
    print(f"\n\033[1m{text}\033[0m" if sys.stdout.isatty() else f"\n{text}")


def python_gate(pytest_args: list[str]) -> int:
    """Run the Python suite under coverage and check every file against FLOOR."""
    _heading("Python — tests")
    tests = subprocess.run(
        [sys.executable, "-m", "coverage", "run", "-m", "pytest", *pytest_args],
        cwd=ROOT,
    )
    if tests.returncode:
        print("\ngate: the Python suite failed; coverage not evaluated.")
        return tests.returncode

    with tempfile.NamedTemporaryFile(suffix=".json") as report:
        written = subprocess.run(
            [sys.executable, "-m", "coverage", "json", "-o", report.name, "--quiet"],
            cwd=ROOT,
        )
        if written.returncode:
            return written.returncode
        files = json.loads(Path(report.name).read_text(encoding="utf-8"))["files"]

    _heading("Python — per-file coverage")
    print(f"{'File':<24}{'Stmt %':>9}{'Branch %':>10}")
    failures: list[str] = []
    for name in sorted(files):
        summary = files[name]["summary"]
        statements = _percent(summary["covered_lines"], summary["num_statements"])
        branches = _percent(summary["covered_branches"], summary["num_branches"])
        short = min(statements, branches) < FLOOR
        print(
            f"{name:<24}{statements:>8.1f}%{branches:>9.1f}%"
            f"{'  <- below floor' if short else ''}"
        )
        if short:
            failures.append(
                f"{name}: {statements:.1f}% statements, {branches:.1f}% branches"
            )

    if failures:
        print(f"\ngate: {len(failures)} file(s) below {FLOOR:.0f}% —")
        for failure in failures:
            print(f"  {failure}")
        return 1
    print(f"\nEvery file in lore/ is at or above {FLOOR:.0f}% on both metrics.")
    return 0


def node_gate(*, required: bool) -> int:
    """Type-check, bundle, and unit-test the Worker that `lore node deploy` ships."""
    _heading("Worker (lore/node)")
    missing = (
        [str(NODE.relative_to(ROOT))] if not (NODE / "node_modules").is_dir() else []
    )
    if not shutil.which("npm"):
        missing.append("npm (not on PATH)")
    if missing:
        print(f"SKIPPED — dependencies not installed: {', '.join(missing)}")
        print(f"  install with: npm --prefix {NODE.relative_to(ROOT)} install")
        if required:
            print("gate: --require-node was passed, so a skip is a failure.")
            return 1
        return 0

    steps = (
        ("type check", ["npm", "--prefix", str(NODE), "run", "check"], ROOT),
        # A bundle failure is a deploy failure; catching it here costs seconds,
        # and catching it inside `lore node deploy` costs an owner their evening.
        (
            "bundle",
            ["npx", "wrangler", "deploy", "--dry-run", "--outdir", tempfile.mkdtemp()],
            NODE,
        ),
        ("unit tests", ["npm", "test"], NODE),
    )
    for label, command, cwd in steps:
        print(f"\n$ {' '.join(command)}")
        result = subprocess.run(command, cwd=cwd)
        if result.returncode:
            print(f"\ngate: the Worker {label} failed.")
            return result.returncode
    print("\nWorker type-checks, bundles, and passes its unit tests.")
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="gate")
    parser.add_argument(
        "--require-node",
        action="store_true",
        help="fail instead of skipping when the Worker's dependencies are absent",
    )
    # Anything this parser does not claim goes straight to pytest, so
    # `tests/gate.py -q tests/test_cli.py` works the way it reads.
    args, pytest_args = parser.parse_known_args(argv)

    python = python_gate(pytest_args)
    node = node_gate(required=args.require_node)

    _heading("Result")
    for label, code in (("python", python), ("worker", node)):
        print(f"  {label:<8}{'ok' if code == 0 else 'FAILED'}")
    return python or node


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
