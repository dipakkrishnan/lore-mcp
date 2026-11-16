---
id: XC-135
title: Run the live launch checks that code can't close
priority: P1
effort: M
component: cross-cutting
status: in-review
related: [MON-025, MON-047, MON-044, MON-007, APP-217, APP-250, APP-263, APP-019, APP-005, APP-038, APP-044, XC-090, XC-120]
blockers: []
dependencies: []
github_issue: null
created: 2026-11-15
updated: 2026-11-15
---

## Problem

Thirteen items stay in-review because of a check that only a person, live
money or a live account can run. For twelve of them nothing is left to build
(APP-005 also keeps one automated-test criterion), yet they crowd the in-review list, and no one place
says what has to happen before launch. Each check sits at the bottom of a
different item, so none of them gets scheduled.

## Proposed approach

Gather the checks here as one launch run. Each criterion below names the item
it came from and that item's open criterion. Once this item is filed, each
source item can strike its criterion as moved here and close as code-complete
(APP-005 only once its automated-test criterion is also met or moved).
Run them on real accounts, record each result (date, build, account or plan,
what was seen) in this item's Notes, and tick it.

Most need the owner's own Stripe, Cloudflare, Coinbase, PostHog or a fresh
macOS account. Several can share one run: the fresh-account install (APP-005),
the fresh-account deploy (APP-044) and the fresh-`LORE_HOME` event checks
(APP-250, XC-090) fit one session.

## Acceptance criteria

Money:
- [ ] MON-025 (criterion 5): a 1¢ purchase on a real-money node settles to a
      Coinbase account's USDC-on-Base deposit address and shows there.
- [ ] MON-047 (criterion 5): a new owner opens a store by card alone, and a
      card purchase on a piece page pays their Stripe account.
- [ ] MON-044 (criterion 5): a real buyer buys a collection.
- [ ] MON-007 (criteria 2-4): a Claude client with the buyer bridge runs
      `discover` → paid `get` against a live node through MCP tool calls; the
      settlement receipt shows in the conversation; the private key never
      appears in the context or transcript.
- [ ] APP-019 (criterion 6): on a live store, the owner changes the price,
      presses Update store, and `discover` reports the new amount.
- [ ] APP-005 (criterion 3, restated for real money): a bounded live run
      deploys a store, completes one paid buyer request, and the app shows
      the job and its cost.

Fresh accounts and sign-in:
- [ ] APP-005 (criterion 1): a clean macOS account installs and launches the
      packaged app with no separately prepared Python, Node or terminal.
- [ ] APP-044 (criterion 3): a deploy from that fresh macOS account completes
      without Node or npm on the owner's PATH.
- [ ] APP-038 (criterion 3): a person completes the provider sign-in click in
      `npm run dogfood:new`.
- [ ] APP-250 (criterion 1): a fresh `LORE_HOME`, launched and signed in, logs
      `app.installed`, `signin.completed` and `app.opened` in `usage.log`
      before the first-run chat ends.
- [ ] XC-090 (criterion 1): a fresh-home run through first run → connect
      agent → save → draft → approve logs each funnel event exactly once.

Agents and analytics:
- [ ] APP-217 (criterion 3): a memory is saved through the private link from
      Claude (Free plan) and from ChatGPT; the plans used are recorded.
- [ ] APP-263 (criterion 7): the live Instinct dogfood: secure key handoff,
      one approved save, receipt on the Mac, private item inspected,
      disconnect revokes.
- [ ] XC-120 (criteria 1-2): a known-User-Agent request to each live endpoint
      reaches PostHog with the right agent family and `$ip: null`, and the
      weekly "Agent demand" insight is saved.

## Notes

Filed 2026-11-15 from the in-review close-out. Each source item gets a note
pointing here; their statuses were not changed in this pass. The owner (or
the next close-out) strikes each moved criterion naming XC-135 and closes the
item.

Not moved here, because they are not live checks: APP-005's criterion 2 (an
automated temp-home test from first run to push), criterion 4 (signature and
notarization, already met by v0.1.25 per its audit note) and criterion 5 (a
constraint on the run). MON-025's criterion 6 (Zane's walk-through) is a
person's check too, but its item asks the owner to run or drop it, so it
stays there. APP-030's live Sepolia proof is the same kind of check and could
join here if the owner wants it restated for real money.
