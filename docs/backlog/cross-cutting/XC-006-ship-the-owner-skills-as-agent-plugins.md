---
id: XC-006
title: Ship the owner skill pack as agent plugins with a marketplace entry
priority: P3
effort: M
component: cross-cutting
status: in-review
related: [XC-005, ONB-001]
blockers: []
dependencies: []
github_issue: null
created: 2026-07-30
updated: 2026-10-10
---

## Problem

The owner skills reach agents today by `install.sh` copying `skills/lore-*`
into `~/.claude/skills` and `~/.agents/skills` at install time. That is
copy-once distribution: a skill fix ships only when the owner re-runs the
installer, there is no version visible anywhere, and discovery is limited to
people who already found the repo. The skills are the product's front door —
onboarding, publishing, payments are all conversations — so their distribution
channel matters as much as the CLI's.

## Proposed approach

Package the `lore-*` skills as a Claude Code plugin (manifest + skills,
installable from a marketplace entry via `/plugin`), so installs are
one-command, versioned, and updatable, and the pack is discoverable by people
who never saw the repo. Provide the closest Codex equivalent — its plugin
story is thinner, so the copied-skills path likely remains Codex's mechanism
for now. `install.sh` stays as the plugin-free fallback either way; the
contract tests already generalize over `skills/lore-*` and should run against
whatever the plugin packages, so both channels ship the same tested content.
Rough shape only — needs a pass over the current plugin/marketplace format
before committing to structure.

## Acceptance criteria

- [ ] A Claude Code user can install the Lore skill pack with one plugin
      command, without cloning the repo, and receives updates on new releases.
- [x] The plugin ships the same skill files the contract tests pin — no
      forked copies.
- [x] `install.sh` still works unchanged for the no-plugin path (Codex
      included).

## Notes

From the PR #42 discussion, 2026-07-30. Deliberately after launch-critical
work: distribution polish, not a launch gate.

**Prioritization pass 2026-08-26:** No blockers, concrete AC. Stays `P3` — deliberately after launch-critical work per its own Notes — but readiness and priority are independent: unblocked and specified is enough to promote. Promoted `in-review` → `ready`.

**Implementation pass 2026-10-10 — mostly built, one criterion open, back to
`in-review` for a release decision.**

The pack shipped on `main` without this item being touched: `17ba826` ("Package
Lore for Claude and Codex") added the marketplace entries and manifests, and
`fe432d1` ("Limit public plugin to owner skills") moved the skills to
`plugins/lore/skills/` and pointed `install.sh` at them.

Criterion 1, the install half — holds. Run for real against a throwaway
`CLAUDE_CONFIG_DIR`, not the owner's:
`claude plugin marketplace add dipakkrishnan/lore-mcp` then
`claude plugin install lore@lore-marketplace` both succeeded with no clone, and
all five `lore-*` skill folders landed in the plugin cache. `claude plugin
validate` passes on the marketplace and on the plugin. It is one install command
after a one-time `marketplace add`, which is how every marketplace plugin
installs. The Codex commands in the README were not run.

Criterion 1, "receives updates on new releases" — **does not hold.**
`claude plugin update lore@lore-marketplace` answers "already at the latest
version (0.1.0)": updates are keyed on the `version` in the manifest. There have
been 14 releases, `v0.1.0` (2026-08-11) to `v0.1.13` (2026-10-10). Each tag is
an "APP-005: version the desktop app" commit that bumps only
`app/desktop/package.json`. The three plugin versions
(`plugins/lore/.claude-plugin/plugin.json`,
`plugins/lore/.codex-plugin/plugin.json`, and the entry in
`.claude-plugin/marketplace.json`) are still `0.1.0`, as are `lore.__version__`
and `pyproject.toml`. Between `v0.1.0` and `main` the skills changed by 532
added and 121 removed lines, including the whole of `lore-buy`. Someone who
installed the plugin at any point has received none of it, and is never told
there is anything to get.

Two ways to close it; both are release policy, so neither was picked here:

- Drop `version` from the manifests. Claude Code then treats every commit as a
  new version, so plugin users track `main` — ahead of the tagged releases the
  installer and the desktop app ship.
- Keep `version` and bump it in the per-release step, pinned by a test to
  `app/desktop/package.json` (the only version a release moves today). Plugin
  users then get exactly what each release ships, and the release step grows
  three files.

Pinning the manifests to `lore.__version__` was considered and dropped: that
string has not moved in 13 releases, so the test would pass forever and deliver
nothing.

Related, seen on the way and not addressed: `install.sh` defaults to
`LORE_VERSION=v0.1.0` and the README's install command fetches the `v0.1.0`
script, so the standalone installer also still ships the August skills (four,
without `lore-buy`).

Criterion 2 — holds, and is now pinned.
`test_the_plugin_ships_the_tested_skills_and_no_second_copy` in
`tests/test_skill_contract.py` asserts the Claude manifest does not redirect
`skills`, the Codex manifest's `skills` resolves to `plugins/lore/skills`, and
no other `lore-*/SKILL.md` exists in the tree, tracked or not. A stray
`skills/lore-capture/SKILL.md` turned it red. The desktop app bundles
`plugins/lore/skills` directly (`app/desktop/forge.config.js`), so it is not a
second copy either.

Criterion 3 — holds. `install.sh` is untouched, and `tests/test_install.py` runs
it twice (stubbed `uv`, real `uv`) and checks both `~/.agents/skills` and
`~/.claude/skills` receive exactly the `plugins/lore/skills/lore-*` set.

Also fixed: the README said the plugin packages "four owner workflows"; five
ship. It now names the set instead of counting it.
