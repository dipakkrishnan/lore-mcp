---
id: XC-092
title: Turn on IP discard, filter test installs, and build the launch dashboard in PostHog
priority: P1
effort: XS
component: cross-cutting
status: ideation
related: [APP-250, XC-090, XC-091, APP-058]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-28
updated: 2026-10-28
---

## Problem

Project 373501 still has `anonymize_ips: false`. `$ip:null` is ignored, so every event carries
the relay Worker's Cloudflare egress IP and a fake "US" geo. The relay probe (`0.0.0-relaycheck`),
sandbox homes, and the owner's machine count as installs. There is no saved dashboard.

## Proposed approach

These are owner actions:
- Turn on "Discard client IP data".
- Add `app_version` not matching `0.0.0-*` plus the owner install to the test-account filter.
- Have harnesses run with telemetry off.
- Create the "Lore launch" dashboard from the spec in the Oct 28 metrics audit: funnel, store
  outcomes, failure reasons, WAU, new installs, D1/D7 retention, versions, connectors, agents,
  and site → app.

## Acceptance criteria

- [ ] New events carry no `$ip` or geo properties.
- [ ] The dashboard exists, with test accounts filtered by default.
- [ ] The edge.sh and walk harnesses send nothing to the real relay.

## Notes

From the Oct 27 launch feedback; see `docs/launch-feedback-2026-10-27.md`.
