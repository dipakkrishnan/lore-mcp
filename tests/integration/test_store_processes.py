"""Several real `lore` processes open one brand-new home at once (STO-004).

XC-097: the two tests here start four `python -m lore` processes each, so they
run in the integration tier, apart from the in-process tests in
`tests/test_store.py`, whose `StoreConcurrencyTest` covers the same race with
one connection standing in for the other process.
"""

from __future__ import annotations

import sqlite3
import subprocess
import sys
import time
from pathlib import Path

from helpers import LoreTestCase


class StoreProcessesTest(LoreTestCase):
    """The first migration switches the database to WAL, and SQLite refuses that
    switch immediately, ignoring the busy timeout, while another connection is
    writing. The loser of that race used to die with "database is locked"."""

    # Every one of these opens the store; the desktop app's first render runs
    # the first two together.
    COMMANDS = (
        ("desktop-state",),
        ("sources", "catalog", "--json"),
        ("search", "deployment", "--json"),
    )

    def hold_write_lock(self) -> sqlite3.Connection:
        """Stand in for another process that is midway through a write to a
        database that has not been switched to WAL yet."""
        self.lore_home.mkdir(parents=True, exist_ok=True)
        holder = sqlite3.connect(
            self.lore_home / "lore.db", isolation_level=None, check_same_thread=False
        )
        self.addCleanup(holder.close)
        holder.execute("BEGIN IMMEDIATE")
        return holder

    def start_lore_processes(self, count: int) -> list[subprocess.Popen[str]]:
        """Start `count` real `lore` processes together."""
        processes = [
            subprocess.Popen(
                [sys.executable, "-m", "lore", *self.COMMANDS[i % len(self.COMMANDS)]],
                cwd=Path(__file__).resolve().parents[2],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
            )
            for i in range(count)
        ]
        self.addCleanup(self.reap, processes)
        return processes

    @staticmethod
    def reap(processes: list[subprocess.Popen[str]]) -> None:
        for process in processes:
            process.kill()
            process.wait()
            if process.stderr and not process.stderr.closed:
                process.stderr.close()

    def assert_all_succeed(self, processes: list[subprocess.Popen[str]]) -> None:
        for process in processes:
            _, stderr = process.communicate(timeout=90)
            self.assertEqual(process.returncode, 0, stderr)

    def test_several_lore_processes_on_an_empty_home_all_succeed(self) -> None:
        self.assert_all_succeed(self.start_lore_processes(4))

    def test_lore_processes_wait_for_a_migration_already_under_way(self) -> None:
        # The race itself is rare, so hold the lock the winner would hold until
        # every process has had time to start and meet it on the journal-mode
        # switch. One that gives up exits while the lock is still held.
        holder = self.hold_write_lock()
        processes = self.start_lore_processes(4)
        ceiling = time.monotonic() + 6
        while time.monotonic() < ceiling and all(p.poll() is None for p in processes):
            time.sleep(0.1)
        holder.execute("COMMIT")
        self.assert_all_succeed(processes)
