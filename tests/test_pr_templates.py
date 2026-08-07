"""Tests for `docs/backlog/agents/render_pr_body.py` (XC-007).

The module lives outside the `lore` package (it is backlog tooling, not
product code), so it is loaded from its file path rather than imported
normally.
"""

from __future__ import annotations

import importlib.util
import types
import unittest
from pathlib import Path

MODULE_PATH = (
    Path(__file__).resolve().parents[1]
    / "docs"
    / "backlog"
    / "agents"
    / "render_pr_body.py"
)


def _load_render_pr_body() -> types.ModuleType:
    spec = importlib.util.spec_from_file_location("render_pr_body", MODULE_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


render_pr_body = _load_render_pr_body()


class RenderTest(unittest.TestCase):
    def test_fills_every_placeholder_in_the_completed_item_template(self) -> None:
        body = render_pr_body.render(
            "completed-item",
            {
                "problem": "PROBLEM_TEXT",
                "changes": "CHANGES_TEXT",
                "test_plan": "TEST_PLAN_TEXT",
            },
        )
        self.assertIn("PROBLEM_TEXT", body)
        self.assertIn("CHANGES_TEXT", body)
        self.assertIn("TEST_PLAN_TEXT", body)
        self.assertNotIn("{{", body)

    def test_missing_var_raises(self) -> None:
        with self.assertRaises(SystemExit):
            render_pr_body.render("completed-item", {"problem": "only one of three"})

    def test_unknown_template_raises(self) -> None:
        with self.assertRaises(SystemExit):
            render_pr_body.render("does-not-exist", {})

    def test_every_shipped_template_renders_cleanly_with_its_own_placeholders(
        self,
    ) -> None:
        for name in render_pr_body.available_templates():
            if name == "README":
                continue
            required, _ = render_pr_body.load_template(name)
            self.assertTrue(required, f"{name}.md declares no {{{{placeholder}}}}")
            values = {key: key.upper() for key in required}
            body = render_pr_body.render(name, values)
            self.assertNotIn("{{", body)


class ParseVarsTest(unittest.TestCase):
    def test_splits_on_the_first_equals_only(self) -> None:
        values = render_pr_body.parse_vars(["summary=fixed a=b bug"])
        self.assertEqual(values, {"summary": "fixed a=b bug"})

    def test_a_pair_without_equals_raises(self) -> None:
        with self.assertRaises(SystemExit):
            render_pr_body.parse_vars(["not-a-pair"])


class MainTest(unittest.TestCase):
    def test_renders_to_stdout_and_returns_zero(self) -> None:
        import contextlib
        import io

        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            exit_code = render_pr_body.main(
                [
                    "--template",
                    "index-regenerated",
                    "--var",
                    "findings=No issues found.",
                ]
            )
        self.assertEqual(exit_code, 0)
        self.assertIn("No issues found.", out.getvalue())


if __name__ == "__main__":
    unittest.main()
