---
id: XC-002
title: Intent-driven publishing flow (lore-publish + publication apply/list/revoke)
priority: P1
effort: L
component: cross-cutting
status: in-review
related: [STO-001, CLI-001, XC-001, MON-001]
blockers: [STO-001]
dependencies: []
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/6
created: 2026-07-27
updated: 2026-07-27
---

## Problem

Under the "Private by Default, Publish by Intent" model, memories are retained
privately and disclosure happens only through bounded, owner-approved publications.
The data model for that (STO-001) is not enough on its own — there is no way for an
owner to actually turn private memories into publications by intent, review the
drafts, or revoke a publication later. Without this flow the publications table
stays empty and nothing is externally answerable.

## Proposed approach

Reuse the existing agent-assisted skill pattern (as `blueprint`/`profile` already
do):

- `lore-publish` skill (in Codex/Claude): the owner says "publish what I learned
  about X"; the agent searches the private library, drafts 1-3 concise bounded
  publication candidates with their supporting private sources, and shows them.
  Agents may **draft but cannot approve**.
- `lore publication apply <file>` — validates, previews, and requires interactive
  owner approval per candidate (approve / revise / reject); saves only approved
  text to the publications table with provenance references.
- `lore publication list` — shows active and revoked publications.
- `lore publication revoke <id>` — immediately removes a publication from MCP
  retrieval.

Publications hold derived text, not copied memory documents. Provenance is
owner-visible but not automatically disclosed externally.

## Acceptance criteria

- [ ] `lore publication apply` cannot save a publication without an explicit
      interactive owner approval step; no agent/automated path can approve.
- [ ] `list` shows active and revoked; `revoke` flips state and the publication is
      immediately unreachable from `discover`/`answer`.
- [ ] Publishing one topic takes no more than three owner decisions.
- [ ] Approved publications carry provenance references back to their private
      memories.

## Notes

Cataloged from https://github.com/dipakkrishnan/lore-mcp/issues/6, from the minimal
implementation in Dipak's "Private by Default, Publish by Intent" doc. Blocked by
STO-001 (needs the publications table + MCP read-path move). This is the intent-
driven counterpart to CLI-001: CLI-001 handles cheap bulk *retention* (private/
discarded); XC-002 handles rare, deliberate *disclosure*. Open design question from
the doc, still unresolved: is a publication a reusable bounded claim or a policy for
request-time synthesis — the doc's starting recommendation is reusable bounded
claims (easier to inspect, approve, audit, revoke).
