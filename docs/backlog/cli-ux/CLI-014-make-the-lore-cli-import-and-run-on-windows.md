---
id: CLI-014
title: Make the lore CLI import and run on Windows
priority: P2
effort: M
component: cli-ux
status: ideation
related: [XC-095, APP-251, APP-252]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-28
updated: 2026-10-28
---

## Problem

`lore` cannot start on Windows: cli.py:8 imports pwd, automation.py:3 and deploy.py:12 import fcntl.
paths.py hard-codes ~/Library for the store and Obsidian, and store.py:_pid_alive calls os.kill(pid, 0),
which on Windows sends CTRL_C_EVENT. No CI job runs on Windows, so this regresses silently.


## Proposed approach

One shared file-lock class (msvcrt.locking on Windows, flock elsewhere, or the filelock dependency) used
by automation and deploy. Import pwd lazily, inside attended_folder only. One platform data-dir helper
(%LOCALAPPDATA%\Lore on Windows) for store_folder/attended_folder, and %APPDATA%\obsidian. Replace
_pid_alive with an OpenProcess/GetExitCodeProcess check on Windows. Add a windows-latest job to
tests.yml running the Python suite. Add install.ps1 mirroring install.sh (uv, uv tool install, skills
into %USERPROFILE%\.claude\skills and .agents\skills).


## Acceptance criteria

- [ ] Python suite green on windows-latest in CI
- [ ] `irm .../install.ps1 | iex` installs lore.exe; `lore serve` works as a Claude Code / Claude Desktop MCP server on Windows
- [ ] `lore sources add` of a ChatGPT and a Claude export, and capture via MCP store, round-trip on Windows
- [ ] macOS behaviour unchanged (existing suites green)


## Notes

Attended approvals stay terminal-interactive on Windows until the launch-key port lands.

From the Oct 27 launch feedback; see `docs/launch-feedback-2026-10-27.md`.
