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

In the dogfood script, set `XDG_CONFIG_HOME` to a directory under the sandbox
`LORE_HOME`. Wrangler resolves its login from `$XDG_CONFIG_HOME/.wrangler`
(this Mac has no legacy `~/.wrangler`), and the agent's bash sandbox can
already write under the Lore home, so a fresh sandbox starts signed out and
the Cloudflare card asks for an account. Print which account a deploy will
use in the banner.

## Acceptance criteria

- [ ] A fresh sandbox is not signed in to Cloudflare and cannot see the
      owner's Worker.
- [ ] The script banner says which Cloudflare account a store deploy will use.

## Notes

Recovery for the incident: `lore push` from the real profile restores the
active set.
Reviewed 2026-09-04: the config directory must live inside LORE_HOME, or the sandboxed shell cannot write wrangler's login.
