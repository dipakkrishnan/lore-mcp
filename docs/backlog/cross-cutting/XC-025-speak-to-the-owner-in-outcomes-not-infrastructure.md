---
id: XC-025
title: Speak to the owner in outcomes, not infrastructure
priority: P1
effort: S
component: cross-cutting
status: in-review
related: [APP-055, XC-024, XC-015]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-04
updated: 2026-09-04
---

## Problem

The app's own copy already says "your store", "play money", "real money".
The skills' prose does not: the deploy thread told a first-time owner "Your
payout address and test price are set, and Cloudflare plus Node are ready.
I'm deploying on Base Sepolia, the test network", and onboarding opened with
"37 imported memories across Lore, agent systems, Deep Review…". A
non-technical owner meets three products they never chose. Editing one line
does not hold, because the model writes a new variant every run.

## Proposed approach

A voice rule in the desktop preamble of `lore-enable-payments` and
`lore-onboard`, spanning `plugins/lore/skills` and the desktop app's
vocabulary:

- Say what the owner will see: "Opening your store now with play money, so
  nothing real changes hands until you say so."
- Never name the plumbing in prose. Cloudflare, Node, wrangler, Worker, Base,
  Sepolia and network ids stay inside cards and Settings, where they are
  labeled.
- Do not narrate checks that passed; say what happens next.

Add the rule to the skill contract test so a rewording cannot drop it.

## Acceptance criteria

- [ ] A deploy thread in the desktop app contains none of: Cloudflare, Node,
      wrangler, Worker, Sepolia, eip155, outside a card or Settings.
- [ ] The contract test pins the rule for both skills.

## Notes

The owner's preference on record: plain labels, no "mainnet", tasteful
inline notices like the Claude and OpenAI consoles.
