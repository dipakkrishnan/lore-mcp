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
updated: 2026-10-10
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
- [ ] `APP-058` is updated to point at `docs/telemetry.md` and to block on
      the items that implement its collector and its off switch.

## Notes

**2026-09-07:** Filed alongside `MON-020` (this branch's implemented slice),
`MON-021`, `XC-029`, and `CLI-004`, and an edit to `APP-058`. The opt-out
stance for the desktop funnel was a deliberate call, not a default: it trades
some of the absolute claim `PRIVACY.md` used to make for representative alpha
data, on the condition that the disclosure and off switch actually ship in
the same wave (`XC-029`, `CLI-004`) before `APP-058` sends anything.

**2026-10-10:** `docs/telemetry.md` has drifted from the event list that
shipped in `contracts/usage_events.json` (`APP-058`, #428). Noticed while
filing `XC-060`..`XC-062`; recorded here because this item owns the document.
Nothing was changed.

- The funnel row names `setup.completed`, `publication.approved` and
  `sale.viewed`. None is in the contract; the shipped names are
  `piece.approved` and `sale.seen`, and there is no setup event. Whether
  setup needs an event is `APP-058`'s call: its first criterion asks how
  many installs reach setup.
- `source.connected` and `store.listed` are sent and appear in no row,
  against the doc's rule that an event needs a question in that table first.
- The failure row says `cli.failed` carries "a coded command + outcome".
  It carries the command only, as the same doc says further down.
- The scope table still sends QA traces to "the same maintainer collector"
  although the desktop row above it now goes to the relay, and the closing
  paragraph still calls Workers Analytics Engine the maintainers' surface.
- The backlog table says `APP-058` is "in-review, blocked on `XC-029` and
  `CLI-004`". `APP-058` is `in-progress`, `CLI-004` is `completed`, and the
  doc says `XC-029` is superseded for the desktop plane.

For prioritization: `XC-029` is still `ready` at `P1` and still a blocker
of `APP-058`, and `XC-031` still says `RELAY_URL` is `None` while
`lore/feedback.py` pins it.
