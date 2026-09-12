---
id: APP-105
title: Give publication decide the same approval-token gate answer apply has
priority: P1
effort: S
component: desktop-app
status: obsolete
related: [APP-006, APP-033, APP-035, APP-106]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-09
updated: 2026-09-11
---

## Problem

`lore publication decide` accepts a decision from stdin whenever
`LORE_ATTENDED_SURFACE=desktop` is set on a non-interactive pipe, and the
desktop agent's own Bash tool can set that marker on a command it runs itself.
This item proposed closing that the way `APP-035` had: by additionally
requiring an approval token minted by Electron main and written to a path the
Bash sandbox denies.

## Proposed approach

Reuse `APP-035`'s mechanism — extend `publication_decide()` to call
`_require_approval_token()` the same way `answer_decide()` did, and have
`state.cjs`'s `decide()` pass the token the way `setAnswerSettings()` did.

## Acceptance criteria

- [ ] Superseded — see Notes.

## Notes

**Obsolete 2026-09-11: the mechanism this item proposed to copy no longer
exists.** `APP-035`'s approval token was removed during that item's review,
because it did not hold:

- The Bash sandbox grants write access to the whole Lore home — capture,
  sessions, and the blueprint all need it — and `lore.db` lives there, so
  `sqlite3 "$LORE_HOME/lore.db" "update settings ..."` reaches any setting
  without the CLI in the path at all.
- The token path was resolved from `LORE_DESKTOP_USER_DATA`, which the same
  shell can set, so it could plant a token file it controlled and match it.

Copying that to publications would have copied a check that stops nothing. The
real problem this item was pointing at is genuine and now lives in `APP-106`:
owner-decision writes should leave the store the sandboxed shell can write,
which fixes publications, pricing, and answers together instead of one command
at a time.
