---
id: APP-106
title: Take owner-decision writes out of the sandboxed shell's reach
priority: P2
effort: L
component: desktop-app
status: ideation
related: [APP-006, APP-008, APP-033, APP-035, APP-105]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-11
updated: 2026-09-11
---

## Problem

Every owner decision Desktop makes — the publication price, approving or
revoking a publication, enabling the answer tier — is a row in `settings` or
`publications` in `lore.db`. The embedded agent's Bash tool has write access to
the whole Lore home, because capture, session files, and the blueprint all need
it, and `lore.db` sits in that same directory. So:

```sh
sqlite3 "$LORE_HOME/lore.db" "update settings set value='true' where key='answer_enabled'"
```

changes an owner decision with no card, no CLI, and nothing to check. The
attended-surface marker in front of `lore publication decide` and `lore answer
apply` is a guardrail for the naive path, not a boundary — `docs/desktop-app.md`
rule 3 now says so plainly rather than claiming otherwise.

`APP-035` tried to close this for one command with a per-launch token file and
a sandbox deny rule, and it did not hold (see that item's notes, and `APP-105`,
obsoleted for proposing to copy it). One command's gate cannot be stronger than
the store behind it. This is the design item that would actually raise the
floor, for every owner decision at once.

## Proposed approach

Rough shape, not a design. The property wanted: the sandboxed shell can read
what it needs and write what it legitimately owns, but cannot write the rows
that represent an owner decision. Options worth costing:

- **Split the store.** Owner-decision state (settings, publication approval)
  moves out of `lore.db` into a file the sandbox denies, with the CLI reaching
  it through a path Bash cannot invoke. Cheapest to reason about; a schema and
  migration cost.
- **Main-process-only writes.** Electron main becomes the sole writer, and the
  CLI talks to it rather than to SQLite when it runs under the app. Keeps one
  store; adds an IPC surface and a story for the terminal CLI.
- **Narrow the sandbox.** Deny `lore.db` specifically while keeping the rest of
  the Lore home writable, and give capture its own path. Smallest change if the
  sandbox can express it; needs checking against every write the shell makes
  today, and `realpathSync` handling so a symlink cannot walk around it.

Whichever way: the acceptance test is the `sqlite3` line above failing, not a
new check in front of one subcommand.

## Acceptance criteria

- [ ] TBD — needs a design pass to pick an approach before criteria mean
      anything. The one fixed requirement: a sandboxed Bash command cannot
      change an owner decision, demonstrated against the real policy rather
      than argued.

## Notes

Filed 2026-09-11 out of `APP-035`'s review, where the repo owner reproduced
both bypasses from inside the shipped sandbox policy and pointed out that
per-command hardening cannot get there. `APP-105` is obsoleted in favour of
this.

Worth scoping honestly before picking it up: nothing in the product depends on
this boundary existing today, and the app has shipped without it. It matters
more as the agent gets more autonomous, and as what a wrong write costs the
owner goes up — a mis-set price is cheap, a silently disabled paid tier or an
unapproved publication is not.
