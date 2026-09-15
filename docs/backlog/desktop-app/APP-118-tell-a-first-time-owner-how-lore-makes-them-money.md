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
updated: 2026-09-15
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

- [x] A fresh sign-in shows the explainer before the first setup question,
      and it can be dismissed in one click.
- [x] For Sale with no sales carries the same text at the top.
- [x] The copy names buyers as agents, the two prices, and non-custody, in
      plain words, and cites no earnings figure the ledger cannot show.

## Notes

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

Built 2026-09-15 as three placements in the app's existing patterns, after
a look at how Linear, Notion, Stripe, Substack, Skyfire, and Vercel explain
themselves: the explanation is structure the owner already touches, never
an FAQ, a tour, or a modal.

- **Sign-in screen:** one sentence under the tagline, the "what does this
  do" beat. "Lore keeps what you learn on this Mac. Other people's AI agents
  pay to read what you choose to sell."
- **Today:** a "How selling works" section above Needs you, three rows in
  the row style (Keep, Approve, Earn) and one fork row ("Buying instead?"
  with a link to yourlore.dev). "Got it" hides it; it also stops once the
  ledger shows a sale. The dismissal is remembered per Mac in the
  renderer's local storage, wrapped so a missing store only means the card
  returns next launch.
- **Settings:** the same rows as a permanent section, plus "Your first
  sale" from the ledger once there is one, with its price and receipt.

AC #2 is met by one sentence, not the full text: the For Sale empty state
now reads "Nothing for sale yet. Approve a draft and buyers' agents can pay
to read it.", and the Sales empty state already says who pays. Repeating
the three rows on For Sale would have put the same card on two tabs.

Also here, from Dipak's ask to feel the marketplace flow: once the store is
live with something on it, "List on the marketplace" is a Needs you rung on
Today, sitting with the redeploy and push rows so it shows whatever setup
rung the owner is on. The Settings row (`APP-119`) is unchanged.

Edge scenarios `fresh` (nine new checks, one screenshot) and `listing`
(three new checks) drive it in a real window. The `seller` scenario's
"keyboard focus shows the same card" check fails on main as well as here.
