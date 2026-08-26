---
id: APP-035
title: Expose optional paid answers through an unforgeable desktop owner gate
priority: P2
effort: M
component: desktop-app
status: in-review
related: [APP-006, APP-008, APP-019, APP-030, XC-017, MCP-003]
blockers: []
dependencies: ["Publication-only desktop dogfood shows paid answers are worth surfacing"]
github_issue: null
created: 2026-08-25
updated: 2026-08-25
---

## Problem

Lore already supports an optional paid-answer tier, but Desktop has no safe way
to enable it. PR #155 briefly treated `LORE_ATTENDED_SURFACE=desktop` plus piped
stdin as owner attendance; the embedded agent's Bash tool can forge that marker
and approve its own charter and price. Paid answers are not needed to prove the
core publication-store loop, so carrying that bridge in APP-030 adds risk and
scope without helping current dogfood.

## Proposed approach

After publication-only dogfood demonstrates demand, add the smallest main-process
owner action that reuses Lore's existing answer settings validation without
trusting an environment variable, agent Bash, or a renderer boolean as proof of
approval. Keep the answer runtime, charter drafting, pricing, and push mechanics
where they already live; this item owns only the missing Desktop authorization
seam.

## Acceptance criteria

- [ ] Desktop shows the exact public proxy charter and per-answer price before
      the owner can enable the tier; declining changes nothing.
- [ ] Agent Bash cannot enable, disable, or alter paid answers by setting
      `LORE_ATTENDED_SURFACE` or invoking the CLI directly.
- [ ] The implementation reuses Lore's answer-settings validation and does not
      duplicate answer, pricing, or push mechanics in Electron.
- [ ] Enabling and disabling remain optional; the publication-only deploy flow
      works unchanged without configuring an answer model or provider secret.
- [ ] A focused boundary test proves both the approved Desktop path and a forged
      agent-originated attempt.

## Notes

Split from APP-030 on 2026-08-25. The removed bridge already established the
useful UI shape—a typed charter-and-price review card—but its attendance signal
was not an authorization boundary. Do not restore that implementation unchanged.
