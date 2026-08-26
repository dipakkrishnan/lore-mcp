---
id: CLI-002
title: Smoke-test the owner CLI lifecycle as a real subprocess, not mocked handlers
priority: P1
effort: M
component: cli-ux
status: ready
related: [XC-004, XC-013, XC-016]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-04
updated: 2026-08-26
---

## Problem

`tests/test_cli.py` is thorough (942 lines) but every test calls a command's
handler function directly, with `sys.argv`, stdin, and the filesystem mocked
or patched around it. Nothing in the suite runs the actual `lore` console
script as a subprocess and drives it through a real sequence of commands
against a real (if temporary) `LORE_HOME`. `XC-013` found and is closing the
same gap for the Worker — asserting the real request path, not just its leaf
modules — but the CLI's own version of that gap has no covering item.

That matters because the owner's actual experience is a *sequence*: `setup`
writes state that `sync` reads, `sync` writes state that `review` reads,
`review` writes state that `capture`/`publication` read. A mocked-handler
test can pass while the on-disk contract between two consecutive commands is
broken — each command is individually correct in isolation, but the second
one never actually reads what the first one wrote, because the test never
lets it. Nothing today would catch that class of regression before a real
owner did.

## Proposed approach

A new test that shells out to `lore` (or `python -m lore.cli`) as a real
subprocess, in an isolated temp directory with `LORE_HOME`, `CLAUDE_HOME`,
and `CODEX_HOME` redirected the same way `tests/helpers.py`'s
`LoreTestCase` does for the in-process suite — except here the redirection
has to happen via subprocess environment variables, since there's no shared
process to patch.

Chain the commands a first-time owner actually runs, staying entirely
credential-free and network-free:

```
setup → sync → review → capture → price → publication review → publication list → push --local → blueprint apply → blueprint show
```

`push --local` is the reason the whole chain can stay offline: it exercises
the same SQL-writing path `push` uses against a deployed node, but against
the local dev database, so no Cloudflare account or deployed Worker is
needed. `lore node deploy` and a non-`--local` `push` are deliberately out
of scope — that's live-network territory `XC-008`/`MON-008` already own.

Seed a minimal fake source (a couple of sample memories) before `sync` so
the chain has real content to carry through `review` and `capture` rather
than running against an empty store.

Add it to `.github/workflows/tests.yml` as its own job (or fold into
`python-unit` if the runtime cost is small) so it runs on every pull
request.

## Acceptance criteria

- [ ] A test invokes the real `lore` entry point via `subprocess`, not a
      handler function called in-process
- [ ] It runs in a temp `LORE_HOME`/`CLAUDE_HOME`/`CODEX_HOME`, never
      touching a real user's files or `~/.lore`
- [ ] It chains `setup → sync → review → capture → price → publication
      review → publication list → push --local → blueprint apply →
      blueprint show` in one continuous run, asserting each step's exit
      code and a distinguishing piece of its stdout
- [ ] It needs no network access, secrets, or Cloudflare/Base Sepolia
      account — `node deploy` and non-local `push` stay out of scope
- [ ] Runs in CI on every pull request
- [ ] A regression where one command writes state the next command can't
      actually read (simulate by temporarily breaking one, e.g. a
      mismatched status string between `review` and `capture`) fails this
      test even though `tests/test_cli.py`'s mocked-handler tests still pass

## Notes

Filed 2026-08-04 alongside `ONB-002`, from a survey of which "main happy
path" flows have no live/end-to-end coverage. The owner-skill conversations
(`lore-onboard`, `lore-capture`, `lore-publish`) are deliberately not
included here — `XC-005` already covers dry-running those and explicitly
rejects automating them in CI ("an LLM roleplaying an owner is the same
trap `EVAL-001` exists to close"). This item is scoped to the plain CLI
surface underneath those skills, which has no such trap: it's deterministic
argv in, exit code and stdout out.

**2026-08-06:** renumbered the related `XC-015` reference to `XC-016` — a
different, unrelated `XC-015` ("pin the skill drive-contract in the
contract tests") merged to `main` first via #80, so the id this item
originally referenced was claimed by that item instead.

**Prioritization pass 2026-08-26:** No blockers, explicit offline-only scope, concrete command chain given in the approach. Promoted `in-review` → `ready`.
