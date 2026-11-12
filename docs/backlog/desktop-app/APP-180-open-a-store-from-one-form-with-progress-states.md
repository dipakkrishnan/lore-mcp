---
id: APP-180
title: Open a store from one form with progress states, not an agent chat
priority: P1
effort: M
component: desktop-app
status: in-review
related: [APP-136, APP-057, APP-056]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-11-12
---

## Problem

"Open your store" starts an agent conversation (`startDeploy` in
`app/desktop/src/renderer.js`, ~line 2138, driven by the desktop section of the
`lore-enable-payments` skill). A new seller has to read and answer chat turns
to fill in what is really a form: price, how to get paid, then go. The chat
also doesn't show how far along the deploy is.

## Proposed approach

- One card with the price, the By card / wallet choice and an Open button.
- After Open, the card shows named steps (Preparing, Uploading pieces, Checking
  the store is live, Open), each with a plain failure line and Try again.
- Keep the agent route for owners who type "open my store", and trim the
  skill's desktop section to point at the card.

## Acceptance criteria

- [ ] Every "Open your store" button opens the card, not a chat thread
- [ ] The card shows each step and ends on the store address with Open ↗
- [ ] A failed step says what failed and offers Try again

## Notes

Filed from the 2026-10-06 new-seller audit (renderer.js ~2020/2652 are the
other entry points). Pairs with XC-059: for a card-only seller the card should
need nothing beyond the price.

**Delivery loop plan review (2026-11-12):** Moved back from `ready` to
`in-review`. Three implementation plans were written and each was
rejected by a plan reviewer that checked it against the code; the open
issues did not shrink between rounds, which suggests the item is
under-scoped as written. The reviewer's last open issues are below.
Labels such as "Test 2" or "R3" refer to that rejected plan, which
was not kept; the facts about the code stand on their own.

- store:open's result isn't defined for outcomes that are neither a deploy
  nor a deploy failure. openStore (state.cjs:394-440) returns plain strings
  for several of these: the owner cancelling the Outgoing.confirm sheet
  ('The owner chose not to change the store right now.'), 'Card payments
  aren't on yet, so the store did not open.', an invalid address, and a bad
  network. The plan says store:open resolves {ok, said, step, reason}, but
  it never says how ok, step and reason come out of openStore's string
  return. Its onStep plumbing only covers deployStore. As written, a Cancel
  on the confirm sheet will most likely land as a failed Preparing row with
  Try again. That breaks AC3's 'a failed step says what failed', because
  nothing failed. The plan should say how store:open classifies these
  returns and what the panel shows for each. A cancel should return the
  panel to its form, and a card or address refusal should show the line
  without a step failure.
- The underWay('deploy') change sends the agent-route actions into an empty
  chat. resume(kind, start) (renderer.js:961-963) holds back by calling
  openTask(kind). If underWay('deploy') returns true during a panel run,
  then clicking Fix it (936) or Update store (942) during that run opens a
  'deploy' chat thread with no agent work behind it, not the panel. The plan
  says these actions 'hold back' but routes only the nextStep 'Open your
  store' card to the panel. It should send every resume('deploy', ...) to
  openStoreCard() while storeRun is active, or keep storeRun out of underWay
  and gate those actions some other way. A test should cover Fix it or
  Update store clicked during a panel run.
- The preflight `lore node accounts --json` can fail for reasons other than
  not_signed_in: a Cloudflare API or network error, a failed staging or
  dependency install in _staged(), or a CLI too old to have the command. The
  plan defines only the not_signed_in result. It should say that any other
  preflight error shows as a failed Preparing row with its plain line and
  Try again, and a test should pin this. Otherwise the sign-in check alone
  can stop a store from opening with no error shown.
- The plan names code that doesn't exist. There is no 'byCardFlow' near
  renderer.js 5684. The Stripe wait is cardsFirst(box, go, then)
  (renderer.js ~5686), and it finds the radio through
  box.querySelector('.payout input[value="By card"]:checked') on a form. To
  reuse it, the panel's payout choice must be built with payoutField()
  inside a form element, or cardsFirst must change. The plan should say
  which.
- The Try-again and reopen paths can hit a stale deploy thread. Deploy job
  rows go to openTask('deploy') whenever taskItems holds any 'deploy'
  record, including one left from an older agent-route deploy. So the row
  for a run that failed in the panel can open that old chat instead of the
  panel that shows the failure and Try again. Route by whether the panel's
  storeRun owns the recent run, or prefer the panel when storeRun has a
  failed state, and add a test for a stale deploy record plus a panel
  failure.
- The file list leaves out renderer-store-update.test.cjs, but RISKS says
  its expectations move. It also lists tests/test_skill_contract.py as
  touched although the plan changes nothing in it. Make the two lists agree
  so the PR updates the right tests.
