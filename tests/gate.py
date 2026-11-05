#!/usr/bin/env python
"""Run every check in this repo and hold each of them to its floor.

    uv run python tests/gate.py                # everything available
    uv run python tests/gate.py --require-node # fail instead of skipping the Worker
    uv run python tests/gate.py --python-only  # the Python half, as CI runs it

Two languages live here. The Python package in `lore/` is gated on coverage:
every file must reach 90% statement coverage *and* 90% branch coverage. Why not
just `fail_under = 90`? Because coverage.py checks one *global* combined number,
so a file at 96% statements and 70% branches hides behind it, and a well-covered
module can carry a bare one. This checks the two metrics separately, per file.

Each Worker (`lore/node/`, the owner's deployable node; `feedback-relay/`, the
maintainer-operated feedback relay) is gated on three things instead — neither
has coverage measurement, and pretending otherwise would be worse than saying so:

  * `tsc --noEmit`              — the source still type-checks
  * `wrangler deploy --dry-run` — it still bundles, which is what a deploy does
  * `npm test`                 — the Workerd component and unit tests

The Worker checks need `npm install` to have been run in each directory.
Without that, that Worker is reported as SKIPPED and the gate still passes,
so a Python-only contributor is not blocked by a Node toolchain. Pass
`--require-node` (what CI should do) to turn a skip into a failure.

`--python-only` (XC-096) is what the `Python unit tests` CI job runs: the
Worker checks are that workflow's own jobs, so only the Python suite runs,
quietly, and the per-file table is printed as Markdown. Whenever
`GITHUB_STEP_SUMMARY` is set, the table is appended to it too, so a reader
sees which file moved without opening the log.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

FLOOR = 90.0
ROOT = Path(__file__).resolve().parent.parent
WORKERS = (ROOT / "lore/node", ROOT / "feedback-relay")


@dataclass(frozen=True)
class FileCoverage:
    """One file's two coverage numbers, as the gate judges them."""

    name: str
    statements: float
    branches: float

    @property
    def short(self) -> bool:
        return min(self.statements, self.branches) < FLOOR


def _percent(covered: int, total: int) -> float:
    """A file with nothing to measure is not a gap; treat it as fully covered."""
    return 100.0 if not total else 100.0 * covered / total


def _heading(text: str) -> None:
    # Flushed, so the heading lands before the output of the child it introduces.
    print(f"\n\033[1m{text}\033[0m" if sys.stdout.isatty() else f"\n{text}", flush=True)


def _summarise(markdown: str) -> None:
    """Append to the GitHub step summary when there is one; a no-op elsewhere."""
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as out:
            out.write(markdown.rstrip("\n") + "\n\n")


def run_python_suite(pytest_args: list[str], *, quiet: bool) -> int:
    """Run the Python suite under coverage; the exit code is pytest's."""
    quietly = ["-q"] if quiet else []
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "coverage",
            "run",
            "-m",
            "pytest",
            *quietly,
            *pytest_args,
        ],
        cwd=ROOT,
    )
    return result.returncode


def per_file_coverage() -> list[FileCoverage]:
    """Read the per-file numbers from the coverage data the suite just wrote."""
    with tempfile.NamedTemporaryFile(suffix=".json") as report:
        subprocess.run(
            [sys.executable, "-m", "coverage", "json", "-o", report.name, "--quiet"],
            cwd=ROOT,
            check=True,
        )
        files = json.loads(Path(report.name).read_text(encoding="utf-8"))["files"]
    rows: list[FileCoverage] = []
    for name in sorted(files):
        summary = files[name]["summary"]
        rows.append(
            FileCoverage(
                name,
                _percent(summary["covered_lines"], summary["num_statements"]),
                _percent(summary["covered_branches"], summary["num_branches"]),
            )
        )
    return rows


def text_table(rows: list[FileCoverage]) -> str:
    width = max([24, *(len(row.name) for row in rows)])
    lines = [f"{'File':<{width}}{'Stmt %':>9}{'Branch %':>10}"]
    for row in rows:
        lines.append(
            f"{row.name:<{width}}{row.statements:>8.1f}%{row.branches:>9.1f}%"
            f"{'  <- below floor' if row.short else ''}"
        )
    return "\n".join(lines)


def markdown_table(rows: list[FileCoverage]) -> str:
    lines = ["| File | Statements | Branches | Floor |", "|---|---:|---:|---|"]
    for row in rows:
        verdict = "**below**" if row.short else "ok"
        lines.append(
            f"| `{row.name}` | {row.statements:.1f}% | {row.branches:.1f}% | {verdict} |"
        )
    return "\n".join(lines)


def python_gate(pytest_args: list[str], *, python_only: bool = False) -> int:
    """Run the Python suite under coverage and check every file against FLOOR."""
    _heading("Python — tests")
    code = run_python_suite(pytest_args, quiet=python_only)
    if code:
        print("\ngate: the Python suite failed; coverage not evaluated.")
        _summarise(
            "## Python per-file coverage\n\n"
            "The Python suite failed, so coverage was not evaluated."
        )
        return code
    rows = per_file_coverage()

    _heading("Python — per-file coverage")
    print(markdown_table(rows) if python_only else text_table(rows))

    failures = [row for row in rows if row.short]
    if failures:
        verdict = (
            f"{len(failures)} file(s) below {FLOOR:.0f}% on statements or branches."
        )
        print(f"\ngate: {len(failures)} file(s) below {FLOOR:.0f}% —")
        for row in failures:
            print(
                f"  {row.name}: {row.statements:.1f}% statements,"
                f" {row.branches:.1f}% branches"
            )
    else:
        verdict = f"Every file in lore/ is at or above {FLOOR:.0f}% on both metrics."
        print(f"\n{verdict}")
    _summarise(f"## Python per-file coverage\n\n{markdown_table(rows)}\n\n{verdict}")
    return 1 if failures else 0


def one_worker_gate(worker: Path, *, required: bool) -> int:
    """Type-check, bundle, and unit-test one Worker directory."""
    _heading(f"Worker ({worker.relative_to(ROOT)})")
    missing = (
        [str(worker.relative_to(ROOT))]
        if not (worker / "node_modules").is_dir()
        else []
    )
    if not shutil.which("npm"):
        missing.append("npm (not on PATH)")
    if missing:
        print(f"SKIPPED — dependencies not installed: {', '.join(missing)}")
        print(f"  install with: npm --prefix {worker.relative_to(ROOT)} install")
        if required:
            print("gate: --require-node was passed, so a skip is a failure.")
            return 1
        return 0

    steps = (
        ("type check", ["npm", "--prefix", str(worker), "run", "check"], ROOT),
        # A bundle failure is a deploy failure; catching it here costs seconds,
        # and catching it inside a real deploy costs the owner or maintainer
        # their evening.
        (
            "bundle",
            ["npx", "wrangler", "deploy", "--dry-run", "--outdir", tempfile.mkdtemp()],
            worker,
        ),
        ("unit tests", ["npm", "test"], worker),
    )
    for label, command, cwd in steps:
        print(f"\n$ {' '.join(command)}")
        result = subprocess.run(command, cwd=cwd)
        if result.returncode:
            print(f"\ngate: the {worker.relative_to(ROOT)} Worker {label} failed.")
            return result.returncode
    print(
        f"\n{worker.relative_to(ROOT)} type-checks, bundles, and passes its unit tests."
    )
    return 0


def node_gate(*, required: bool) -> int:
    """Run one_worker_gate over every Worker directory; fail on the first failure."""
    for worker in WORKERS:
        code = one_worker_gate(worker, required=required)
        if code:
            return code
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="gate")
    parser.add_argument(
        "--require-node",
        action="store_true",
        help="fail instead of skipping when a Worker's dependencies are absent",
    )
    parser.add_argument(
        "--python-only",
        action="store_true",
        help="run only the Python suite, quietly, and print the table as Markdown",
    )
    # Anything this parser does not claim goes straight to pytest, so
    # `tests/gate.py -q tests/test_cli.py` works the way it reads.
    args, pytest_args = parser.parse_known_args(argv)
    if args.python_only and args.require_node:
        parser.error(
            "--python-only runs no Worker check, so --require-node has no meaning"
        )

    python = python_gate(pytest_args, python_only=args.python_only)
    if args.python_only:
        return python
    node = node_gate(required=args.require_node)

    _heading("Result")
    for label, code in (("python", python), ("worker", node)):
        print(f"  {label:<8}{'ok' if code == 0 else 'FAILED'}")
    return python or node


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
