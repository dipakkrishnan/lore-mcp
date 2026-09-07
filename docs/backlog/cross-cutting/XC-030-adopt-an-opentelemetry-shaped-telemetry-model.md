---
id: XC-030
title: Adopt an OpenTelemetry-shaped telemetry model and restate the privacy contract
priority: P1
effort: S
component: cross-cutting
status: in-review
related: [MON-020, MON-021, XC-029, CLI-004, APP-058]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-07
updated: 2026-09-07
---

## Problem

Lore has no instrumentation anywhere: no metrics, traces, logs, error
reporting, or analytics. `APP-058` already proposes a desktop milestone
funnel, but nothing ties it to a shared privacy vocabulary, a data model, or
a stance for `PRIVACY.md`, which currently makes an absolute no-telemetry
claim that a milestone funnel would contradict if shipped without a rewrite.
Every future telemetry item needs a document to point at instead of
re-deriving the metric tree and the privacy rules each time.

## Proposed approach

Write `docs/telemetry.md`: a metric tree that works top-down from the
questions worth answering (does an install reach a first sale? is a deployed
node serving?) to the events and spans that answer them, plus a bottom-up
account of how each plane collects and moves data. Standardize on
OpenTelemetry's data model and wire format everywhere data leaves a process
— Cloudflare Workers' native `tracing`/`observability` support for the node
plane, OTLP/HTTP+JSON for the desktop plane — without adding an SDK
dependency neither runtime needs. State the nine privacy rules once
(coded values only, no content, no money or identity links, no shape
disclosures, and so on) so every other telemetry item cites them instead of
restating them.

Rewrite `PRIVACY.md` for the actual shipped stance: opt-out (on by default)
for the desktop milestone funnel, disclosed plainly, with an off switch; a
deployed node's own observability stays in the owner's own Cloudflare
account and is not "Lore telemetry" in the sense the rest of the document
discusses.

## Acceptance criteria

- [x] `docs/telemetry.md` exists with the metric tree, the event/span
      catalog, the privacy rules, and which plane reaches which sink.
- [x] `PRIVACY.md` states the desktop funnel is on by default with a
      disclosure and an off switch, and separately describes a deployed
      node's own owner-controlled observability.
- [ ] `APP-058` is updated to point at `docs/telemetry.md` and to block on
      the items that implement its collector and its off switch.

## Notes

**2026-09-07:** Filed alongside `MON-020` (this branch's implemented slice),
`MON-021`, `XC-029`, and `CLI-004`, and an edit to `APP-058`. The opt-out
stance for the desktop funnel was a deliberate call, not a default: it trades
some of the absolute claim `PRIVACY.md` used to make for representative alpha
data, on the condition that the disclosure and off switch actually ship in
the same wave (`XC-029`, `CLI-004`) before `APP-058` sends anything.
