---
id: XC-127
title: Point the Python contract test's docstring at its Node counterpart
priority: P3
effort: XS
component: cross-cutting
status: completed
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

- [x] The docstring names a Node test file that exists and reads
      `contracts/mcp_tools.json`.
- [x] Layout scan: this item touches no walk; no view scanned by the desktop
      walks before this change is unscanned after it.

## Notes

**Implementation 2026-11-09:** `grep -rl mcp_tools.json lore/node/test` on
main `1ab670b1` returns only `lore/node/test/paid-path.test.ts`. It imports the
contract at line 17, and its "MCP tool contract" block under "before anyone
pays" runs the check. The docstring now names that file. It names the file
and not the `describe` block, so a later move of the block inside the file
does not make the docstring stale again.

Layout scan: the diff touches only `tests/test_mcp_contract.py` and backlog
docs. Nothing under `app/` changes, so no walk and no scanned view is
affected.

Possible follow-up, not done here: `docs/test-plan-handoff.md` still lists
`mcp-contract` among the Node test files. That list predates XC-101 and
probably names other files XC-101 folded away. Historical item files that
mention `mcp-contract.test.ts` (MCP-002, XC-003, XC-100, XC-101) are records
and are left as written.
