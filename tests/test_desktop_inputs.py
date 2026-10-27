"""XC-078: the filter that decides whether a pull request runs the desktop macOS job."""

from __future__ import annotations

import importlib.util
import io
import os
import tempfile
import unittest
from pathlib import Path
from types import ModuleType
from unittest import mock


def _load() -> ModuleType:
    path = (
        Path(__file__).resolve().parents[1]
        / ".github"
        / "scripts"
        / "desktop_inputs.py"
    )
    spec = importlib.util.spec_from_file_location("desktop_inputs", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


desktop_inputs = _load()


class DesktopInputRules(unittest.TestCase):
    def test_changes_the_job_cannot_see_skip_it(self) -> None:
        for paths in (
            ["docs/backlog/cross-cutting/XC-078-skip.md", "docs/backlog/INDEX.md"],
            ["site/src/worker.js", "site/test/marketplace.test.mjs"],
            [
                "lore/node/src/storefront.ts",
                "lore/node/test/x.test.ts",
                "lore/node/package.json",
            ],
            ["tests/test_cli.py", "tests/helpers.py"],
            ["bridge/src/index.ts", "feedback-relay/src/x.ts", "checkout/src/x.ts"],
            ["README.md", "LICENSE", "install.sh", "lore-test.sh"],
            [".github/workflows/pr-title.yml", ".github/scripts/check_pr_title.py"],
        ):
            with self.subTest(paths=paths):
                self.assertEqual(desktop_inputs.desktop_inputs(paths), [])

    def test_each_input_alone_runs_it(self) -> None:
        for path in (
            "app/desktop/src/renderer.js",
            "app/desktop/README.md",
            "lore/cli.py",
            "lore/sources.py",
            "lore/node/src/price.ts",
            "lore/node/wrangler.jsonc",
            "plugins/lore/skills/lore-capture/SKILL.md",
            "tests/fixtures/granola.py",
            "tests/fixtures/exports/chatgpt/conversations.json",
            "pyproject.toml",
            "uv.lock",
            ".github/workflows/tests.yml",
            ".github/scripts/desktop_inputs.py",
        ):
            with self.subTest(path=path):
                self.assertEqual(
                    desktop_inputs.desktop_inputs(["docs/x.md", path]), [path]
                )

    def test_a_root_file_that_merely_starts_with_lore_is_not_the_package(self) -> None:
        self.assertFalse(desktop_inputs.is_desktop_input("lore-test.sh"))
        self.assertFalse(desktop_inputs.is_desktop_input("lore_mcp.egg-info/PKG-INFO"))

    def test_blank_lines_are_dropped(self) -> None:
        self.assertEqual(
            desktop_inputs.desktop_inputs(["", "  ", "lore/cli.py\n"]), ["lore/cli.py"]
        )


class Main(unittest.TestCase):
    def run_main(self, text: str) -> tuple[str, str]:
        with tempfile.TemporaryDirectory() as folder:
            output = os.path.join(folder, "output")
            with (
                mock.patch.dict(os.environ, {"GITHUB_OUTPUT": output}),
                mock.patch("sys.stdout", new=io.StringIO()) as out,
            ):
                code = desktop_inputs.main([], io.StringIO(text))
            self.assertEqual(code, 0)
            return Path(output).read_text(), out.getvalue()

    def test_a_docs_only_change_writes_false(self) -> None:
        written, printed = self.run_main("docs/backlog/INDEX.md\nsite/src/worker.js\n")
        self.assertEqual(written, "desktop=false\n")
        self.assertIn("None of the 2 changed paths", printed)

    def test_one_input_among_many_writes_true_and_names_it(self) -> None:
        written, printed = self.run_main("docs/x.md\nuv.lock\nsite/a.js\n")
        self.assertEqual(written, "desktop=true\n")
        self.assertIn("1 of 3 changed paths", printed)
        self.assertIn("  uv.lock", printed)

    def test_no_paths_at_all_fails_open_with_a_warning(self) -> None:
        written, printed = self.run_main("\n")
        self.assertEqual(written, "desktop=true\n")
        self.assertIn("::warning", printed)


if __name__ == "__main__":
    unittest.main()
