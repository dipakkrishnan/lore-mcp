from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
from pathlib import Path

DEFAULT_MODEL = "gpt-5.6-sol"
# Judge defaults to a different lab than the candidate so verdicts aren't
# the candidate grading its own homework. Claude-family names route through
# `claude -p`; everything else through `codex exec`. Override with --judge-model.
DEFAULT_JUDGE_MODEL = "claude-opus-5"
CLAUDE_PREFIXES = ("claude", "opus", "sonnet", "haiku")
TASK_PATH = Path(__file__).with_name("task.json")
DELIVERABLE_SCHEMA = {
    "type": "object",
    "properties": {
        "memory": {"type": "string"},
        "answer": {"type": "string"},
    },
    "required": ["memory", "answer"],
    "additionalProperties": False,
}
VERDICT_SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["pass", "fail"]},
        "reasoning": {"type": "string"},
    },
    "required": ["verdict", "reasoning"],
    "additionalProperties": False,
}


def run_model(prompt: str, model: str, schema: dict[str, object]) -> dict[str, object]:
    if model.startswith(CLAUDE_PREFIXES):
        return _run_claude(prompt, model)
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        schema_path = root / "schema.json"
        output_path = root / "output.json"
        schema_path.write_text(json.dumps(schema), encoding="utf-8")
        result = subprocess.run(
            [
                "codex",
                "exec",
                "--ephemeral",
                "--ignore-user-config",
                "--skip-git-repo-check",
                "--sandbox",
                "read-only",
                "--model",
                model,
                "--cd",
                directory,
                "--output-schema",
                str(schema_path),
                "--output-last-message",
                str(output_path),
                "-",
            ],
            input=prompt,
            capture_output=True,
            text=True,
        )
        if result.returncode:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip())
        return json.loads(output_path.read_text(encoding="utf-8"))


def _run_claude(prompt: str, model: str) -> dict[str, object]:
    """Run a prompt through headless Claude Code; the prompt must demand JSON."""
    result = subprocess.run(
        ["claude", "-p", "--model", model, "--output-format", "json"],
        input=prompt,
        capture_output=True,
        text=True,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())
    text = json.loads(result.stdout)["result"].strip()
    if text.startswith("```"):
        text = text.strip("`").removeprefix("json").strip()
    return json.loads(text)


def candidate_prompt(task: dict[str, object], case: dict[str, object]) -> str:
    return f"""# Task
{task["instructions"]}

# Owner profile
{case["owner_profile"]}

# Source history
{json.dumps(case["source_history"], indent=2)}

# Buyer query
{case["buyer_query"]}

Return JSON with exactly two strings: `memory` and `answer`.
"""


def judge_prompt(task: dict[str, object], output: str, criterion: dict[str, str]) -> str:
    return f"""You are evaluating an AI agent's work against one quality criterion.

## Task
{task["title"]}

## Agent output
{output}

## Criterion
**{criterion["title"]}**

{criterion["match_criteria"]}

Match on substance, not exact wording. Every explicit condition in the PASS standard
must be satisfied; otherwise fail. Respond with JSON only, using verdict `pass` or
`fail` and a brief reasoning string.
"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--judge-model", default=DEFAULT_JUDGE_MODEL)
    parser.add_argument("--case")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    task = json.loads(TASK_PATH.read_text(encoding="utf-8"))
    cases = [case for case in task["cases"] if not args.case or case["id"] == args.case]
    if not cases:
        parser.error(f"unknown case: {args.case}")

    results = []
    for case in cases:
        print(f"Running {case['id']}...", flush=True)
        deliverables = run_model(
            candidate_prompt(task, case), args.model, DELIVERABLE_SCHEMA
        )
        criteria_results = []
        for criterion in case["criteria"]:
            verdict = run_model(
                judge_prompt(task, str(deliverables[criterion["deliverable"]]), criterion),
                args.judge_model,
                VERDICT_SCHEMA,
            )
            criteria_results.append({**criterion, **verdict})
            print(f"  {criterion['id']}: {str(verdict['verdict']).upper()}", flush=True)
        passed = sum(result["verdict"] == "pass" for result in criteria_results)
        results.append(
            {
                "id": case["id"],
                "all_pass": passed == len(criteria_results),
                "n_passed": passed,
                "n_criteria": len(criteria_results),
                "deliverables": deliverables,
                "criteria_results": criteria_results,
            }
        )

    report = {
        "model": args.model,
        "judge_model": args.judge_model,
        "all_pass": all(result["all_pass"] for result in results),
        "cases": results,
    }
    rendered = json.dumps(report, indent=2) + "\n"
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered)
    return 0 if report["all_pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
