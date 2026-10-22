---
id: XC-057
title: Emit and parse the "Approve Lore in your browser" line under test on both sides of the CLI
priority: P1
effort: S
component: cross-cutting
status: in-review
related: [CAP-009, CAP-024, APP-060, APP-178, XC-055, CLI-010]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-30
updated: 2026-09-30
---

## Problem

The whole hosted sign-in from the desktop hangs on one line of text:
`lore/cli.py:738-740` prints `Approve Lore in your browser: <url>` to
stderr, and `app/desktop/src/state.cjs:225-226` matches it with
`/^Approve Lore in your browser: (\S+)$/` and opens the URL only when
`openable(url, SIGN_IN)` with `SIGN_IN = {mcp-auth.granola.ai,
mcp.notion.com, readwise.io}` (`:65`). **No test emits or parses that
line**: the Granola stand-in asks for no sign-in, so `show` is never
called, and `app.test.cjs:24-28` tests `openable` with other hosts only. A
one-character change to either side, or a vendor moving its approval
host (R-04), would ship green and leave the owner waiting 300 s with no
page opened.

## Proposed approach

Pin the literal line in one shared fixture and test it from both
languages; give `state.cjs` a pure helper for the parse so the Node side
needs no CLI.

### Files

- add `tests/fixtures/approval-line.txt`: exactly one line,
  `Approve Lore in your browser: https://mcp-auth.granola.ai/oauth/authorize?client_id=lore-test`
  (no trailing newline; a fictional URL on the observed host, with no
  `code` or `state` parameter so the scrubber's loopback rule never fires
  on the fixture)
- change `app/desktop/src/state.cjs`: extract
  `approvalUrl(line) -> string | null` (regex + `openable(url, SIGN_IN)`)
  and export it alongside `openable`; `signIn` uses it
- change `tests/test_cli.py` (Python emission), `app/desktop/test/app.test.cjs`
  (Node parse)

### Test design

Python (`tests/test_cli.py`)

1. `test_connecting_a_hosted_app_prints_the_approval_line_on_stderr_and_json_on_stdout`:
   patch `HostedReader.sign_in` with a fake that calls
   `show(<url from the fixture>)` then returns `True`, and `serving(Granola().server)`
   (from `test_hosted.py`) for the read; run
   `cli.main(["sources","connect","granola","--json"])` with stdout and
   stderr captured separately. Assert stderr equals the fixture line plus
   `\n`, stdout is exactly one line that `json.loads` to a row with
   `connector == "granola"`, and the two streams do not interleave (stdout
   has no `Approve` text; stderr has no `{`).
2. `test_the_approval_line_is_flushed_before_the_wait`: the fake `sign_in`
   records `sys.stderr` content at the moment `show` returns (the desktop
   reads the stream while the CLI blocks on the loopback) — assert the
   line is already there.
3. `test_a_refused_sign_in_leaves_one_lore_line_and_exit_2`: fake
   `sign_in` raises `SourceError("Granola didn't let Lore in. Try again.")`
   → exit 2, stderr last line `lore: Granola didn't let Lore in. Try
   again.`, stdout empty (this is what `state.cjs:230` turns into the
   sheet's error).

Node (`app/desktop/test/app.test.cjs`)

4. `approvalUrl` on the fixture line (read from
   `../../tests/fixtures/approval-line.txt`) returns the URL; on the same
   line with `https://evil.example/` returns `null`; on `lore: …` returns
   `null`; on the line with a trailing space returns `null` (regex is
   anchored, so a format change fails here).
5. `SIGN_IN` contains exactly `mcp-auth.granola.ai`, `mcp.notion.com`,
   `readwise.io` (a change to the set must update this test and the
   `XC-055` allowlist test together).

## Acceptance criteria

- [ ] `tests/fixtures/approval-line.txt` is read by both a Python test and
      a Node test; changing the prefix text in `cli.py` or the regex in
      `state.cjs` fails at least one of them.
- [ ] Python: stderr carries the line, stdout the JSON, refusal exits 2
      with `lore: ` on stderr.
- [ ] Node: `approvalUrl` is exported and tested for the allow-listed host,
      a foreign host, and a malformed line.
- [ ] `uv run python -m unittest discover -s tests`, ruff check, ruff
      format --check, mypy (paths as in `XC-048`) pass; `cd app/desktop &&
      npm test` passes.

## Notes

Covers: W-09 (approval line emission and parsing), W-17 (approval line
only for allow-listed hosts), C-23 `_approve`, C-26, C-27; R-04 (the
static half; the live half is `XC-055`).

Flakiness/safety: no OAuth server is stood up; `sign_in` is patched at
the seam that already exists. A real stub with dynamic client
registration would test the SDK, not Lore, and is deliberately out of
scope; `CAP-024` covers the loopback itself.
