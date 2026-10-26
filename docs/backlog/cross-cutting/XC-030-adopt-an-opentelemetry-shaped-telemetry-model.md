---
id: XC-030
title: Adopt an OpenTelemetry-shaped telemetry model and restate the privacy contract
priority: P1
effort: S
component: cross-cutting
status: completed
related: [MON-020, MON-021, XC-029, CLI-004, APP-058]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-07
updated: 2026-10-25
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

Keep `PRIVACY.md` accurate for this release: desktop telemetry is not
implemented, and deployed-node observability stays in the owner's Cloudflare
account. The proposed opt-out desktop funnel belongs in `docs/telemetry.md`
until its collector, disclosure, and controls ship together.

## Acceptance criteria

- [x] `docs/telemetry.md` exists with the metric tree, the event/span
      catalog, the privacy rules, and which plane reaches which sink.
- [x] `PRIVACY.md` distinguishes shipped node observability from the
      proposed desktop funnel and its unimplemented controls.
- [x] `APP-058` is updated to point at `docs/telemetry.md` and to block on
      the items that implement its collector and its off switch.

## Notes

**2026-09-07:** Filed alongside `MON-020` (this branch's implemented slice),
`MON-021`, `XC-029`, and `CLI-004`, and an edit to `APP-058`. The opt-out
stance for the desktop funnel was a deliberate call, not a default: it trades
some of the absolute claim `PRIVACY.md` used to make for representative alpha
data, on the condition that the disclosure and off switch actually ship in
the same wave (`XC-029`, `CLI-004`) before `APP-058` sends anything.

**Prioritization 2026-10-19 (corrected in review):** stays `ready`, but only for the
last criterion. `docs/telemetry.md` already exists on main and the first two criteria
are checked; what remains is pointing `APP-058` at it and making `APP-058` block on
its collector and off-switch items. Do not rewrite the doc from the Problem text.

**2026-10-25:** Completed with no further change to `APP-058`. The last
criterion has held since 3ac3cc6 (#255, 2026-09-08), the commit that filed
this item: it added `APP-058`'s sentence naming `docs/telemetry.md` (`XC-030`)
as the metric tree and privacy vocabulary its events draw from, and set
`APP-058`'s `blockers: [XC-029, CLI-004]` (the collector and the off switch).
The box was never ticked, and the 2026-10-19 note above read it as open work.

The second criterion's wording has aged: `APP-058` (#428) and `CLI-004` have
since shipped the desktop usage events and their off switch, and `PRIVACY.md`
now describes them as shipped rather than proposed. Its box stays checked
because `PRIVACY.md` is accurate about what ships. Whether `XC-029` should
still block `APP-058` — `docs/telemetry.md` says the relay supersedes it for
the desktop plane — and the stale backlog table in `docs/telemetry.md` are
left to prioritization and `APP-058`; #432 records that drift in this file.
