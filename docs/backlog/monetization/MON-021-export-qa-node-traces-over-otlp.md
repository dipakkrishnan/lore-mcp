---
id: MON-021
title: Export QA node traces over OTLP and assert node health after each deploy
priority: P2
effort: S
component: monetization
status: ready
related: [MON-008, MON-020, XC-008, XC-029]
blockers: [XC-029]
dependencies: ["An OTLP destination for lore-qa configured in the maintainers' Cloudflare Workers Observability dashboard, pointed at the XC-029 collector — cannot be created from a tracked file"]
github_issue: null
created: 2026-09-07
updated: 2026-09-07
---

## Problem

`MON-020` enables traces and logs on `env.qa` in `wrangler.jsonc`, but they
stay inside `lore-qa`'s own Cloudflare account with no `destinations` entry
— nobody outside that account can see them, so `deploy-qa.yml`'s existing
smoke check is still the only signal that a QA deploy actually works, and
"did the last release regress request latency or error rate" has no answer
without opening the dashboard by hand.

## Proposed approach

Once `XC-029` stands up the collector Worker, configure an OTLP destination
in the maintainers' Cloudflare dashboard named for `lore-qa` and add it to
`env.qa`'s `observability.traces.destinations` /
`.logs.destinations` in `wrangler.jsonc`. Extend `XC-008`'s live testnet
suite (or `deploy-qa.yml`'s existing smoke step) to query the collector for
the QA node's most recent traces after a deploy and assert the deployed
version actually served a request with an `ok` outcome — the "is this
actually running the new code" gap `MON-011` names for the deploy step
itself, extended to post-deploy request evidence.

## Acceptance criteria

- [ ] `env.qa`'s traces and logs export to the maintainers' collector via a
      dashboard-configured OTLP destination; no destination or credential is
      ever a tracked file.
- [ ] After a QA deploy, an automated check confirms at least one recent
      trace from `lore-qa` with an `ok` outcome, not just that the Worker
      answered a smoke probe.
- [ ] The QA node's traces never mix with an owner node's — confirmed by the
      destination being configured only under `env.qa`, never the default
      env.

## Notes

**2026-09-07:** Filed alongside `XC-030`, `MON-020`, `XC-029`, and `CLI-004`.
Blocked on `XC-029` existing at all, and on dashboard access to create the
destination — the same blocker shape `MON-016` already describes for
`MON-008`'s secrets.
