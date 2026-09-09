---
id: APP-105
title: Give publication decide the same approval-token gate answer apply has
priority: P1
effort: S
component: desktop-app
status: in-review
related: [APP-006, APP-033, APP-035]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-09
updated: 2026-09-09
---

## Problem

`lore publication decide` accepts a decision from stdin whenever
`LORE_ATTENDED_SURFACE=desktop` is set on a non-interactive pipe
(`_attended()` in `lore/cli.py`). That marker is not proof of owner
approval: the desktop agent's own Bash tool can run `lore publication
decide` directly, set the same environment variable on that one command,
and pipe non-interactive stdin — nothing in `bashSandboxPolicy`
(`app/desktop/src/agent.mjs`) denies it, because the sandbox is a
filesystem-and-network policy, not a command-name denylist.
`docs/desktop-app.md`'s rule 3 previously claimed the Bash policy
"hard-denies every `lore publication` and `lore answer` mutation," which
was never literally true and has been corrected to describe the actual
mechanism (APP-035).

`lore answer apply` no longer has this gap: it additionally requires
`LORE_APPROVAL_TOKEN` to match a random token Electron main mints at
launch and writes under Electron's `userData`, a path
`bashSandboxPolicy` denies both read and write on. `lore publication
decide` has no equivalent second check.

## Proposed approach

Reuse APP-035's mechanism rather than inventing a second one:
`main.cjs`'s `APPROVAL_TOKEN` and `cli.py`'s `_require_approval_token()`
are already general — extend `publication_decide()` to call
`_require_approval_token()` the same way `answer_decide()` does, and have
`state.cjs`'s `decide()` pass `LORE_APPROVAL_TOKEN` the same way
`setAnswerSettings()` does. No new token, no new file, no new sandbox
rule — the same one already protects both.

## Acceptance criteria

- [ ] `lore publication decide` refuses a forged attempt (the attended
      marker set, non-interactive stdin, no or wrong approval token) with
      the same error `lore answer apply` gives.
- [ ] The existing Desktop approve/skip flow (`publication:decide` IPC →
      `state.cjs`'s `decide()`) continues to work unchanged from the
      owner's side.
- [ ] A focused test proves both the approved path and a forged
      agent-originated attempt, mirroring APP-035's own boundary tests in
      `tests/test_cli.py` and `app/desktop/test/app.test.cjs`.
- [ ] `docs/desktop-app.md` rule 3 is updated once this lands: drop the
      "does not yet have an equivalent second check" sentence.

## Notes

Filed while implementing APP-035, which fixed this for the answer tier
and corrected the doc's stale claim but left publication approval as a
known gap rather than expanding that item's scope.
