from __future__ import annotations

import json
import os
import plistlib
import re
import shlex
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Task:
    """A recurring local prompt executed by one coding agent."""

    id: str
    name: str
    agent: str
    prompt_path: Path
    cwd: Path
    cadence: str
    hour: int
    model: str = ""
    environment: tuple[tuple[str, str], ...] = ()

    def __post_init__(self) -> None:
        if not re.fullmatch(r"[a-z0-9-]+", self.id):
            raise ValueError("task id must contain only lowercase letters, numbers, and hyphens")
        if self.agent not in {"claude", "codex"}:
            raise ValueError(f"unsupported agent: {self.agent}")
        if self.cadence not in {"daily", "weekly"}:
            raise ValueError("task cadence must be daily or weekly")
        if not 0 <= self.hour <= 23:
            raise ValueError("task hour must be between 0 and 23")
        if any(not re.fullmatch(r"[A-Z_][A-Z0-9_]*", key) for key, _ in self.environment):
            raise ValueError("task environment contains an invalid variable name")


def install(task: Task, *, codex_home: Path, lore_command: str) -> Path:
    """Install or update a task using the agent's local scheduler."""
    if not task.prompt_path.is_file():
        raise ValueError(f"task prompt does not exist: {task.prompt_path}")
    if not task.cwd.is_dir():
        raise ValueError(f"task working directory does not exist: {task.cwd}")
    if task.agent == "codex":
        return _install_codex(task, codex_home)
    return _install_claude(task, lore_command)


def _install_codex(task: Task, codex_home: Path) -> Path:
    path = codex_home / "automations" / task.id / "automation.toml"
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    weekly = task.cadence == "weekly"
    rrule = f"FREQ={'WEEKLY;BYDAY=MO' if weekly else 'DAILY'};BYHOUR={task.hour};BYMINUTE=0"
    now = int(time.time() * 1000)
    lines = [
        "version = 1",
        f"id = {json.dumps(task.id)}",
        'kind = "cron"',
        f"name = {json.dumps(task.name)}",
        f"prompt = {json.dumps(task.prompt_path.read_text(encoding='utf-8'))}",
        'status = "ACTIVE"',
        f"rrule = {json.dumps(rrule)}",
        *([f"model = {json.dumps(task.model)}"] if task.model else []),
        'execution_environment = "local"',
        'target = { type = "projectless" }',
        f"cwds = [{json.dumps(str(task.cwd))}]",
        f"created_at = {now}",
        f"updated_at = {now}",
    ]
    _private_write(path, "\n".join(lines) + "\n")
    return path


def _install_claude(task: Task, lore_command: str) -> Path:
    if sys.platform != "darwin":
        raise OSError("Claude local scheduling currently requires macOS")
    claude = shutil.which("claude")
    if not claude:
        raise OSError("Claude CLI is not installed")
    lore = shutil.which(lore_command) if "/" not in lore_command else lore_command
    if not lore:
        raise OSError("Lore CLI is not installed")

    state = task.prompt_path.parent
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    runner = state / f"{task.id}.sh"
    stdout = state / f"{task.id}.log"
    stderr = state / f"{task.id}.err.log"
    for log in (stdout, stderr):
        log.touch(mode=0o600, exist_ok=True)
        log.chmod(0o600)

    model = f"  --model {shlex.quote(task.model)} \\\n" if task.model else ""
    allowed = ",".join(
        (
            "Write",
            "Bash(lore search *)",
            "Bash(lore sync *)",
        )
    )
    path = ":".join(
        dict.fromkeys(
            (
                str(Path(lore).parent),
                str(Path(claude).parent),
                "/usr/local/bin",
                "/opt/homebrew/bin",
                "/usr/bin",
                "/bin",
                "/usr/sbin",
                "/sbin",
            )
        )
    )
    script = f"""#!/bin/sh
set -eu
umask 077
PATH={shlex.quote(path)}
export PATH
{_exports(task.environment)}
{shlex.quote(lore)} sync
exec {shlex.quote(claude)} -p \\
  --name {shlex.quote(task.name)} \\
  --permission-mode dontAsk \\
  --tools Bash,Write \\
  --allowedTools {shlex.quote(allowed)} \\
{model}  -- "$(cat {shlex.quote(str(task.prompt_path))})"
"""
    _private_write(runner, script, 0o700)

    label = f"com.lore.{task.id}"
    plist = Path.home() / "Library" / "LaunchAgents" / f"{label}.plist"
    calendar = {"Hour": task.hour, "Minute": 0}
    if task.cadence == "weekly":
        calendar["Weekday"] = 1
    definition = {
        "Label": label,
        "ProgramArguments": [str(runner)],
        "WorkingDirectory": str(task.cwd),
        "StartCalendarInterval": calendar,
        "StandardOutPath": str(stdout),
        "StandardErrorPath": str(stderr),
        "ProcessType": "Background",
    }
    plist.parent.mkdir(parents=True, exist_ok=True)
    _private_write(plist, plistlib.dumps(definition).decode())

    domain = f"gui/{os.getuid()}"
    subprocess.run(
        ["launchctl", "bootout", domain, str(plist)],
        text=True,
        capture_output=True,
    )
    result = subprocess.run(
        ["launchctl", "bootstrap", domain, str(plist)],
        text=True,
        capture_output=True,
    )
    if result.returncode:
        raise OSError(result.stderr.strip() or "launchctl bootstrap failed")
    return plist


def _private_write(path: Path, content: str, mode: int = 0o600) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    path.chmod(mode)


def _exports(environment: tuple[tuple[str, str], ...]) -> str:
    return "\n".join(
        f"{key}={shlex.quote(value)}\nexport {key}" for key, value in environment
    )
