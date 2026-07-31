---
id: XC-002
title: Intent-driven publishing flow (lore-publish + publication review/list/revoke)
priority: P1
effort: L
component: cross-cutting
status: in-review
related: [STO-001, CLI-001, XC-001, MCP-001]
blockers: [STO-001]
dependencies: []
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/6
created: 2026-07-27
updated: 2026-07-29
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
- `lore publication review <file>` — validates, previews, and requires interactive
  owner approval per candidate (approve / revise / reject); saves only approved
  text to the publications table with provenance references.
- `lore publication list` — shows active and revoked publications.
- `lore publication revoke <id>` — immediately removes a publication from MCP
  retrieval.

A publication is a **reusable bounded claim** (resolved: not a request-time
synthesis policy) — a stable, inspectable, revocable unit. The owner may publish
two kinds, both via the same explicit approval:

- a derived bounded claim (synthesized text), or
- **promoted content** — a specific piece of private content the owner chooses to
  expose verbatim (e.g. an uploaded document made public).

So the doc's "derived text, not copied documents by default" is intentionally
relaxed: copied content is allowed, but only as an explicit per-item promotion,
never as a default or a bulk action. Provenance is owner-visible but not
automatically disclosed externally.

## Acceptance criteria

- [ ] `lore publication review` requires an attended interactive confirmation
      and exposes no non-interactive approval flag; the agent skill forbids
      invoking or answering that prompt on the owner's behalf.
- [ ] `list` shows active and revoked; `revoke` flips state and the publication is
      immediately unreachable from `discover`/`answer`.
- [ ] Publishing one topic takes no more than three owner decisions.
- [ ] Approved publications carry provenance references back to their private
      memories.
- [ ] A publication can be either a derived bounded claim or explicitly-promoted
      verbatim content; promoting content is a deliberate per-item choice, never a
      default or bulk action.

## Notes

Blocks MCP-001 (browsable publication tree): there is nothing for a buyer to
browse until this flow can create publications. MON-001 dropped from `related`
— it was closed obsolete when Cloudflare was dropped.

Cataloged from https://github.com/dipakkrishnan/lore-mcp/issues/6, from the minimal
implementation in Dipak's "Private by Default, Publish by Intent" doc. Blocked by
STO-001 (needs the publications table + MCP read-path move). This is the intent-
driven counterpart to CLI-001: CLI-001 handles cheap bulk *retention* (private/
discarded); XC-002 handles rare, deliberate *disclosure*. The doc's open design
question is **resolved (Shane + Dipak): bounded claims**, not request-time synthesis
policies — easier to inspect, approve, audit, and revoke. The one extension to the
doc is that a publication may also be explicitly-promoted verbatim content, not only
a derived claim.
