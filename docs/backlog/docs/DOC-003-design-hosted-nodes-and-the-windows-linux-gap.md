---
id: DOC-003
title: Design hosted nodes and list the Windows/Linux gap
priority: P1
effort: S
component: docs
status: in-review
related: [MON-025, MON-029, MON-034, XC-036, XC-041, APP-040]
blockers: []
dependencies: []
github_issue: 369
created: 2026-10-04
updated: 2026-10-04
---

## Problem

Seeding Lore means 10–20 sellers in one niche, most of them not developers.
Each one today needs a Mac, a Cloudflare account, a Worker deploy run from
the app, a D1 database and a payout address. Issue #369 asks for a short
design doc before any build: whether Lore should host nodes, what it would
cost, whether it keeps Lore out of the money, and what blocks the app on
Windows and Linux.

## Proposed approach

Write `docs/hosted-nodes.md`: the problem in a few lines, the options in
one table with onboarding steps removed, Lore's monthly cost at 20 and
1000 sellers from Cloudflare's current prices, custody and effort; a
recommendation with a minimal first slice and estimate; the concrete
Mac-only surface in `app/desktop` and `lore/`; open questions; follow-up
issue titles.

## Acceptance criteria

- [x] `docs/hosted-nodes.md` compares today's per-seller Worker, a shared
      multi-tenant Worker, Workers for Platforms and one-click self-deploy
      with cost per seller at 20 and 1000 sellers from current Cloudflare
      pricing.
- [x] Each option states plainly whether Lore ever holds money.
- [x] A clear recommendation with a minimal first slice and a rough
      estimate.
- [x] The Windows/Linux blockers in `app/desktop` are listed by file.
- [x] Open questions and follow-up issue titles are listed.

## Notes

Written 2026-10-04. Recommends the shared Worker on Lore's account ($5/mo
flat at seeding scale, about a cent per seller per month at 1000), keeps
the per-seller Worker as the self-hosted path and migration target, and
rejects Workers for Platforms as paying for isolation the identical tenant
code does not need. Follow-up issues are not filed yet; the doc lists their
titles.
