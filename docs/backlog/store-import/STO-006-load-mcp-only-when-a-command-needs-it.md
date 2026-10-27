---
id: STO-006
title: Load mcp only when a command needs it
priority: P2
effort: S
component: store-import
status: in-review
related: [XC-077, APP-066]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-26
updated: 2026-10-26
---

## Problem

Every `lore` invocation imports the `mcp` SDK, whether or not the command talks
to a hosted app. `lore/cli.py:32,38` import `lore.sources`, and `lore/sources.py:39-47`
imports `Client`, `OAuthClientProvider`, `streamable_http_client`,
`OAuthClientMetadata` and `TextContent` at module level; `lore/signin.py:15-16`
(reached from `lore/inbox.py:30`, which `cli.py:36` also imports) does the same.
Only the hosted-reader path uses any of it. Measured on 2026-10-26 at `d8530d95`
on an M-series Mac, median of 3 (`python -X importtime -c "import lore.cli"`):
`lore.cli` 325 ms, of which `lore.sources` 256 ms and `mcp` 222 ms (68% of the
whole import). `uv run lore --help` takes 0.40-0.42 s wall clock; `uv run python
-c pass` takes 34 ms, so the cost is the import, not uv.

The desktop app pays this on every action: `app/desktop/src/state.cjs:137`
spawns a fresh `uv run lore ...` per IPC call (`state.cjs:13`), and one renderer
refresh fans out to about 5 calls. CI pays it hundreds of times per run: the
`agents` walk alone makes 258 app CLI calls plus 105 nested fixture calls, and on
the 3-vCPU `macos-14` runner it takes 215 s (median of the last 8 green runs)
against 122 s locally, 1.76x slower, the worst ratio of any walk because 5-13
Python startups contend for 3 cores.

## Proposed approach

Move the `mcp` imports into the functions that use them, and keep the names
that only appear in annotations under `TYPE_CHECKING` (both files already have
`from __future__ import annotations`, so annotations never evaluate).

Runtime call sites in `lore/sources.py`, all in `HostedReader`
(`sources.py:1320`, shared by `Granola`, `Notion` and `Readwise` at
`sources.py:1543,1651,1691`):

- `connect` (`sources.py:1404-1411`): `Client`, `streamable_http_client`.
- `_auth` (`sources.py:1413-1430`): `OAuthClientProvider`, `OAuthClientMetadata`.
- `_call` (`sources.py:1483-1487`): `TextContent`.
- `_refused` (`sources.py:1501-1505`): `OAuthFlowError`.

Runtime call sites in `lore/signin.py`:

- `Keychain.get_tokens` / `get_client_info` (`signin.py:35,41`): `OAuthToken`,
  `OAuthClientInformationFull` passed as the model to `_load`.
- `Loopback.callback` (`signin.py:81-82`): `OAuthFlowError`,
  `AuthorizationCodeResult.model_validate`.

Annotation-only uses (`sources.py:1404,1417-1418,1434-1435,1443,1457,1483`;
`signin.py:37,40,43,77`) go under `TYPE_CHECKING`. `lore/signin.py:21` attaches
a `NullHandler` to the `"mcp"` logger by name; that keeps working without the
package imported and should stay where it is.

Doing `sources.py` alone would not help: the cost would simply move to
`signin.py`, which `cli.py` reaches through `inbox.py` as well. Both files
change together.

## Acceptance criteria

- [ ] `uv run python -X importtime -c "import lore.cli"` lists no `mcp` module.
- [ ] `import lore.cli` takes under 150 ms warm on an M-series Mac (today
      313-426 ms; about 108 ms with every `mcp*` module stubbed).
- [ ] `tests/test_hosted.py` (25 tests, driven by the `tests/fixtures/granola.py`
      MCP stand-in) and `tests/test_mcp.py` still pass.
- [ ] One CI run of `Desktop macOS checks` after the change shows the `agents`
      walk under its 215 s baseline median (the last 8 green runs ranged
      160-258 s, so compare against the range, not one number).

## Notes

- Ranked 9 of 9 in the low-effort list from the 2026-10-26 CI investigation
  (part C, finding 3, option C2). The investigation measured `main` @ `d0ea8057`:
  `lore.cli` 339 ms, `mcp` 234 ms, 124 ms with `mcp` stubbed, whole process
  0.16-0.18 s against about 0.43 s. The 2026-10-26 re-measurement above at
  `d8530d95` agrees within run-to-run noise.
- Side-effect question (does any command need `mcp` at import time?): no.
  `lore mcp` (`cli.py:794`) imports `lore/mcp.py`, a hand-rolled
  `ThreadingHTTPServer` with no SDK import (`mcp.py:12-25`). `keyring` is a
  separate package imported on its own (`signin.py:13`, `inbox.py:26`; about
  4 ms) and is unaffected. The only module-level line that touches `mcp` is the
  `logging.getLogger("mcp")` call in `signin.py:21`, which needs no import. No
  entry-point registration or other import-time hooks were found in `lore/`.
- This is product latency, not just test overhead: every desktop action waits on
  at least one CLI spawn, and the import is about 60% of each spawn.
- Filed under `store-import` because the README assigns `lore/sources.py` here
  and that is where the connector imports live; about a third of the edit lands
  in `lore/signin.py`, which no component README claims. Nothing changes in
  `lore/cli.py`.
- What remains after this change (from the same `importtime` run): `pydantic`
  17 ms, `httpx2` 12 ms, `lore.blueprint` 12 ms, `lore.store` 11 ms,
  `lore.cards` 10 ms. None is worth chasing on its own.
- Related: XC-077 (walks two at a time; the other change to the same CI job from
  the same investigation), APP-066 (the renderer tests in CI whose cost this
  reduces).
