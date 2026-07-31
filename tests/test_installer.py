"""install.sh is step zero: it is how the onboarding skill reaches the agent at all.

The installer runs before Lore exists, so nothing it does is covered by the CLI
tests, and its failure mode is silent — a skill that was never copied simply never
triggers, and the owner is told to say a phrase that nothing is listening for.

These tests run the real script with `uv` stubbed out, so no package is built and
no network is used. Every run is given an explicit environment with HOME inside a
temporary directory: the script does `rm -rf "$HOME/.claude/skills/lore-onboard"`,
which against a real HOME would delete the developer's installed skill.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKILL = ROOT / "skills/lore-onboard"
AGENT_HOMES = (".agents/skills/lore-onboard", ".claude/skills/lore-onboard")


class InstallerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name) / "home"
        self.home.mkdir()
        self.bin = Path(self.tmp.name) / "bin"
        self.bin.mkdir()

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _stub(self, name: str, body: str = "exit 0") -> None:
        path = self.bin / name
        path.write_text(f"#!/bin/sh\n{body}\n")
        path.chmod(0o755)

    def _install(self, *, path: str | None = None) -> subprocess.CompletedProcess[str]:
        # An explicit environment, never the inherited one: HOME has to land inside
        # the sandbox for the script's rm -rf to be harmless.
        environment = {
            "HOME": str(self.home),
            "PATH": path if path is not None else f"{self.bin}{os.pathsep}{os.environ['PATH']}",
            "LORE_SOURCE_DIR": str(ROOT),
            "LORE_SKIP_SETUP": "1",
        }
        self.assertTrue(environment["HOME"].startswith(self.tmp.name))
        return subprocess.run(
            ["/bin/sh", "install.sh"],
            cwd=ROOT,
            env=environment,
            text=True,
            capture_output=True,
        )

    def test_the_installer_delivers_the_skill_to_every_agent_home(self) -> None:
        self._stub("uv")
        result = self._install()

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Installed Lore at", result.stdout)
        for home in AGENT_HOMES:
            with self.subTest(home=home):
                installed = self.home / home
                self.assertEqual(
                    {path.name for path in installed.iterdir()},
                    {path.name for path in SKILL.iterdir()},
                )
                self.assertEqual(
                    (installed / "SKILL.md").read_text(encoding="utf-8"),
                    (SKILL / "SKILL.md").read_text(encoding="utf-8"),
                )

    def test_reinstalling_leaves_no_file_from_the_previous_skill(self) -> None:
        """A stale phase file would contradict the SKILL.md that replaced it."""
        self._stub("uv")
        for home in AGENT_HOMES:
            stale = self.home / home
            stale.mkdir(parents=True)
            (stale / "retired-phase.md").write_text("instructions that no longer apply")

        self.assertEqual(self._install().returncode, 0)

        for home in AGENT_HOMES:
            with self.subTest(home=home):
                self.assertFalse((self.home / home / "retired-phase.md").exists())
                self.assertTrue((self.home / home / "SKILL.md").is_file())

    def test_a_missing_prerequisite_stops_with_a_named_cause(self) -> None:
        """The skill tells the agent to report an install failure, not retry it."""
        for tool in ("python3", "git"):
            resolved = shutil.which(tool)
            self.assertIsNotNone(resolved, f"{tool} is required to run this test")
            (self.bin / tool).symlink_to(resolved)

        result = self._install(path=str(self.bin))

        self.assertEqual(result.returncode, 1)
        self.assertIn("uv", result.stderr)
        self.assertFalse((self.home / AGENT_HOMES[0]).exists())


if __name__ == "__main__":
    unittest.main()
