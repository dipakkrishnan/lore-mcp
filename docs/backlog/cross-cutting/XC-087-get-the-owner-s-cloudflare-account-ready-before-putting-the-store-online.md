---
id: XC-087
title: Get the owner's Cloudflare account ready before putting the store online
priority: P0
effort: S
component: cross-cutting
status: ideation
related: [XC-085, XC-086, APP-249, XC-069, APP-224]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-28
updated: 2026-10-28
---

## Problem

A Cloudflare account that has never used Workers has no workers.dev subdomain. The
bundled wrangler asks whether to register one; Lore runs it with stdin closed, so it
declines and the deploy refuses before uploading, every time (wrangler-dist
`getWorkersDevSubdomain`, `fallbackValue: false`). Accounts with several memberships
fail the same way ("More than one account available… non-interactive mode").

## Proposed approach

Before `d1 create`, use `wrangler auth token` + the Cloudflare API:
- `GET /accounts`: one → use it; several → plain account picker card; set
  `CLOUDFLARE_ACCOUNT_ID` for every later wrangler call.
- `GET /accounts/{id}/workers/subdomain`: 10007 → `PUT` one derived from the owner's
  name + "-lore", suffixing on 10031; never ask the owner to name it.
- email_verification_required → verify-email state (ticket 4 polls it).
Skip `npm install` when `.installed` and the lockfile hash are unchanged.

## Acceptance criteria

- [ ] A verified account with no subdomain goes online from one tap, with no browser step beyond sign-in.
- [ ] An account with two memberships asks which one, once, and remembers it.
- [ ] Verified on a throwaway Cloudflare account in a sandboxed HOME/WRANGLER_HOME/LORE_HOME — never the real login.
- [ ] A second tap after a failure doesn't reinstall packages.

## Notes

Never run against the owner's real wrangler login (Oct 19 store wipe).

From the Oct 27 launch feedback; see `docs/launch-feedback-2026-10-27.md`.
