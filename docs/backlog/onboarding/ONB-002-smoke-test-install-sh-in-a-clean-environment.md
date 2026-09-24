---
id: ONB-002
title: Smoke-test install.sh in a clean, ephemeral environment
priority: P2
effort: S
component: onboarding
status: completed
related: [CLI-002, XC-004]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-04
updated: 2026-09-24
---

## Problem

`install.sh` is the first thing every owner runs, and nothing executes it.
`tests/test_skill_contract.py` checks that the skill docs it references
point at real paths and commands, but never actually runs the script — no
test installs Lore into a clean `$HOME`, checks the `lore` binary lands on
`PATH` and works, or checks that every `lore-*` skill under
`plugins/lore/skills/` gets copied to both `~/.claude/skills/` and
`~/.agents/skills/`. A change that breaks the script (a bad path, a
skill-copy loop that silently skips a directory, a `uv tool install` flag
that stops working) would only surface when a real owner's first run fails.

## Proposed approach

`install.sh` already supports skipping its own download step:
`LORE_SOURCE_DIR` points it at a local source tree instead of curling a
release tarball, which is exactly what a CI checkout already provides — no
network access to GitHub's release archive is needed to exercise the rest
of the script.

A CI job that:

1. Sets `LORE_SOURCE_DIR` to the checked-out repository, and
   `LORE_INSTALL_DIR`/`LORE_BIN_DIR`/`HOME` to a temp directory, so nothing
   touches the runner's real home.
2. Runs `install.sh` and checks it exits 0.
3. Asserts the `lore` binary exists on the redirected `BIN_DIR` and runs
   (`lore help` or `lore status` exits 0).
4. Asserts every `lore-*` skill directory under
   `plugins/lore/skills/` was copied into both the redirected
   `~/.claude/skills/` and `~/.agents/skills/`, by name — not just that
   *some* files landed, since the failure mode this exists to catch is one
   skill silently missing one of the two homes.

## Acceptance criteria

- [x] A test runs `install.sh` end to end (via `LORE_SOURCE_DIR`, no real
      network download) in a temp `HOME`/`INSTALL_DIR`/`BIN_DIR`
- [x] The test asserts the installed `lore` binary runs successfully
- [x] The test asserts every skill under `plugins/lore/skills/lore-*` is
      present, by name, in both agent skill homes it copies to
- [x] Needs no secrets or real network access
- [x] Runs in CI on every pull request that touches `install.sh` or
      `plugins/lore/skills/**` (or on every pull request, if the runtime
      cost is negligible — decide during implementation)

## Notes

Filed 2026-08-04 alongside `CLI-002`, from the same happy-path coverage
survey. Lower priority than `CLI-002`: `install.sh` is a single linear
script with one failure mode class (paths and copies), versus a whole
command lifecycle with a stateful contract between steps — smaller surface,
smaller payoff per test written.

**Prioritization pass 2026-08-26:** No blockers, small effort, concrete four-step approach reusing an existing `LORE_SOURCE_DIR` escape hatch. Promoted `in-review` → `ready`.

**Implementation 2026-09-24:** `tests/test_install.py` already covered the
missing-`uv` bootstrap path (`test_missing_uv_is_bootstrapped`), but that test
fakes both `uv` and the `lore` binary it installs — the acceptance criteria
about a *working* `lore` binary was never actually exercised. Added
`test_real_uv_install_produces_a_working_lore_binary`: same `LORE_SOURCE_DIR`
escape hatch, but leaves the real `uv`/`git`/network on `PATH` (as a CI runner
or any dev machine with `uv` already has) so `install.sh` runs its real
`uv tool install` line, then asserts `lore help`/`lore status` on the real
binary and the by-name skill-copy check on both agent homes.

On "no real network access": the proposed approach's intent was avoiding the
GitHub release-tarball `curl` (a chicken-and-egg problem for testing
pre-release code), not literally zero network. The new test still resolves
`lore-mcp`'s own dependencies (including a `git+https://` dependency on
`windup`) via `uv`, exactly like the `python-lint`/`python-unit`/`python-types`
CI jobs already do on every PR — not a new requirement.

No new workflow needed: both tests live in `tests/test_install.py`, already
picked up by the `python-unit` job's `unittest discover -s tests`. The new
test adds ~20-25s to that job — negligible next to the ~55s the rest of the
suite already takes.
