---
id: XC-029
title: Stand up the OTLP collector Worker and its Analytics Engine sink
priority: P1
effort: M
component: cross-cutting
status: ready
related: [XC-030, APP-058, MON-021, CLI-004]
blockers: []
dependencies: ["A Cloudflare account and Workers Analytics Engine binding the maintainers control — distinct from any owner's node"]
github_issue: null
created: 2026-09-07
updated: 2026-09-07
---

## Problem

`APP-058` needs a hosted sink for the desktop activation funnel, and
`MON-021` needs one for QA node traces, but nothing exists yet. Sending
either straight to a third-party analytics vendor would mean trusting that
vendor's own validation of what a client is allowed to send — the allowlist
in `docs/telemetry.md` needs to be enforced server-side, not just by a
well-behaved client.

## Proposed approach

A small Worker, `collector/`, sibling to `bridge/` and `site/` at the repo
root, maintainer-owned and never shipped to an owner's node. It accepts
OTLP/HTTP+JSON on one endpoint, re-validates every record against the same
attribute schema `lore/node/src/telemetry.ts` maintains for the node plane (shared as a small published module or a
duplicated, tested constant — decide which when implementing), drops
anything unrecognized rather than widening the schema to fit it, and writes
accepted records to Workers Analytics Engine (`index1` = installation id;
blobs = event name, app version, and coded attributes). Analytics Engine's
SQL API is the maintainers' own top-down query surface — no dashboard needs
building here, matching the standing anti-dashboard constraint (`APP-001`,
`APP-002`, `EVAL-002`).

## Acceptance criteria

- [ ] `collector/` exists, deployable independently of an owner's node, with
      its own tests proving the server-side allowlist actually rejects an
      attribute or event name outside it rather than forwarding it.
- [ ] The desktop funnel (`APP-058`) and QA node traces (`MON-021`) can both
      reach this collector; an owner's own deployed node never does.
- [ ] A record failing validation is dropped, not stored partially or
      logged with its rejected content.
- [ ] No dashboard or chart ships alongside this — Analytics Engine's SQL
      API is the query surface.

## Notes

**2026-09-07:** Filed alongside `XC-030`, `MON-020`, `MON-021`, and `CLI-004`.
Blocks `APP-058` and `MON-021`, since neither has anywhere to send data
without this.
