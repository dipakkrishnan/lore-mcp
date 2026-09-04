---
id: APP-073
title: Keep a dogfood sandbox off the owner's live node
priority: P1
effort: S
component: desktop-app
status: in-review
related: [APP-038, MON-019, XC-018]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-04
updated: 2026-09-04
---

## Problem

`dogfood:new` isolates the library and app data but keeps the real
`$HOME`, so wrangler's login is shared, and the Worker name (`lore`) and
D1 name are fixed. Opening the store from the sandbox on 2026-09-04 deployed
over the owner's production Worker, re-set its wallet secret, and the
sandbox's later Push replaced the eleven live publications with the
sandbox's two. Nothing warned.

## Proposed approach

Point wrangler's config at the sandbox (`XDG_CONFIG_HOME` or
`WRANGLER_HOME` under the dogfood root) so a sandbox starts signed out and
the Cloudflare card asks for an account. Print the hazard in the script's
banner. Longer term (XC-018) a per-profile Worker name removes the collision
entirely.

## Acceptance criteria

- [ ] A fresh sandbox is not signed in to Cloudflare and cannot see the
      owner's Worker.
- [ ] The script banner says which Cloudflare account a store deploy will use.

## Notes

Recovery for the incident: `lore push` from the real profile restores the
active set.
