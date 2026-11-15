---
id: XC-025
title: Speak to the owner in outcomes, not infrastructure
priority: P3
effort: XS
component: cross-cutting
status: in-review
related: [APP-055, XC-024, XC-015]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-04
updated: 2026-11-13
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

One place, not three. Extend the desktop system prompt's existing sentence
("Never mention tools, commands, or files to the owner…") with the plumbing
nouns: Cloudflare, Node, wrangler, Worker, Base, Sepolia, network ids, and the
rule to say what the owner will see instead ("your store", "play money",
"real money"). Delete the lines in the payments skill's desktop paragraph that
push jargon into prose, such as naming Base Sepolia. No second policy in the
skills and no contract test for it.

## Acceptance criteria

- [ ] A deploy thread in the desktop app contains none of: Cloudflare, Node,
      wrangler, Worker, Sepolia, eip155, outside a card or Settings.
- [ ] ~~The contract test pins the rule for both skills.~~ Struck: dropped on
      purpose (0cbf4ac). The desktop system prompt owns owner-facing voice, and a
      copy pin would drift, as this item's own 2026-09-04 review says.

## Notes

The owner's preference on record: plain labels, no "mainnet", tasteful
inline notices like the Claude and OpenAI consoles.
Reviewed 2026-09-04: a rule in two skills plus a test would drift; the system prompt already owns owner-facing voice.

**Review 2026-10-19:** not completed. Partial. Shipped in 8f4b62e (agent prompt bans infra words; payments wallet step reworded). The contract-test criterion was deliberately dropped (0cbf4ac note). The no-infra-words-in-a-deploy-thread check needs a manual desktop run.

**Prioritization (2026-11-12):** Priority P3 (was P1), effort XS (was S).
Stays in-review. Before it can be ready: One manual desktop deploy-thread
run confirming none of the banned words appear (the rule is in agent.mjs),
then close. Prioritization flag (not acted on): done (code).

**Close-out (2026-11-13):** Stays in-review; only a live check is left. The rule
is in code. `app/desktop/src/agent.mjs` (around line 590) says "Never mention
tools, commands, files, or plumbing to the owner: no Cloudflare, Node, wrangler,
Worker, Base, Sepolia, network ids..." (8f4b62e). The payments skill's desktop
paragraph says "Say 'real money', never 'mainnet', and never name Base,
Sepolia...". Criterion 2 is struck. Criterion 1 needs one manual desktop deploy
thread whose prose has none of the banned words outside a card or Settings.
After that, close.
