"""Buyer-side answer-quality eval.

Where `integration.py` exercises the *owner's* half of the pipeline (source
history in, synthesized memory and a drafted publication out), this exercises
only the *buyer's* half: a fixed set of owner-approved publications seeded
directly into a throwaway store, a buying agent that sees nothing but the
free `discover` catalog and its own question, and a judge over what it
actually fetched through the real `lore.mcp.call_tool` path.

Deliberately does not call `automation.build_prompt` or shell out to `codex
exec` the way `integration.py`'s `synthesize()` does -- publications here are
authored directly as case fixtures, the same way `tests/test_mcp.py`'s
`_publish` helper seeds them for unit tests. That keeps this harness runnable
wherever a Claude-family executor is available, independent of whether codex
is installed (see EVAL-003 for that gap).

Per case:
  seed fixture publications -> discover (real MCP surface) -> a buying agent
  picks which ids look worth fetching from the teasers alone -> get each
  chosen id (real MCP surface) -> judge whether what came back actually
  answers the buyer's question.
"""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path

from run import DEFAULT_JUDGE_MODEL, VERDICT_SCHEMA, judge_prompt, run_model

TASK_PATH = Path(__file__).with_name("buyer_task.json")

# The buyer agent's own default. Kept Claude-family (see CLAUDE_PREFIXES in
# run.py) so this harness never needs `codex exec` -- unlike
# `integration.py`'s `synthesize()`, nothing here is allowed to depend on it.
DEFAULT_MODEL = "claude-sonnet-5"

SELECTION_SCHEMA = {
    "type": "object",
    "properties": {"ids": {"type": "array", "items": {"type": "string"}}},
    "required": ["ids"],
    "additionalProperties": False,
}


def seed(case: dict[str, object], lore_home: Path) -> None:
    """Write the case's owner_publications directly into a throwaway store.

    Bypasses synthesis entirely: each publication gets one backing memory
    (provenance requires at least one id) whose content mirrors the
    publication, then `add_publication` runs exactly the call the CLI makes
    after owner approval.
    """
    from lore.store import Store

    with Store() as store:
        for item in case["owner_publications"]:
            title = str(item["title"])
            store.put(
                source="eval",
                origin="native",
                source_path=f"{case['id']}:{title}",
                source_key=f"{case['id']}:{title}",
                fingerprint=str(item["content"]),
                title=title,
                content=str(item["content"]),
            )
            memory_id = store.search(title, limit=1)[0].id
            store.add_publication(
                title=title,
                content=str(item["content"]),
                topic=str(item["topic"]),
                teaser=str(item["teaser"]),
                provenance=[memory_id],
            )


def discover() -> dict[str, object]:
    """Call the real MCP `discover` tool and parse its payload."""
    from lore.mcp import call_tool

    return json.loads(call_tool("discover", {})["content"][0]["text"])


def buyer_select(
    case: dict[str, object], catalog: dict[str, object], model: str
) -> list[str]:
    """Ask a buying agent which catalog ids look worth paying to fetch.

    The agent sees only teasers grouped by topic and its own question --
    never the owner_publications fixtures, never the other cases' catalogs.
    An empty list is a legitimate answer when nothing looks relevant.
    """
    selection = run_model(
        f"""You are a buying agent with this question:

{case["buyer_query"]}

This Lore node's free catalog (teasers grouped by topic; each entry has an
id). Every fetch costs money, so only choose ids whose teaser plausibly
answers the question.

{json.dumps(catalog, indent=2)}

Return the ids of only the publications worth fetching -- an empty list if
none look relevant. Respond with JSON only, no other text, matching
{{"ids": ["..."]}}.""",
        model,
        SELECTION_SCHEMA,
    )
    advertised = {
        entry["id"] for entries in catalog["topics"].values() for entry in entries
    }
    # A hallucinated id must not crash the case -- same guard integration.py
    # uses in its own answer().
    return [public_id for public_id in selection["ids"] if public_id in advertised]


def fetch(ids: list[str]) -> str:
    """Fetch each chosen id through the real `get` tool; concatenate content."""
    from lore.mcp import call_tool

    if not ids:
        return "(nothing fetched)"
    publications = [
        json.loads(call_tool("get", {"id": public_id})["content"][0]["text"])[
            "publication"
        ]
        for public_id in ids
    ]
    return "\n\n".join(f"{p['title']}\n{p['content']}" for p in publications)


def run_case(
    case: dict[str, object], task: dict[str, object], args: argparse.Namespace
) -> dict[str, object]:
    with tempfile.TemporaryDirectory() as tmp:
        os.environ["LORE_HOME"] = str(Path(tmp) / "lore")

        seed(case, Path(tmp) / "lore")
        catalog = discover()
        selected = buyer_select(case, catalog, args.model)
        fetched_text = fetch(selected)

        deliverables = {"fetched": fetched_text}
        criteria_results = []
        for criterion in case["criteria"]:
            verdict = run_model(
                judge_prompt(task, deliverables[criterion["deliverable"]], criterion),
                args.judge_model,
                VERDICT_SCHEMA,
            )
            # Most criteria expect "pass" (the real behavior should be good);
            # `misleading-teaser`'s fixture expects "fail" on purpose -- that
            # is the harness catching EVAL-002's first failure mode, not a
            # regression. `as_expected` is what should gate CI/exit codes;
            # `verdict` on its own is not enough once a case can expect fail.
            expected = criterion.get("expected_verdict", "pass")
            criteria_results.append(
                {**criterion, **verdict, "as_expected": verdict["verdict"] == expected}
            )
            print(
                f"  {criterion['id']}: {str(verdict['verdict']).upper()}"
                f" (expected {expected})",
                flush=True,
            )
        matched = sum(result["as_expected"] for result in criteria_results)
        return {
            "id": case["id"],
            "catalog_publication_count": catalog["publication_count"],
            "selected_ids": selected,
            "all_as_expected": matched == len(criteria_results),
            "n_as_expected": matched,
            "n_criteria": len(criteria_results),
            "deliverables": deliverables,
            "criteria_results": criteria_results,
        }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
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
        print(f"Running {case['id']} (buyer-side)...", flush=True)
        results.append(run_case(case, task, args))

    report = {
        "harness": "buyer",
        "model": args.model,
        "judge_model": args.judge_model,
        # Gated on `as_expected`, not "did every criterion verdict pass":
        # `misleading-teaser` fixtures a teaser that oversells its content on
        # purpose and its criterion has `expected_verdict: fail` in
        # buyer_task.json -- a verdict of fail there is the harness catching
        # EVAL-002's first failure mode working correctly, not a regression.
        "all_pass": all(result["all_as_expected"] for result in results),
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
