---
id: MON-024
title: Let the owner trial their own answer tier for free
priority: P2
effort: M
component: monetization
status: ideation
related: [MCP-003, MON-017, APP-035]
blockers: [MON-017]
dependencies: []
github_issue: null
created: 2026-09-09
updated: 2026-09-11
---

## Problem

The owner has no way to judge their proxy charter's voice before it goes live.
The paid `answer` tool only exists once `answer_enabled` is pushed, so a
test-funds purchase can only happen *after* the tier is already exposed to real
buyers — it cannot inform the decision to enable. `./lore-test.sh` runs the real
Pi path locally, but needs a git checkout and a provider key in the shell, so a
packaged Desktop build cannot use it.

## Proposed approach

A second, unpaid door into the same answer agent, gated by a credential Lore
mints and vaults itself rather than by payment. A first implementation of that
shape was written and pulled back (see Notes); anything picked up here has to
answer the three problems that pulled it:

1. **Schema.** `ensureAnswerSchema` runs in the Durable Object's `init()`, which
   a plain `fetch` route never reaches. A cold node 500s with
   `no such table: answer_jobs` on the first trial. The route has to ensure its
   own schema, and the test must not pre-create it and hide that.
2. **Execution window.** `ctx.waitUntil` is capped around 30s after the response
   on an HTTP-triggered Worker; `DEADLINE_MS` is 180s. The paid path avoids this
   by going through `schedule` → `runAnswerTicket` on the Durable Object, and
   the owner ticket needs the same road, not a bare `waitUntil`.
3. **What it can preview.** The node answers from whatever charter is in D1, so
   before a push it runs the *old* charter, or an empty one for a first-time
   owner. That is the opposite of the point. Either the route takes the draft
   charter in the request body, or the trial belongs after `lore push` and the
   flow says so.

Also worth settling before building: a rate limit (the route is free and
spends the owner's provider budget), and whether the credential is worth its
own secret at all versus reusing something already vaulted.

## Acceptance criteria

- [ ] A trial answers from the charter the owner is about to approve, not
      only from what is already pushed.
- [ ] A cold node — freshly deployed, no MCP session yet — serves a trial
      without a schema error, proven by a test that does not pre-create the
      tables.
- [ ] A trial that takes the full agent deadline finishes; the run is not cut
      short by the platform's post-response execution cap.
- [ ] A trial never creates a `sales` row and never charges the buyer path.
- [ ] The route refuses cleanly when `providerReadiness` (`MON-017`) says the
      model is not ready, and when the tier has no approved charter at all.
- [ ] Free calls are bounded — an agent loop cannot spend the owner's provider
      budget unattended.

## Notes

Split out of `APP-035` during its design; a test-funds purchase was rejected as
the trial mechanism because the paid tool does not exist until the tier is
already enabled.

**An implementation was written and then removed from `APP-035`'s PR
(2026-09-11)** rather than shipped: `POST /owner/answer` with a
`LORE_OWNER_TOKEN` bearer secret minted per deploy, an `origin` column on
`answer_jobs`, `lore answer try`, and a `try_answer` Desktop tool. Review found
all three problems listed above, which are structural rather than polish — the
route as built could 500 on a cold node, be killed mid-run by the platform, and
could not preview the thing it existed to preview. Moved back to `ideation` so
the next pass starts from the design questions rather than from that code.

Until this lands, the honest answer for an owner asking "what will it sound
like?" is to enable on the test network and buy one answer from their own node,
or to read the charter. `plugins/lore/skills/lore-enable-payments/SKILL.md`
says exactly that.
