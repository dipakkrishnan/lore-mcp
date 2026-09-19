---
id: APP-118
title: Tell a first-time owner how Lore makes them money
priority: P1
effort: S
component: desktop-app
status: completed
related: [APP-092, XC-025, APP-094, APP-117, MON-025, ONB-007]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-14
updated: 2026-09-19
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

An explicit FAQ tab in the sidebar, for now. One page of questions and
answers in the app's own voice, seller-first, in the order Zane gave: what
Lore does; who buys (people's AI agents, while working on a task, not
people browsing); how a sale happens and what it pays (cents to read a
publication, dollars for an answer); what the owner keeps (all of it, paid
straight to their own wallet, nothing held by Lore); what never leaves the
Mac. Plain words, the Claude and OpenAI console register, no hype and no
projected earnings. The buyer fork is one question near the end that
points a builder at the buyer docs. The same answers belong on
yourlore.dev.

Not the woven version: #294 spread the explanation over the sign-in
subline, a Today section, a Settings section and the marketplace rung, and
was closed on 2026-09-18. One place is easier to read once and easier to
edit as the buyer story changes.

## Acceptance criteria

- [x] A FAQ entry in the sidebar opens a page of questions and answers; no
      explainer copy is added to sign-in, Today or Settings.
- [x] The answers name buyers as agents, the two prices, and non-custody,
      in plain words, and cite no earnings figure the ledger cannot show.
- [x] The edge harness renders the tab and checks the jargon list against it.

## Notes

Built 2026-09-19 as a FAQ tab between Connectors and Settings: eleven
questions in four sections (What Lore does; How you make money; What stays
private; If you build agents), rendered with the same row cards as the rest
of the app. The price answer reads the owner's own price from the snapshot
once one is set. The `faq` edge scenario checks Zane's three asks by text
(who buys, what a buyer pays and the owner keeps, how the money arrives),
that the only dollar figure is a price, a jargon list, and that Today and
Settings gained no selling copy. The examples of what sells stay `APP-117`;
the FAQ's "What sells?" answer is the shape, not a list. yourlore.dev still
needs the same answers.

Zane also suggested making it "seem (like even if over exaggerated a little)
that people can make a solid amount of money" so sellers keep adding supply.
Declined as copy: the buyer thesis has kill criteria and the owner's
preference on record is no hype. The retention lever is the mechanism shown
honestly plus the examples in `APP-117`.

2026-09-14, later: Zane on the order. "It's first 'what does this do'. And
then once I know what it is, naturally I'm going to only want to lean in
more if I'm either building and want to buy people's context, or want to
sell my own." So the explainer is two beats, not one: what Lore does, then a
fork. A seller is guided to what to sell and what sells now (`APP-117`); a
builder is guided to what to buy and how to buy it (the bridge and the
connect command). The three sentences above are the seller beat; add the
one-line "what it does" first and the buyer branch after.
