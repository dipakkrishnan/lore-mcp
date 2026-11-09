---
id: XC-127
title: Point the Python contract test's docstring at its Node counterpart
priority: P3
effort: XS
component: cross-cutting
status: ready
related: [MCP-002, XC-101]
blockers: []
dependencies: []
github_issue: null
created: 2026-11-09
updated: 2026-11-09
---

## Problem

The module docstring of `tests/test_mcp_contract.py` names the Node
counterpart as `lore/node/test/mcp-contract.test.ts`. XC-101 (#677) deleted that
file when it folded the Worker's boot-heavy tests into seven files. The check
against `contracts/mcp_tools.json` now lives in
`lore/node/test/paid-path.test.ts`. A reader who follows the docstring finds
nothing.

## Proposed approach

Change the docstring to name the file that now reads `contracts/mcp_tools.json`.
Before writing it, confirm with `grep -rl mcp_tools.json lore/node/test` that
this is still `paid-path.test.ts`.

## Acceptance criteria

- [ ] The docstring names a Node test file that exists and reads
      `contracts/mcp_tools.json`.
- [ ] Layout scan: this item touches no walk; no view scanned by the desktop
      walks before this change is unscanned after it.
