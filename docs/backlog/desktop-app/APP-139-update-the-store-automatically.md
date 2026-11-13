---
id: APP-139
title: Update the store automatically instead of asking to Push or Redeploy
priority: P1
effort: M
component: desktop-app
status: in-review
related: [APP-136, APP-137, MON-004]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-11-12
---

## Problem

"Push" and "Redeploy" are two technical verbs for one idea: make my store
match what I approved. One For Sale screen can show both up to four times
(banner, store bar, section header, stale-price line), and Today repeats
them (`store--store-unpushed.png`).

## Proposed approach

After approve, take down, price or free-copies change, the app updates the
store on its own (push, or redeploy when baked-in values changed), showing a
quiet "Updating your store… ✓" and a plain retry on failure. If an update
can't be automatic, fall back to one "Publish changes (N)" button with a
popover listing exactly what changes. Inspiration: Stripe's unpublished
changes bar, Framer/Webflow Publish.

## Acceptance criteria

- [ ] No seller-facing "Push" or "Redeploy" wording remains.
- [ ] Each owner change reaches the store without a separate click, or via one Publish changes button.
- [ ] A failed update says so plainly with one retry.

## Notes

**Delivery loop plan review (2026-11-12):** Moved back from `ready` to
`in-review`. Three implementation plans were written and each was
rejected by a plan reviewer that checked it against the code; the open
issues did not shrink between rounds, which suggests the item is
under-scoped as written. The reviewer's last open issues are below.
Labels such as "Test 2" or "R3" refer to that rejected plan, which
was not kept; the facts about the code stand on their own.

- Take-down feedback and test 4 rest on a wrong assumption. The plan says
  the owner 'sees the Updating… state and the receipt like every other
  change', and test 4 asserts 'the receipt shows'. But pushReceipt is only
  drawn by drafts() (renderer 1134, a drafting thread or the Drafts view)
  and by Settings (4728). Take-down runs from InventoryView.takeDown (2639)
  on Inventory, and show() clears pushedNote on every view change (5121). So
  a successful take-down on Inventory shows no receipt and no Updating…
  state, and test 4 cannot pass as written. The same applies to test 8's
  price-save auto-push when the price sheet is opened from Inventory's 'Set
  price…'. The plan needs to say where the receipt shows on Inventory, or
  change the claim and the tests.
- pushFailed can get stuck. Only pushNow and approveAllExtras clear it, but
  a store can also be brought up to date by an agent deploy: REDEPLOY_PRICE
  'Update store', 'Fix it' (STORE_FIX) or Open your store. After a
  successful deploy, 'Lore couldn't update your store' stays. A failure can
  also become moot, for example when the store is no longer selling and
  latest is false. Then Outgoing.push returns false (state.cjs 354), and
  under the plan's 'pushed false leaves pushFailed as is' rule the retry can
  never clear it. Because nextStep checks the failure before everything else
  and the Today step has no ×, Today stays stuck on the failure and hides
  'Open your store', drafts and the other steps. Clear pushFailed when a
  deploy succeeds and when nothing is left to push, or document why that
  can't happen, and add a test for it.
- One rationale for Approve all is wrong. The plan says that after a
  declined push 'Today's Update store step will show'. But unpushed()
  (renderer ~6380) only counts pieces whose live flag disagrees with their
  state. Extras approvals are tracked only in the main process's
  Outgoing.updated set, and the pieces are already live and approved. So
  neither nextStep nor Settings' storeUpdate offers an update after an
  extras decline, and 'They go live with your next store update' leaves the
  owner with no visible way to update. Either expose that pending state, for
  example through the snapshot or the return value, so the step appears, or
  drop the claim and the wording.
- retryShown is only fully specified for Today and Settings. drafts() is
  drawn only in DRAFTING threads (threadParts 1142: publish, capture,
  evening) and in the Drafts view, and the failure card only shows when
  !pushOffer && !pushing. The plan doesn't state retryShown's condition for
  these screens. Without the exact DRAFTING.has(detailTask) / view ===
  'drafts' / !pushOffer / !pushing check, the derived notice either appears
  twice (card plus #status) or goes missing, for example in a deploy or
  setup thread where drafts() isn't drawn. Specify the condition, and test a
  non-drafting thread as well as the drafting one.
- Moving the push out of `publication:revoke` causes a regression. goLive()
  returns early while `pushing` is true (renderer 6424). A take-down made
  while another push is in flight (an approve or price auto-push, a Settings
  update, or a retry) therefore gets no push of its own. The in-flight push
  may have read state before the revoke, so the removal does not reach the
  store without a separate click, which goes against AC2. Today the handler
  always pushes after the revoke. Queue a follow-up push after the current
  one, or re-run goLive when pushNow finishes if unpushed() is still non-
  empty, and add a test for it.

**Prioritization (2026-11-12):** Priority P1. Stays in-review. Before it can
be ready: Criterion 1 still fails ("Push now" remains). Turn the five plan-
review findings into criteria: where the receipt or Updating state shows
after a take-down or price change on Inventory; clear pushFailed after a
successful deploy or when nothing is left; show the pending state after an
extras decline; the exact retry-notice condition per screen; queue a follow-
up push when a take-down lands mid-push.
