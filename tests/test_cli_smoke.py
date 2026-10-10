"""The owner's first session, run as real `lore` processes (CLI-002).

`tests/test_cli.py` calls each handler in-process with its surroundings patched,
so it proves every command is right on its own. What it cannot prove is the
sequence: `setup` writes what `sync` reads, `price` writes what `push` ships.
Here each command is a separate process sharing nothing but the files under a
throwaway home, so a command that can no longer read what the one before it
wrote fails the run.

Nothing here imports `lore`; the only way in is the entry point.
"""

from __future__ import annotations

import json
import os
import select
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

try:
    import pty
except ImportError:  # Windows has no pseudo-terminals
    pty = None  # type: ignore[assignment]

ROOT = Path(__file__).resolve().parent.parent
# Per command. Each one is a cold interpreter importing all of `lore`, which
# takes seconds on a busy machine.
TIMEOUT_S = 120
LAUNCH_KEY = "smoke-launch-key"

# `lore push --local` hands its SQL to `npx wrangler d1 execute`. This job has
# no Node toolchain and must not download one, so `npx` is this stand-in: it
# refuses anything but that exact call, and keeps the script so the test can
# load it. The real wrangler half is the `worker-smoke` CI job's (XC-016).
NPX = """#!/bin/sh
if [ "$#" -ne 8 ] ||
    [ "$1 $2 $3 $4 $5 $6" != "wrangler d1 execute lore-publications --local --file" ] ||
    [ ! -f "$7" ] || [ "$8" != "-y" ]; then
    echo "unexpected npx call: $*" >&2
    exit 64
fi
pwd -P > "$LORE_SMOKE_PUSHED/cwd"
cp "$7" "$LORE_SMOKE_PUSHED/push.sql"
"""


@unittest.skipIf(pty is None, "publication review needs a pseudo-terminal")
class OwnerLifecycleTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        # Resolved, because `lore status` prints the database's real path.
        root = Path(self.tmp.name).resolve()
        self.home = root / "home"
        self.lore_home = root / "lore"
        self.claude_home = root / "claude"
        self.codex_home = root / "codex"
        self.scratch = root / "scratch"
        self.pushed = root / "pushed"
        self.worker = root / "worker"
        self.files = root / "files"
        tools = root / "tools"
        for directory in (
            self.home,
            self.scratch,
            self.pushed,
            self.worker,
            self.files,
            tools,
        ):
            directory.mkdir()
        (tools / "npx").write_text(NPX, encoding="utf-8")
        (tools / "npx").chmod(0o755)
        (self.worker / "wrangler.jsonc").write_text("{}\n", encoding="utf-8")
        # HOME moves too: the desktop launch key lives under it, and nothing
        # here may read or write the developer's real one.
        self.env = os.environ | {
            "HOME": str(self.home),
            "LORE_HOME": str(self.lore_home),
            "CLAUDE_HOME": str(self.claude_home),
            "CODEX_HOME": str(self.codex_home),
            "OBSIDIAN_HOME": str(root / "obsidian"),
            "TMPDIR": str(self.scratch),
            "PATH": f"{tools}{os.pathsep}{os.environ.get('PATH', os.defpath)}",
            "LORE_SMOKE_PUSHED": str(self.pushed),
            "NO_COLOR": "1",
        }
        self.env.pop("LORE_ATTENDED_KEY", None)

    def write(self, name: str, payload: object) -> str:
        path = self.files / name
        path.write_text(json.dumps(payload), encoding="utf-8")
        return str(path)

    def lore(self, *args: str, stdin: str = "", attended: bool = False) -> str:
        """Run one command on pipes and return its stdout; it must exit 0."""
        env = self.env | ({"LORE_ATTENDED_KEY": LAUNCH_KEY} if attended else {})
        result = subprocess.run(
            [sys.executable, "-m", "lore", *args],
            cwd=ROOT,
            env=env,
            input=stdin,
            capture_output=True,
            text=True,
            timeout=TIMEOUT_S,
        )
        self.assertEqual(
            result.returncode, 0, f"lore {' '.join(args)}\n{result.stderr}"
        )
        return result.stdout

    def lore_in_a_terminal(self, *args: str, keys: str) -> str:
        """Run one command on a pseudo-terminal, typing `keys`; it must exit 0."""
        master, slave = pty.openpty()
        output: list[bytes] = []

        def drain(wait: float) -> None:
            while select.select([master], [], [], wait)[0]:
                try:
                    data = os.read(master, 4096)
                except OSError:  # Linux reports a closed terminal as an error
                    return
                if not data:
                    return
                output.append(data)

        try:
            process = subprocess.Popen(
                [sys.executable, "-m", "lore", *args],
                cwd=ROOT,
                env=self.env,
                stdin=slave,
                stdout=slave,
                stderr=slave,
            )
            os.write(master, keys.encode())
            deadline = time.monotonic() + TIMEOUT_S
            # Read as it runs, so the command never blocks on a full terminal.
            while process.poll() is None:
                if time.monotonic() > deadline:
                    process.kill()
                    process.wait()
                    self.fail(f"lore {' '.join(args)} did not finish")
                drain(0.05)
            # This end of the terminal is still open, so nothing written
            # before the exit has been dropped.
            drain(0)
        finally:
            os.close(slave)
            os.close(master)
        text = b"".join(output).decode().replace("\r\n", "\n")
        self.assertEqual(process.returncode, 0, f"lore {' '.join(args)}\n{text}")
        return text

    def test_a_first_session_carries_its_state_from_each_command_to_the_next(
        self,
    ) -> None:
        (self.codex_home / "memories").mkdir(parents=True)
        (self.codex_home / "memories/MEMORY.md").write_text(
            "# Release cadence\n\nShip on Tuesdays so a bad release has weekdays.",
            encoding="utf-8",
        )
        claude = self.claude_home / "projects/demo/memory"
        claude.mkdir(parents=True)
        (claude / "rollback.md").write_text(
            "# Rollback drill\n\nRehearse the rollback before launch, not during it.",
            encoding="utf-8",
        )

        self.assertIn("Imported 2 candidate memories", self.lore("setup", "--yes"))

        # `sync` is told nothing: it reads the sources `setup` enabled.
        (claude / "changelog.md").write_text(
            "# Old changelog\n\nAn obsolete note nobody needs any more.",
            encoding="utf-8",
        )
        synced = [line.split(maxsplit=1) for line in self.lore("sync").splitlines()]
        self.assertIn(["claude", "1 added, 0 updated, 1 unchanged"], synced)
        self.assertIn(["codex", "0 added, 0 updated, 1 unchanged"], synced)

        reviewed = self.lore("review", "obsolete", stdin="d\n")
        self.assertIn("Old changelog", reviewed)
        self.assertIn("Memory 1 of 1", reviewed)
        self.assertIn("Review complete", reviewed)
        memories = {
            memory["title"]: memory
            for memory in json.loads(self.lore("search", "--json", "--limit", "0"))
        }
        self.assertEqual(
            {title: memory["status"] for title, memory in memories.items()},
            {
                "Release cadence": "private",
                "Rollback drill": "private",
                "Old changelog": "discarded",
            },
        )

        captured = json.loads(
            self.lore(
                "capture",
                "apply",
                self.write(
                    "capture.json",
                    [
                        {
                            "title": "Schema freeze",
                            "content": "Freeze the schema two days before a launch.",
                            "project": "launch",
                        }
                    ],
                ),
            )
        )
        self.assertEqual(
            [(entry["title"], entry["status"]) for entry in captured],
            [("Schema freeze", "added")],
        )

        self.assertIn("Publication price set to $0.25", self.lore("price", "0.25"))

        # The piece draws on one imported memory and the captured one, by the
        # ids the commands above printed; approval refuses ids it cannot find.
        approved = self.lore_in_a_terminal(
            "publication",
            "review",
            self.write(
                "candidates.json",
                [
                    {
                        "title": "Launching without drama",
                        "content": "Freeze the schema two days out; rehearse rollback.",
                        "topic": "launching",
                        "teaser": "What do we lock down before a launch?",
                        "provenance": [
                            captured[0]["id"],
                            memories["Rollback drill"]["id"],
                        ],
                    }
                ],
            ),
            keys="a\n",
        )
        self.assertIn("Candidate 1 of 1", approved)
        self.assertIn("Approved 1 publication", approved)

        listed = self.lore("publication", "list")
        self.assertIn("Launching without drama", listed)
        self.assertIn("active · claim · 2 source memories · topic: launching", listed)
        self.assertIn("  id 1", listed)

        (self.home / "Library/Application Support/Lore").mkdir(parents=True)
        (self.home / "Library/Application Support/Lore/attended").write_text(
            LAUNCH_KEY, encoding="utf-8"
        )
        pushed = self.lore(
            "push", "--local", "--worker-dir", str(self.worker), attended=True
        )
        self.assertIn("Pushed 1 active publication to the local dev database", pushed)
        self.assertEqual(
            (self.pushed / "cwd").read_text(encoding="utf-8").strip(),
            str(self.worker),
        )
        # The edge database is SQLite, so the script has to load as one, and
        # hold the piece approved above at the price set before it.
        edge = sqlite3.connect(":memory:")
        self.addCleanup(edge.close)
        edge.executescript((self.pushed / "push.sql").read_text(encoding="utf-8"))
        self.assertEqual(
            edge.execute(
                "SELECT title, content, topic, teaser FROM publications"
            ).fetchall(),
            [
                (
                    "Launching without drama",
                    "Freeze the schema two days out; rehearse rollback.",
                    "launching",
                    "What do we lock down before a launch?",
                )
            ],
        )
        self.assertEqual(
            edge.execute(
                "SELECT value FROM node_settings WHERE key='price_usd'"
            ).fetchall(),
            [("0.250000",)],
        )

        blueprint = self.write(
            "blueprint.json",
            {
                "version": 1,
                "name": "Ada",
                "persona": "professor",
                "topic_outline": ["distributed systems", "consensus"],
                "focus_topics": ["consensus tradeoffs"],
                "general_areas": ["intro networking"],
                "storytelling": "Short claim-plus-evidence notes; lecture tone.",
            },
        )
        self.assertIn(
            "Lore blueprint captured", self.lore("blueprint", "apply", blueprint)
        )
        shown = self.lore("blueprint", "show")
        self.assertIn("# Lore map — Professor Ada", shown)
        self.assertIn("- consensus tradeoffs", shown)

        status = self.lore("status")
        self.assertIn(
            "3 private · 1 discarded · 1 active publication (externally usable)",
            status,
        )
        self.assertIn(f"Database: {self.lore_home / 'lore.db'}", status)
        self.assertIn("Publication price: $0.25", status)

        # Nothing was left behind outside the homes the run was given.
        self.assertEqual(
            [
                str(path.relative_to(self.home))
                for path in self.home.rglob("*")
                if path.is_file()
            ],
            ["Library/Application Support/Lore/attended"],
        )
        self.assertEqual(list(self.scratch.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
