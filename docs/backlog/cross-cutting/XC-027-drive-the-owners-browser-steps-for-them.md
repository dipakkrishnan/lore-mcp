---
id: XC-027
title: Drive the owner's browser steps for them
priority: P3
effort: L
component: cross-cutting
status: in-review
related: [APP-056, XC-026, XC-024, APP-008]
blockers: []
dependencies: ["A browser-use surface the desktop can drive with the owner watching (Claude in Chrome, Playwright over the owner's browser, or similar)"]
github_issue: null
created: 2026-09-05
updated: 2026-09-12
---

## Problem

Opening a store still hands the owner four web pages to operate alone: the
wallet, Cloudflare sign-in, the faucet, and the explorer. Each hand-off is a
card with instructions the owner has to follow in another window, and every
one of them is a place a first-time owner can stall (dogfood 2026-09-05: the
faucet card needed a sidebar path the owner had to discover).

## Proposed approach

Unclear, needs investigation. The shape Dipak has in mind is browser use:
Lore drives the page in the owner's browser while they watch, and stops for
the steps that must stay theirs (signing in, approving a wallet action). The
open_url card would become "Lore is doing this, watch or take over".

## Acceptance criteria

- [ ] An owner can fund the test buyer without reading instructions: Lore navigates the faucet and the owner only signs in.

## Notes

Raised by Dipak during the Sep 5 store-open pass. Sits behind the APP-008
sandbox question: a browser Lore drives is a much larger surface than a URL
it opens.
