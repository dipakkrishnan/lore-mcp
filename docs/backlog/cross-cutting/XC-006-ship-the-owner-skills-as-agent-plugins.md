---
id: XC-006
title: Ship the owner skill pack as agent plugins with a marketplace entry
priority: P3
effort: M
component: cross-cutting
status: ready
related: [XC-005, ONB-001]
blockers: []
dependencies: []
github_issue: null
created: 2026-07-30
updated: 2026-08-26
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
- [ ] The plugin ships the same skill files the contract tests pin — no
      forked copies.
- [ ] `install.sh` still works unchanged for the no-plugin path (Codex
      included).

## Notes

From the PR #42 discussion, 2026-07-30. Deliberately after launch-critical
work: distribution polish, not a launch gate.

**Prioritization pass 2026-08-26:** No blockers, concrete AC. Stays `P3` — deliberately after launch-critical work per its own Notes — but readiness and priority are independent: unblocked and specified is enough to promote. Promoted `in-review` → `ready`.
