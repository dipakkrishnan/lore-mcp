---
id: APP-181
title: Never show a seller a raw error message
priority: P1
effort: S
component: desktop-app
status: in-review
related: [APP-085, APP-109, APP-014, STO-004]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-11-12
---

## Problem

Sellers see internal errors as page text. On a machine with no store, Sales
shows "no deployed node on this machine; open your store first". On a fresh
home, Memories showed "sqlite3.OperationalError: unable to open database file".
Neither tells a seller what happened or what to do.

## Proposed approach

- Treat "no store yet" as an empty state, not an error: Sales says "No sales
  yet. Sales show up here once your store is open." with Open your store.
- Map CLI failures to one plain sentence and a next step. Keep the raw
  text behind a Details disclosure and attach it to Report this problem.

## Acceptance criteria

- [ ] Sales with no store shows an empty state, not an error
- [ ] No tab renders a Python exception name or CLI error string as body text
- [ ] The raw error is still reachable for a bug report

## Notes

Filed from the 2026-10-06 new-seller audit. The database error on Memories
came from the migration race in STO-004.

**Delivery loop plan review (2026-11-12):** Moved back from `ready` to
`in-review`. Three implementation plans were written and each was
rejected by a plan reviewer that checked it against the code; the open
issues did not shrink between rounds, which suggests the item is
under-scoped as written. The reviewer's last open issues are below.
Labels such as "Test 2" or "R3" refer to that rejected plan, which
was not kept; the facts about the code stand on their own.

- AC2 gap: raw() misses CLI error strings that start with a lowercase
  'error:'. lore/cli.py:721 calls root.error(...), so argparse writes 'lore:
  error: unrecognized arguments: ...' to stderr. state.cjs:181 keeps the
  last line and strips 'lore: ', so the renderer gets 'error: unrecognized
  arguments: --x'. That text matches none of the planned patterns:
  /\b[\w.]*(Error|Exception)\b:/ is case-sensitive, and the round-2 plan
  removed the only 'lore:' rule. uv failures ('error: Failed to spawn ...',
  'Caused by: ... (os error 2)') also get through, because '(os error N)' is
  not '[Errno N]'. These are the CLI-version-mismatch failures the relaunch
  rule exists for. Fix: add a case-insensitive /^error: / rule, /\(os error
  \d+\)/ and /^Caused by:/, each with its own row in the renderer-errors
  table.
- The plan says in I4 that 'a caller's wording is never lost and the raw
  text is never dropped', but its own problem() breaks that. detail is set
  only when text !== message(error). When act() is given a caller `failed`
  and the error passes raw() (an owner-worded CLI refusal such as 'That bid
  has ended' or 'Title cannot be empty'), p.text equals the message and
  detail is undefined. The notice then shows only the caller sentence, so
  the real error appears nowhere: not on screen, not in Details, not in
  lastProblem. That fails AC3 for these paths. The planned test cannot catch
  it because it only uses Errno text. Fix: in act(), set detail =
  message(error) whenever the shown text differs from it, and add a test
  where the caller passes `failed` and the error is a passthrough message.
- The ordering of salesGroup in parts() is ambiguous and conflicts with an
  existing convention. The plan says 'append salesGroup() last', but today
  salesGroup is appended before the Taken down group. renderer-
  inventory.test.cjs:61-66 asserts that Taken down is 'the last thing in the
  list', 'at the foot'. If Sales moves after Taken down whenever a store is
  open with sales, or when the new sales:none row shows, that convention
  breaks. Say that only the condition changes and the position stays before
  Taken down, and add an assertion for it.
- AC3 coverage is incomplete. Four tell(reason(...)) sites are left out of
  the problem() switch: 2274, 2280, 4363 and 4451 (openAgentApp and copy-
  link failures). reason() now hides raw text at those sites, but nothing
  records lastProblem or attaches Details there, so the hidden error cannot
  be reached for a bug report. Either switch them to problem() or explain
  why they are excluded.
- The plan does not say where 'home dir replaced by ~' gets the home
  directory. The renderer has no os.homedir(). snapshot.home is the Lore
  home (~/.lore), not the user's home, and it is null before the first load
  (sign-in and welcome paths). The existing convention is renderer.js:4707
  s.home.replace(/^\/Users\/[^/]+/, "~"). Name the regex, apply it globally
  across the detail text (paths appear mid-string, e.g. "[Errno 13]
  Permission denied: '/Users/x/.lore/lore.db'"), and have the sheet-path
  test check the redaction.
