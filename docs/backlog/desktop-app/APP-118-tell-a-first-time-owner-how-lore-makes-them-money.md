---
id: APP-118
title: Tell a first-time owner how Lore makes them money
priority: P1
effort: S
component: desktop-app
status: in-review
related: [APP-092, XC-025, APP-094, APP-117, MON-025]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-14
updated: 2026-09-14
---

## Problem

Nothing in the app says who the buyers are or how a sale happens. The tab
hovers (`APP-092`) explain Memories and For Sale, the privacy row explains
storage, and the deploy thread speaks in outcomes (`XC-025`), but a
newcomer never reads the sentence "other people's AI agents pay to read
what you approved". Zane: "some sort of Lore explainer or more guidance on
how I make money through this / who are buyers, etc would help me feel more
like I'm going to make money. Like if I knew nothing about this going in
idk if I'd get it."

## Proposed approach

Three sentences in the app's own voice, shown twice: once after first
sign-in, before setup starts, and again as the top of the For Sale empty
state until the first sale. Who buys (people's AI agents, while working on
a task, not people browsing), what they pay (cents to read a publication,
dollars for an answer), and what the owner keeps (all of it, paid straight
to their own wallet, nothing held by Lore). Tasteful inline notice, the
Claude and OpenAI console register, no hype and no projected earnings. A
"How selling works" link in Settings opens the same text with one worked
example: a real sale from the ledger, the cent it paid, and the receipt.
The same three sentences belong on yourlore.dev.

## Acceptance criteria

- [ ] A fresh sign-in shows the explainer before the first setup question,
      and it can be dismissed in one click.
- [ ] For Sale with no sales carries the same text at the top.
- [ ] The copy names buyers as agents, the two prices, and non-custody, in
      plain words, and cites no earnings figure the ledger cannot show.

## Notes

Zane also suggested making it "seem (like even if over exaggerated a little)
that people can make a solid amount of money" so sellers keep adding supply.
Declined as copy: the buyer thesis has kill criteria and the owner's
preference on record is no hype. The retention lever is the mechanism shown
honestly plus the examples in `APP-117`.
