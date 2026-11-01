#!/usr/bin/env python3
"""Measure the CI items' trailing-window criteria (XC-083) from the Actions API.

The 2026-10-27 CI stack (XC-077, XC-078, XC-080, XC-081, APP-247, XC-084) each
carried an acceptance criterion of the shape "over the N runs after it lands,
X is no worse than Y". Those moved to XC-083, and this script computes them, so
the measurement is the same every time it is taken and nobody has to re-derive
the queries from the items' prose.

It reads `tests.yml` runs created since `--since` through `gh api` (the caller
is signed in; nothing here holds a token), fetches each run's jobs, and for
every `Desktop macOS checks` job that ran, its log, from which it reads the
walks step's `PASS|FAIL agents (alone)` group, the `K of N walks passed on
retry.` line and the cache lines. It prints a Markdown report: one row per
criterion with the window, the value, the baseline from the item, and whether
the value is inside it. It changes nothing; writing the figures into the items'
Notes and ticking XC-083's boxes is the reader's job (the audit playbook).

Usage:
    uv run python docs/backlog/agents/measure_ci_window.py --since 2026-10-27T13:50:00Z
    uv run python docs/backlog/agents/measure_ci_window.py --since ... --max-runs 250 --json runs.json

`--json` writes the per-run facts the report was computed from, so a later
reading can be checked without re-fetching logs. `--from-json` reads such a
file instead of calling the API (used by the tests).
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import subprocess
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

REPO = "dipakkrishnan/lore-mcp"
WORKFLOW = "tests.yml"
DESKTOP_JOB = "Desktop macOS checks"
WALKS_STEP = "Run node support/walks.cjs --jobs 2"

AGENTS_FIRST_RE = re.compile(r"##\[group\](PASS|FAIL) agents(?: \(alone\))? \((\d+)s")
RETRIED_RE = re.compile(r"(\d+) of (\d+) walks passed on retry\.")
RETRY_GROUP_RE = re.compile(r"##\[group\]PASS (.+?) on retry")
CACHE_RE = re.compile(
    r"Cache (not found for input keys|restored from key|saved with key)"
)


@dataclass
class Run:
    """What one `tests.yml` run says about the desktop job."""

    id: int
    event: str
    head_branch: str
    created_at: str
    conclusion: str | None
    desktop_conclusion: str | None = (
        None  # success | failure | skipped | cancelled | None
    )
    desktop_started_at: str | None = None
    desktop_completed_at: str | None = None
    agents_first_attempt: str | None = (
        None  # PASS | FAIL | None when agents did not run
    )
    agents_first_seconds: int | None = None
    walks_retried: int | None = None  # K from "K of N walks passed on retry."
    walks_total: int | None = None
    retried_walks: list[str] = field(default_factory=list)
    cache: str | None = None  # miss | hit | None


@dataclass
class Figure:
    item: str
    criterion: str
    window: str
    value: str
    baseline: str
    inside: bool | None  # None when the window is too short to judge


def gh(path: str, tries: int = 6) -> str:
    """One `gh api` call's body, retried with a growing pause: the Actions API answers
    502 for the same run several times in a row now and then, then recovers."""
    error = ""
    for attempt in range(tries):
        done = subprocess.run(["gh", "api", path], capture_output=True, text=True)
        if done.returncode == 0:
            return done.stdout
        error = done.stderr.strip()
        time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"gh api {path}: {error}")


def gh_json(path: str) -> object:
    return json.loads(gh(path))


def gh_text(path: str) -> str:
    """A job log; an expired or missing log is an empty string, not a failure."""
    try:
        return gh(path)
    except RuntimeError:
        return ""


def seconds_between(start: str | None, end: str | None) -> float | None:
    if not start or not end:
        return None
    parse = lambda s: datetime.fromisoformat(s.replace("Z", "+00:00"))  # noqa: E731
    return (parse(end) - parse(start)).total_seconds()


def parse_walks_log(text: str) -> dict[str, object]:
    """The facts the report needs from a desktop job's log."""
    facts: dict[str, object] = {}
    first = AGENTS_FIRST_RE.search(text)
    if first:
        facts["agents_first_attempt"] = first.group(1)
        facts["agents_first_seconds"] = int(first.group(2))
    retried = RETRIED_RE.search(text)
    if retried:
        facts["walks_retried"] = int(retried.group(1))
        facts["walks_total"] = int(retried.group(2))
    facts["retried_walks"] = RETRY_GROUP_RE.findall(text)
    cache = CACHE_RE.search(text)
    if cache:
        facts["cache"] = "miss" if cache.group(1).startswith("not found") else "hit"
    return facts


def fetch_runs(since: str, max_runs: int) -> list[Run]:
    """Every `tests.yml` run created at or after `since`, oldest first, with its desktop facts."""
    runs: list[Run] = []
    page = 1
    while len(runs) < max_runs:
        answer = gh_json(
            f"repos/{REPO}/actions/workflows/{WORKFLOW}/runs"
            f"?per_page=100&page={page}&created=>={since}"
        )
        assert isinstance(answer, dict)
        batch = answer.get("workflow_runs", [])
        if not batch:
            break
        for raw in batch:
            runs.append(
                Run(
                    id=raw["id"],
                    event=raw["event"],
                    head_branch=raw["head_branch"] or "",
                    created_at=raw["created_at"],
                    conclusion=raw["conclusion"],
                )
            )
        page += 1
    runs = sorted(runs, key=lambda r: r.created_at)[:max_runs]
    for run in runs:
        jobs = gh_json(f"repos/{REPO}/actions/runs/{run.id}/jobs?per_page=100")
        assert isinstance(jobs, dict)
        desktop = next(
            (j for j in jobs.get("jobs", []) if j["name"] == DESKTOP_JOB), None
        )
        if desktop is None:
            continue
        run.desktop_conclusion = desktop["conclusion"]
        run.desktop_started_at = desktop["started_at"]
        run.desktop_completed_at = desktop["completed_at"]
        if desktop["conclusion"] in ("success", "failure"):
            facts = parse_walks_log(
                gh_text(f"repos/{REPO}/actions/jobs/{desktop['id']}/logs")
            )
            for key, value in facts.items():
                setattr(run, key, value)
    return runs


def percent(part: int, whole: int) -> str:
    return f"{part} of {whole} ({100 * part / whole:.1f}%)" if whole else "0 of 0"


def figures(runs: list[Run]) -> list[Figure]:
    """The six XC-083 rows, from the runs in the window."""
    ran = [r for r in runs if r.desktop_conclusion in ("success", "failure")]
    failed = [r for r in ran if r.desktop_conclusion == "failure"]
    prs = [r for r in runs if r.event == "pull_request"]
    pr_with_mac = [r for r in prs if r.desktop_conclusion not in (None, "skipped")]
    window = f"{len(runs)} runs" + (
        f", {runs[0].created_at[:10]} to {runs[-1].created_at[:10]}" if runs else ""
    )
    enough = len(runs) >= 50
    rows: list[Figure] = []

    rate = 100 * len(failed) / len(ran) if ran else 0.0
    rows.append(
        Figure(
            "XC-077",
            "desktop job failure rate",
            window,
            percent(len(failed), len(ran)),
            "no worse than 21.1% (48 of 228)",
            (rate <= 21.1) if enough else None,
        )
    )

    share = 100 * len(pr_with_mac) / len(prs) if prs else 0.0
    rows.append(
        Figure(
            "XC-078",
            "PR runs that start a macOS job",
            f"{len(prs)} PR runs",
            percent(len(pr_with_mac), len(prs)),
            "about 68% or less (130 of 191)",
            (share <= 70.0) if enough else None,
        )
    )

    retried_runs = [r for r in ran if (r.walks_retried or 0) > 0]
    retried_total = sum(r.walks_retried or 0 for r in ran)
    rows.append(
        Figure(
            "XC-080",
            "desktop job failure rate, with retries counted",
            window,
            f"{percent(len(failed), len(ran))} failed; {retried_total} walks passed on retry across {len(retried_runs)} runs",
            "fails on fewer than 3% of runs; retried count reported alongside",
            (rate < 3.0) if enough else None,
        )
    )

    superseded = 0
    for i, run in enumerate(prs):
        if run.desktop_completed_at is None or run.desktop_conclusion in (
            "skipped",
            "cancelled",
        ):
            continue
        newer = [n for n in prs[i + 1 :] if n.head_branch == run.head_branch]
        if any(n.created_at < run.desktop_completed_at for n in newer):
            superseded += 1
    rows.append(
        Figure(
            "XC-081",
            "PR macOS jobs that finished after a newer run on the same PR started",
            f"{len(prs)} PR runs (criterion asks for 200)",
            str(superseded),
            "0 (baseline 15 runs, 187.4 macOS-min)",
            (superseded == 0) if len(prs) >= 200 else None,
        )
    )

    green = [r for r in ran if r.desktop_conclusion == "success"]
    durations = [
        d
        for d in (
            seconds_between(r.desktop_started_at, r.desktop_completed_at)
            for r in green[-8:]
        )
        if d is not None
    ]
    median = statistics.median(durations) if durations else None
    rows.append(
        Figure(
            "APP-247",
            "median desktop job duration, last 8 green runs",
            f"{len(durations)} green runs",
            f"{median / 60:.1f} min" if median else "n/a",
            "at least 40 s under the two-connectors-walk figure (697 s on run 40451983212)",
            (median <= 697 - 40) if median and len(durations) >= 8 else None,
        )
    )

    agents_ran = [r for r in ran if r.agents_first_attempt]
    agents_failed = [r for r in agents_ran if r.agents_first_attempt == "FAIL"]
    agents_rate = 100 * len(agents_failed) / len(agents_ran) if agents_ran else 0.0
    rows.append(
        Figure(
            "XC-084",
            "agents first-attempt failures",
            f"{len(agents_ran)} runs where agents ran",
            percent(len(agents_failed), len(agents_ran)),
            "5% or less (11 of 228 serial; 3 of 4 beside another walk)",
            (agents_rate <= 5.0) if enough else None,
        )
    )
    return rows


def report(runs: list[Run], since: str) -> str:
    rows = figures(runs)
    verdict = {True: "inside", False: "WORSE", None: "window too short"}
    lines = [
        f"## XC-083 measurement, `tests.yml` runs since {since}",
        "",
        f"{len(runs)} runs read on {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%MZ')}.",
        "",
        "| Item | Criterion | Window | Value | Baseline | Verdict |",
        "|---|---|---|---|---|---|",
        *(
            f"| {r.item} | {r.criterion} | {r.window} | {r.value} | {r.baseline} | {verdict[r.inside]} |"
            for r in rows
        ),
    ]
    misses = [r for r in runs if r.cache == "miss"]
    hits = [r for r in runs if r.cache == "hit"]
    lines += [
        "",
        f"XC-082 cache: {len(hits)} hits, {len(misses)} misses among the runs whose desktop job ran.",
    ]
    return "\n".join(lines) + "\n"


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--since",
        default="2026-10-27T13:50:00Z",
        help="ISO time the window starts (default: the stack's merge)",
    )
    parser.add_argument("--max-runs", type=int, default=250)
    parser.add_argument("--json", type=Path, help="also write the per-run facts here")
    parser.add_argument(
        "--from-json", type=Path, help="read per-run facts from here instead of the API"
    )
    args = parser.parse_args(argv)
    if args.from_json:
        runs = [Run(**raw) for raw in json.loads(args.from_json.read_text())]
    else:
        runs = fetch_runs(args.since, args.max_runs)
    if args.json:
        args.json.write_text(json.dumps([asdict(r) for r in runs], indent=1))
    sys.stdout.write(report(runs, args.since))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
