"""Tests for `support/manual_test_report.py`.

The module lives outside the `lore` package (it is maintainer tooling, not
product code), so it is loaded from its file path rather than imported
normally — the same way `test_pr_templates.py` loads its subject.

`docs/manual-test-walkthrough.md` is the canonical list of testable items, so
the last two test classes here parse the real document and every committed
run. That is what stops the parser and the walkthrough from drifting apart.
"""

from __future__ import annotations

import importlib.util
import io
import json
import sys
import tempfile
import types
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "support" / "manual_test_report.py"
WALKTHROUGH = ROOT / "docs" / "manual-test-walkthrough.md"
RUNS = ROOT / "docs" / "manual-test-runs"


def _load_manual_test_report() -> types.ModuleType:
    spec = importlib.util.spec_from_file_location("manual_test_report", MODULE_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    # `@dataclass` resolves annotations through `sys.modules[cls.__module__]`,
    # so a path-loaded module has to be registered before it is executed.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


mtr = _load_manual_test_report()

SESSION_DEFAULTS = {
    "Tester": "arden",
    "Date": "2026-09-07",
    "App version": "0.1.0",
    "Git commit": "7a269ba",
    "Platform": "macOS 26.2 (arm64)",
    "Scenarios run": "S1",
    "S4 tier": "none",
}

S1_ROWS = [
    ("S1-01", "Sign in", "Pass", "", ""),
    ("S1-02", "Setup rails", "Pass", "", ""),
    ("S1", "Scenario 1 as a whole", "Pass", "", ""),
]


def session(**overrides: str) -> str:
    """Render a session table, overriding or dropping fields by label."""
    fields = dict(SESSION_DEFAULTS)
    fields.update(overrides)
    rows = "\n".join(
        f"| {key} | {value} |" for key, value in fields.items() if value is not None
    )
    return (
        "<!-- rubric:session -->\n\n| Field | Value |\n|---|---|\n"
        + rows
        + ("\n\n<!-- /rubric -->\n")
    )


def rubric(block: str, rows: list[tuple[str, ...]], **attrs: str) -> str:
    """Render one rubric table block."""
    opener = f"<!-- rubric:{block}"
    for key, value in attrs.items():
        opener += f' {key}="{value}"'
    opener += " -->"
    header = (
        "| TI ID | TI Name | Result | Notes | Reference URLs |\n|---|---|---|---|---|"
    )
    body = "\n".join("| " + " | ".join(row) + " |" for row in rows)
    return f"{opener}\n\n{header}\n{body}\n\n<!-- /rubric -->\n"


def doc(*parts: str, **overrides: str) -> str:
    """A minimal valid document: a session table plus one S1 rubric."""
    if parts:
        return "# Run\n\n" + "\n".join(parts)
    return "# Run\n\n" + session(**overrides) + "\n" + rubric("S1", S1_ROWS)


def convert(text: str) -> tuple[dict | None, list[str], list[str]]:
    return mtr.convert(text, source="run.md", generated_at="2026-09-07T00:00:00Z")


class BlockScanTest(unittest.TestCase):
    def test_finds_blocks_with_their_opening_line(self) -> None:
        found, errors = mtr.blocks(doc())
        self.assertEqual([], errors)
        self.assertEqual(["session", "S1"], [block.name for block in found])
        self.assertEqual(3, found[0].line)

    def test_ignores_a_rubric_inside_a_backtick_fence(self) -> None:
        text = doc() + "\n```markdown\n" + rubric("S2", S1_ROWS) + "```\n"
        found, errors = mtr.blocks(text)
        self.assertEqual([], errors)
        self.assertEqual(["session", "S1"], [block.name for block in found])

    def test_ignores_a_rubric_inside_a_tilde_fence(self) -> None:
        text = doc() + "\n~~~\n" + rubric("S2", S1_ROWS) + "~~~\n"
        found, _ = mtr.blocks(text)
        self.assertEqual(["session", "S1"], [block.name for block in found])

    def test_an_unclosed_block_is_an_error(self) -> None:
        _, errors = mtr.blocks("<!-- rubric:S1 -->\n| a |\n")
        self.assertIn("never closed", errors[0])

    def test_a_nested_open_is_an_error(self) -> None:
        text = "<!-- rubric:S1 -->\n<!-- rubric:S2 -->\n<!-- /rubric -->\n"
        _, errors = mtr.blocks(text)
        self.assertIn("nesting is not allowed", errors[0])

    def test_a_stray_close_is_an_error(self) -> None:
        _, errors = mtr.blocks("text\n<!-- /rubric -->\n")
        self.assertIn("no open block", errors[0])

    def test_attributes_parse_including_quoted_values(self) -> None:
        found, _ = mtr.blocks(rubric("S4", S1_ROWS, name="Real money", tier="switch"))
        self.assertEqual({"name": "Real money", "tier": "switch"}, found[0].attrs)

    def test_a_table_outside_any_sentinel_is_ignored(self) -> None:
        text = doc() + "\n| TI ID | TI Name | Result | Notes | Reference URLs |\n"
        found, _ = mtr.blocks(text)
        self.assertEqual(2, len(found))


class RowParsingTest(unittest.TestCase):
    def test_splits_and_strips_regardless_of_padding(self) -> None:
        self.assertEqual(
            ["S1-01", "Sign in", "Pass", "", ""],
            mtr.split_row("|  S1-01 |  Sign in   | Pass |  |  |"),
        )

    def test_an_escaped_pipe_stays_in_the_cell(self) -> None:
        cells = mtr.split_row(r"| S1-01 | Sign in | Pass | a \| b |  |")
        self.assertEqual("a | b", cells[3])

    def test_a_row_with_too_few_cells_errors(self) -> None:
        _, errors, _ = convert(doc(session(), rubric("S1", [("S1-01", "a", "Pass")])))
        self.assertIn("expected 5 cells, found 3", errors[0])

    def test_a_row_with_an_unescaped_pipe_errors(self) -> None:
        rows = [("S1-01", "a", "Pass", "one | two", "")]
        _, errors, _ = convert(doc(session(), rubric("S1", rows)))
        self.assertIn("write a literal pipe as \\|", errors[0])

    def test_a_renamed_column_errors(self) -> None:
        text = (
            session()
            + "\n<!-- rubric:S1 -->\n\n"
            + "| TI ID | Name | Result | Notes | Reference URLs |\n"
            + "|---|---|---|---|---|\n| S1 | x | Pass |  |  |\n\n<!-- /rubric -->\n"
        )
        _, errors, _ = convert(doc(text))
        self.assertIn("expected the header row", errors[0])

    def test_a_missing_separator_row_errors(self) -> None:
        text = (
            session()
            + "\n<!-- rubric:S1 -->\n\n"
            + "| TI ID | TI Name | Result | Notes | Reference URLs |\n"
            + "| S1 | x | Pass |  |  |\n\n<!-- /rubric -->\n"
        )
        _, errors, _ = convert(doc(text))
        self.assertIn("separator row", errors[0])


class ValueTest(unittest.TestCase):
    def test_every_blank_form_means_not_run(self) -> None:
        for blank in ("", "-", "—", "TBD"):
            errors: list[str] = []
            self.assertIsNone(mtr.parse_result(blank, 1, errors))
            self.assertEqual([], errors)

    def test_results_are_case_insensitive(self) -> None:
        errors: list[str] = []
        self.assertEqual("Pass", mtr.parse_result("pass", 1, errors))
        self.assertEqual("Skipped", mtr.parse_result("SKIPPED", 1, errors))
        self.assertEqual([], errors)

    def test_an_unknown_result_lists_the_valid_ones(self) -> None:
        errors: list[str] = []
        mtr.parse_result("Maybe", 9, errors)
        self.assertIn("Pass | Partial | Fail | Skipped | Other", errors[0])

    def test_references_split_and_unwrap(self) -> None:
        warnings: list[str] = []
        refs = mtr.parse_references(
            "https://a.example/1, [issue](https://b.example/2)", 1, warnings
        )
        self.assertEqual(["https://a.example/1", "https://b.example/2"], refs)
        self.assertEqual([], warnings)

    def test_an_empty_reference_cell_is_an_empty_list(self) -> None:
        self.assertEqual([], mtr.parse_references("   ", 1, []))

    def test_a_non_url_reference_warns_but_does_not_error(self) -> None:
        warnings: list[str] = []
        self.assertEqual(["slack"], mtr.parse_references("slack", 4, warnings))
        self.assertIn("does not look like a URL", warnings[0])


class ItemIdTest(unittest.TestCase):
    def test_a_bare_scenario_id_is_the_catchall(self) -> None:
        document, errors, _ = convert(doc())
        self.assertEqual([], errors)
        assert document is not None
        scenario = document["scenarios"][0]
        self.assertEqual("S1", scenario["catchall"]["ti_id"])
        self.assertEqual(["S1-01", "S1-02"], [i["ti_id"] for i in scenario["items"]])

    def test_an_id_from_another_scenario_errors(self) -> None:
        rows = [("S2-03", "wrong block", "Pass", "", ""), *S1_ROWS]
        _, errors, _ = convert(doc(session(), rubric("S1", rows)))
        self.assertIn("appears in the rubric:S1 block", errors[0])

    def test_a_duplicate_id_names_both_lines(self) -> None:
        rows = [*S1_ROWS, ("S1-01", "again", "Pass", "", "")]
        _, errors, _ = convert(doc(session(), rubric("S1", rows)))
        self.assertIn("is already recorded at line", errors[0])

    def test_a_scenario_without_a_catchall_errors(self) -> None:
        rows = [("S1-01", "a", "Pass", "", "")]
        _, errors, _ = convert(doc(session(), rubric("S1", rows)))
        self.assertIn("has no catchall row", errors[0])

    def test_malformed_ids_error(self) -> None:
        for bad in ("S1-1", "S5-01", "X1-01"):
            rows = [(bad, "a", "Pass", "", ""), *S1_ROWS]
            _, errors, _ = convert(doc(session(), rubric("S1", rows)))
            self.assertTrue(errors, f"{bad} should not parse")


class SessionTest(unittest.TestCase):
    def test_fields_parse(self) -> None:
        document, errors, _ = convert(doc(scenarios_run="S1, S2"))
        self.assertEqual([], errors)
        assert document is not None
        self.assertEqual("arden", document["session"]["tester"])
        self.assertEqual(["S1", "S2"], document["session"]["scenarios_run"])

    def test_a_missing_tester_errors_once_something_is_recorded(self) -> None:
        _, errors, _ = convert(doc(**{"Tester": ""}))
        self.assertIn("needs a tester", errors[0])

    def test_a_non_iso_date_errors(self) -> None:
        _, errors, _ = convert(doc(**{"Date": "Sept 7"}))
        self.assertIn("is not an ISO date", errors[0])

    def test_an_unknown_field_warns_and_is_preserved(self) -> None:
        text = session().replace(
            "| S4 tier | none |", "| S4 tier | none |\n| Weather | rain |"
        )
        document, errors, warnings = convert(doc(text, rubric("S1", S1_ROWS)))
        self.assertEqual([], errors)
        assert document is not None
        self.assertEqual({"weather": "rain"}, document["session"]["extra"])
        self.assertTrue(any("unknown session field" in w for w in warnings))

    def test_an_unknown_scenario_errors(self) -> None:
        _, errors, _ = convert(doc(**{"Scenarios run": "S1, S9"}))
        self.assertIn("is not a scenario id", errors[0])

    def test_an_unknown_tier_errors(self) -> None:
        _, errors, _ = convert(doc(**{"S4 tier": "deep"}))
        self.assertIn("is not one of", errors[0])

    def test_a_missing_session_table_errors(self) -> None:
        _, errors, _ = convert(doc(rubric("S1", S1_ROWS)))
        self.assertIn("no <!-- rubric:session --> table", errors[0])


class ObservationsTest(unittest.TestCase):
    def test_prose_is_captured_verbatim(self) -> None:
        block = (
            "<!-- rubric:observations -->\n\nOne.\n\nTwo *lines*.\n\n<!-- /rubric -->\n"
        )
        document, errors, _ = convert(doc(session(), block, rubric("S1", S1_ROWS)))
        self.assertEqual([], errors)
        assert document is not None
        self.assertEqual("One.\n\nTwo *lines*.", document["session"]["observations"])

    def test_a_missing_block_is_an_empty_string(self) -> None:
        document, _, _ = convert(doc())
        assert document is not None
        self.assertEqual("", document["session"]["observations"])

    def test_a_per_scenario_block_lands_on_that_scenario(self) -> None:
        block = "<!-- rubric:observations:S1 -->\n\nRough.\n\n<!-- /rubric -->\n"
        document, errors, _ = convert(doc(session(), rubric("S1", S1_ROWS), block))
        self.assertEqual([], errors)
        assert document is not None
        self.assertEqual("Rough.", document["scenarios"][0]["observations"])


class TierTest(unittest.TestCase):
    def s4(self, tier: str, result: str, declared: str) -> tuple:
        rows = [("S4-11", "deploy", result, "note", "")]
        text = doc(
            session(**{"Scenarios run": "S4", "S4 tier": declared}),
            rubric("S4", rows, tier=tier),
            rubric("S4", [("S4", "whole", "Pass", "", "")]),
        )
        return convert(text)

    def test_scoring_above_the_declared_tier_errors(self) -> None:
        _, errors, _ = self.s4("switch", "Pass", "walkthrough")
        self.assertIn("above the declared tier", errors[0])
        self.assertIn("raise S4 tier, or mark this row Skipped", errors[0])

    def test_skipping_above_the_declared_tier_is_clean(self) -> None:
        document, errors, _ = self.s4("switch", "Skipped", "walkthrough")
        self.assertEqual([], errors)
        self.assertIsNotNone(document)

    def test_a_blank_above_tier_row_warns_when_the_scenario_was_run(self) -> None:
        _, errors, warnings = self.s4("switch", "", "walkthrough")
        self.assertEqual([], errors)
        self.assertTrue(any("mark it Skipped" in w for w in warnings))

    def test_a_within_tier_skip_without_a_reason_warns(self) -> None:
        rows = [("S4-11", "deploy", "Skipped", "", "")]
        text = doc(
            session(**{"Scenarios run": "S4", "S4 tier": "switch"}),
            rubric("S4", rows, tier="switch"),
            rubric("S4", [("S4", "whole", "Pass", "", "")]),
        )
        _, errors, warnings = convert(text)
        self.assertEqual([], errors)
        self.assertTrue(any("Skipped with no reason" in w for w in warnings))

    def test_an_untiered_row_is_always_in_scope(self) -> None:
        rows = [("S4-00", "preflight", "Pass", "", ""), ("S4", "whole", "Pass", "", "")]
        text = doc(
            session(**{"Scenarios run": "S4", "S4 tier": "none"}),
            rubric("S4", rows),
        )
        _, errors, _ = convert(text)
        self.assertEqual([], errors)


class ShapeTest(unittest.TestCase):
    def test_counts_carry_every_key_and_exclude_the_catchall(self) -> None:
        rows = [
            ("S1-01", "a", "Pass", "", ""),
            ("S1-02", "b", "Fail", "broke", ""),
            ("S1-03", "c", "", "", ""),
            ("S1", "whole", "Fail", "bad run", ""),
        ]
        document, errors, _ = convert(doc(session(), rubric("S1", rows)))
        self.assertEqual([], errors)
        assert document is not None
        self.assertEqual(
            {
                "Pass": 1,
                "Partial": 0,
                "Fail": 1,
                "Skipped": 0,
                "Other": 0,
                "NotRun": 1,
                "total": 3,
            },
            document["scenarios"][0]["counts"],
        )

    def test_totals_sum_the_scenarios(self) -> None:
        text = doc(
            session(**{"Scenarios run": "S1, S2"}),
            rubric("S1", S1_ROWS),
            rubric("S2", [("S2-01", "a", "Pass", "", ""), ("S2", "w", "Pass", "", "")]),
        )
        document, errors, _ = convert(text)
        self.assertEqual([], errors)
        assert document is not None
        self.assertEqual(3, document["totals"]["total"])
        self.assertEqual(3, document["totals"]["Pass"])

    def test_a_blank_result_serializes_as_null(self) -> None:
        rows = [("S1-01", "a", "", "", ""), ("S1", "w", "Pass", "", "")]
        document, _, _ = convert(doc(session(), rubric("S1", rows)))
        assert document is not None
        payload = json.dumps(document, allow_nan=False)
        self.assertIn('"result": null', json.dumps(document, indent=2))
        self.assertEqual(document, json.loads(payload))

    def test_generated_at_is_injectable(self) -> None:
        document, _, _ = convert(doc())
        assert document is not None
        self.assertEqual("2026-09-07T00:00:00Z", document["generated_at"])
        self.assertEqual(mtr.SCHEMA_VERSION, document["schema_version"])
        self.assertEqual("run.md", document["source"])

    def test_every_record_carries_its_source_line(self) -> None:
        document, _, _ = convert(doc())
        assert document is not None
        for item in document["scenarios"][0]["items"]:
            self.assertGreater(item["line"], 0)

    def test_a_partial_without_notes_warns(self) -> None:
        rows = [("S1-01", "a", "Partial", "", ""), ("S1", "w", "Pass", "", "")]
        _, errors, warnings = convert(doc(session(), rubric("S1", rows)))
        self.assertEqual([], errors)
        self.assertTrue(any("Partial with empty Notes" in w for w in warnings))

    def test_results_recorded_for_an_undeclared_scenario_warn(self) -> None:
        text = doc(
            session(**{"Scenarios run": "S2"}),
            rubric("S1", S1_ROWS),
            rubric("S2", [("S2-01", "a", "Pass", "", ""), ("S2", "w", "Pass", "", "")]),
        )
        _, errors, warnings = convert(text)
        self.assertEqual([], errors)
        self.assertTrue(any("not in Scenarios run" in w for w in warnings))


class TemplateDiffTest(unittest.TestCase):
    def test_an_extra_item_errors(self) -> None:
        document, errors, _ = mtr.convert(
            doc(),
            source="run.md",
            generated_at="2026-09-07T00:00:00Z",
            canonical={"S1-01", "S1-02", "S1"},
        )
        self.assertEqual([], errors)
        self.assertIsNotNone(document)

        _, errors, _ = mtr.convert(doc(), source="run.md", canonical={"S1-01", "S1"})
        self.assertIn("S1-02 is not in the walkthrough document", errors[0])

    def test_a_missing_item_errors(self) -> None:
        _, errors, _ = mtr.convert(
            doc(), source="run.md", canonical={"S1-01", "S1-02", "S1", "S1-03"}
        )
        self.assertIn("S1-03 is in the walkthrough document but not", errors[0])


class RealDocumentTest(unittest.TestCase):
    """Pins that keep the shipped walkthrough and this parser in step."""

    def setUp(self) -> None:
        self.text = WALKTHROUGH.read_text(encoding="utf-8")
        self.document, self.errors, _ = mtr.convert(
            self.text, source=str(WALKTHROUGH), generated_at="2026-09-07T00:00:00Z"
        )

    def test_the_walkthrough_parses(self) -> None:
        self.assertEqual([], self.errors)
        self.assertIsNotNone(self.document)

    def test_it_covers_all_four_scenarios_each_with_a_catchall(self) -> None:
        assert self.document is not None
        ids = [scenario["id"] for scenario in self.document["scenarios"]]
        self.assertEqual(list(mtr.SCENARIOS), ids)
        for scenario in self.document["scenarios"]:
            self.assertIsNotNone(scenario["catchall"], scenario["id"])
            self.assertTrue(scenario["name"], f"{scenario['id']} has no name")

    def test_item_ids_are_unique_and_ascending_within_each_scenario(self) -> None:
        assert self.document is not None
        for scenario in self.document["scenarios"]:
            ids = [item["ti_id"] for item in scenario["items"]]
            self.assertEqual(sorted(ids), ids, scenario["id"])
            self.assertEqual(len(set(ids)), len(ids), scenario["id"])

    def test_scenario_four_covers_every_tier(self) -> None:
        assert self.document is not None
        s4 = next(s for s in self.document["scenarios"] if s["id"] == "S4")
        tiers = {item["tier"] for item in s4["items"]}
        self.assertEqual({"walkthrough", "switch", "purchase"}, tiers)
        self.assertIsNone(s4["catchall"]["tier"])

    def test_the_shipped_document_is_the_blank_degenerate_case(self) -> None:
        assert self.document is not None
        totals = self.document["totals"]
        self.assertEqual(totals["total"], totals["NotRun"])
        for scenario in self.document["scenarios"]:
            for item in scenario["items"]:
                self.assertIsNone(item["result"], item["ti_id"])

    def test_every_committed_run_matches_the_canonical_item_set(self) -> None:
        canonical, failures = mtr.template_ids(WALKTHROUGH)
        self.assertEqual([], failures)
        self.assertTrue(canonical)
        runs = sorted(RUNS.glob("*.md")) if RUNS.is_dir() else []
        for path in runs:
            if path.name == "README.md":
                continue
            with self.subTest(run=path.name):
                _, errors, _ = mtr.convert(
                    path.read_text(encoding="utf-8"),
                    source=str(path),
                    canonical=canonical,
                )
                self.assertEqual([], errors)


class MainTest(unittest.TestCase):
    def run_main(self, *argv: str) -> tuple[int, str, str]:
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = mtr.main(list(argv))
        return code, out.getvalue(), err.getvalue()

    def write(self, directory: str, text: str) -> str:
        path = Path(directory) / "run.md"
        path.write_text(text, encoding="utf-8")
        return str(path)

    def test_prints_json_and_returns_zero(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = self.write(tmp, doc())
            code, out, _ = self.run_main(path, "--no-template-check")
            self.assertEqual(0, code)
            self.assertEqual(mtr.SCHEMA_VERSION, json.loads(out)["schema_version"])

    def test_check_writes_nothing_to_stdout(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = self.write(tmp, doc())
            code, out, err = self.run_main(path, "--no-template-check", "--check")
            self.assertEqual(0, code)
            self.assertEqual("", out)
            self.assertIn("items", err)

    def test_errors_go_to_stderr_and_return_one(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = self.write(tmp, doc(**{"Date": "yesterday"}))
            code, out, err = self.run_main(path, "--no-template-check")
            self.assertEqual(1, code)
            self.assertEqual("", out)
            self.assertIn("is not an ISO date", err)

    def test_output_writes_a_file_and_leaves_stdout_clean(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = self.write(tmp, doc())
            target = str(Path(tmp) / "run.json")
            code, out, _ = self.run_main(
                path, "--no-template-check", "--output", target
            )
            self.assertEqual(0, code)
            self.assertEqual("", out)
            self.assertEqual(
                mtr.SCHEMA_VERSION,
                json.loads(Path(target).read_text(encoding="utf-8"))["schema_version"],
            )

    def test_warnings_as_errors_fails_on_a_warning(self) -> None:
        rows = [("S1-01", "a", "Partial", "", ""), ("S1", "w", "Pass", "", "")]
        with tempfile.TemporaryDirectory() as tmp:
            path = self.write(tmp, doc(session(), rubric("S1", rows)))
            code, _, err = self.run_main(
                path, "--no-template-check", "--warnings-as-errors"
            )
            self.assertEqual(1, code)
            self.assertIn("empty Notes", err)

    def test_a_missing_file_exits_two(self) -> None:
        code, _, err = self.run_main("nope.md", "--no-template-check")
        self.assertEqual(2, code)
        self.assertIn("cannot read", err)

    def test_the_shipped_walkthrough_converts_as_its_own_input(self) -> None:
        code, out, _ = self.run_main(str(WALKTHROUGH), "--no-template-check")
        self.assertEqual(0, code)
        self.assertGreater(json.loads(out)["totals"]["total"], 0)


if __name__ == "__main__":
    unittest.main()
