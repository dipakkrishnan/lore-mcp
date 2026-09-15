---
id: ONB-007
title: Learn who the owner is from the public web before the first question
priority: P2
effort: M
component: onboarding
status: in-review
related: [ONB-004, CAP-003, APP-117, APP-118, APP-116]
blockers: []
dependencies: ["A web search the desktop agent can call; it has no web tool today"]
github_issue: null
created: 2026-09-14
updated: 2026-09-14
---

## Problem

Onboarding proposes a profile from agent history and, when there is none,
has nothing to go on but blank questions (`ONB-004`). Zane's read, Sep 14:
Lore should "be doing some level of web searching and profile building for
me without full creep mode. Like if it happened to search 'Zane Manaa' on
the back end quickly when I sign up or check my LI, and then when I'm making
my first context log it 'happens to recommend' Sales/GTM stuff. I'd be super
fine with that and honestly prefer it." The line he drew: do not auto-connect
personal sources; find them and ask.

## Proposed approach

One quiet search at sign-up, from the name the owner gives and any LinkedIn
URL they paste: a public search that yields role, company, domain, and any
public writing homes (a Substack, an X handle, a blog). Use it two ways, both
visible to the owner:

- Seed the interview. The role and domains become the proposed answers the
  owner corrects instead of blank questions, and the first capture's topic
  suggestion and the `APP-117` examples key off them.
- Offer connectors. "It looks like you write at <substack>. Want Lore to
  read it?" as one card per source found, opt-in, never connected on its own
  (`CAP-003`, `APP-116`).

Keep it shallow: one search on the name plus what the owner pasted, public
results only, no people-search sites, and the owner sees what was found on
the interview's first card ("Here is what I found; fix anything wrong").
Nothing found is stored beyond the profile the owner confirms.

## Acceptance criteria

- [ ] A new owner who gives a name sees a proposed role and domains on the
      first interview card, drawn from public results, and can correct them.
- [ ] Each public writing home found becomes an opt-in connect card; none
      connects without a yes.
- [ ] With nothing found, the interview falls back to `ONB-004`'s path with
      no error and no invented profile.
- [ ] The first capture's topic suggestion reflects the confirmed role.

## Notes

Dipak asked whether thorough web search would feel creepy; Zane's answer was
"some level ... without full creep mode", and both agreed connectors stay
opt-in. The desktop agent's tool list has no search tool, so the dependency
is real: either the provider's built-in web search or a small Lore-side
search call.
