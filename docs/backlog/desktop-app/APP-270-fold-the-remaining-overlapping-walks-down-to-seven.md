---
id: APP-270
title: Fold the remaining overlapping walks down to seven
priority: P3
effort: L
component: desktop-app
status: completed
related: [APP-266, APP-267, APP-268, APP-269, APP-271, XC-084, XC-108]
blockers: [APP-269]
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-11-13
---

## Problem

After APP-269, 16 walks remain, and the 2026-10-29 survey of edge.cjs shows
they still overlap heavily: `store`, `update` and `settings` all exercise the
changes sheet and the store card; `schedule` and `reading` share the stand-in
reading and the same notification, badge and Today-card checks; `jobs` and
`sales` both assert Activity rows; `sell`'s only Electron-specific check is
the preview window's `webPreferences`; `feedback`, `cards` and `provision`
assert async and state rules reachable through a fake `window.lore` and the
APP-267 factory; `automations` drives `routines.cjs`'s Schedule and
`AFTER_RUN` rules through a window. Each walk is an Electron boot and a seed
on a 3-vCPU runner.

## Proposed approach

Fold to seven walks, each running one journey, the Electron-only checks and
one layout scan per view: `agents`, `connectors`, `store`, `checkin`,
`routines`, `settings`, `seller`. Moves: `update` and the changes-sheet
checks into `store`; `schedule` and `reading` into one `routines` walk;
`jobs` and `sales` Activity-row checks into unit tests, with the sale
notification path inside `checkin`; `sell`'s preview-window check into
`store`; `feedback`, `cards` and `provision` into unit tests against the fake
`window.lore` and `ipc.cjs`; `automations` into `routines` once its Schedule
and `AFTER_RUN` rules are in `ipc.test.cjs`. Rewrite APP-266's table for the
seven-walk set; that version is the input XC-108's guard reads.

## Acceptance criteria

- [x] `support/walks.cjs` lists exactly seven walks: agents, connectors,
      store, checkin, routines, settings, seller. (17 before, 7 after;
      `checkin` is now the one launched dark.)
- [x] Notes list, per folded walk, every assertion and where it lives now;
      all replacing tests exist and pass before the walk is removed. (Unit
      tier 409/409, from 372; component 53 pass and the known-gap todo.)
- [ ] ~~The walks step on the PR's macOS run is under 200 s, and the kept
      walks' `seconds` estimates in walks.cjs are refreshed from that run.~~
      Moved to APP-271, whose "walks step 150 s or less over three green main
      runs, seven walks" target is strictly stronger; the `seconds` were
      refreshed (by #679, then again by APP-271's #683). (Was: 344 s on PR
      #679's run 42582425386, from 436 s on main at c66af783.)
- [x] APP-266's table is rewritten for seven walks and its staleness test
      passes.
- [x] Layout scan: named transfers in Notes, from APP-266's table: update to
      `store`; schedule to `routines`; jobs' and sales' Activity rows to
      `settings`' Activity tab; sell's header button and paste sheet to
      `store` (the preview window is never scanned, only its webPreferences
      asserted); feedback's sheet to `settings` via the account menu; cards'
      Stripe rows and under-minimum warning to `store`; provision's banner
      and Try again to `checkin`'s launch; automations' tab, rows and edit
      sheets to `routines`. No view scanned before this change is unscanned
      after it. (Met: 25 of 25 views scanned on main and on the PR, the same
      five unscanned. Four named transfers changed, each explained under
      Premise drift: update's views stay with `store` and `settings` while
      its rules went to unit tests; feedback's sheet was never scanned;
      cards' Stripe states are unit tests while Settings stays scanned;
      provision went to `seller`'s launch.)

## Notes

- Workstream B4 of the test-pyramid plan. The 150 s walks target and the
  5-minute macOS job are met by this item together with APP-271.
- `agents` keeps `solo: true` (XC-084) until the XC-083 reading says it can
  share the runner again.

### What was done (2026-11-09)

Walk count: 17 before (main at c66af783), 7 after. The seven, in walks.cjs:
`agents` (solo), `routines`, `store`, `connectors`, `seller`, `checkin`
(launched dark), `settings`.

| Run | Walks | Walks step | Desktop macOS checks job |
|---|---|---|---|
| main's last green, 42576449443 (322f164c) | 22/22 | 440 s | 553 s |
| main at c66af783, 42579207960 (walks green; `npm run package` failed on a release-asset 504) | 17/17, `agents` alone 197 s | 436 s | 594 s to the failed package step |
| PR #679, 42582425386 (2e52dbb1) | 7/7, `agents` alone 192 s, 0 retried | 344 s | 504 s, package included and green |

The walks step fell 92 s against main at c66af783 (436 to 344 s), and 96 s
against main's last green run (440 s). The job fell 90 s against c66af783's
run (to its failed package step), and 49 s against the last green run (553
to 504 s). The unit step grew from 18 to 24 s with the new tests. Per walk
on the PR's run: agents 192 s (alone), routines 98, store 63, connectors 43,
seller 31, checkin 30, settings 23; walks.cjs's `seconds` are those. The
PR's first run (42581231446) failed `routines` twice, both for real causes:
the New mark below, and the page drawing the turned-back-on routines before
it had read them again (the walk now waits for them).

A layout fault the fold found: `routines` scans reading-inventory-from at
900 px too (the reading walk shot it at 1040 only), and a New mark after a
long title ("Add the ops management layer before the next ten hires") was
cut off with the title's ellipsis. The mark now sits beside the title, not
inside it (src/renderer.js `unseen.watch`, src/styles.css `.invrow
.new-mark`), so a long title is cut short before the mark.

#### Premise drift, checked against main as it stood

- Main had 17 walks, not 16: `inventory` (APP-282) came after this item was
  written. So eleven walks folded, not nine: the item's nine plus
  `inventory` and `jobs`, which APP-269 left carrying the dark launch and
  faq's account menu and FAQ.
- `routines` did not exist. It is new: the schedule, reading and
  automations walks, one after another in one launch, from one seed (the
  schedule walk's vault and owed reading, the automations walk's routine of
  the owner's own, the reading walk's Granola stand-in and older memory). The
  seed pauses Lore's other routines so only the reading is owed at launch,
  as the schedule walk's did; the walk turns them back on before the
  automations part. Every count is taken from where it stood, and the
  stand-in model writes Granola's memories only for Granola's reading, so
  their marks still say Granola. The automations part checks "Every day at"
  the seeded hour, which is twelve hours from now, in place of 9 AM.
- Provision's banner went to `seller`'s launch, not `checkin`'s. main.cjs
  runs `schedule.check()` at launch whether or not setup failed, so the
  check-in `checkin` owes at launch would run with no agent and record
  "could not look" (AFTER_RUN.checkin), and the walk could never ask its
  question. The seller walk's seed is the one the provision walk had.
- The dark launch went to `checkin`. It never reads DARK, and its views
  (the Inbox, a thread) are scanned light by other walks. It also took the
  jobs walk's account menu, Escape and FAQ shots, dark as before.
- `update` went to unit tests, not into `store`: the changes sheet it
  scanned is scanned by `store` (store-confirm-changes) and Settings by
  `store` and `settings`, and every rule it checked is in
  test/unit/store.test.cjs (APP-231) or the new
  renderer-store-update.test.cjs.
- jobs' and sales' Activity rows: their rules were already
  renderer-activity.test.cjs. The section is scanned by `settings`, whose
  seed now keeps one finished run (settings-activity).
- Sell's "header button" is gone since APP-290: Inventory's header has only
  Record a memory (renderer-talk.test.cjs). The way in is New › Writing to
  sell; `store` checks that menu and shoots the paste sheet (sell-paste).
- Feedback's sheet was never scanned: the feedback walk shot only after the
  sheet had closed itself (views.json lists feedback-sheet with no scan,
  one of the five). Nothing moved; it stays unscanned, as before.
- Cards' Stripe rows: the Settings view stays scanned by `store` and
  `settings` (settings shows By card On), but the waiting, checking and
  under-minimum states are no longer shot. Their text and actions are
  renderer-cards.test.cjs. Driving them in `store` would need the checkout
  stand-in and its browser stub in that walk; left out.
- The 200 s walks step is not reachable here. Since XC-084 `agents` runs
  alone first, about 195 s on its own; the other six then run two at a
  time. See below.

#### Assertion by assertion: where each folded walk's checks live now

All new tests are under app/desktop/test/unit/, run by `npm run test:unit`,
and passed before the walks were removed: 409/409 at the PR's head (372
before), component 53 pass and the one known-gap todo.

**schedule → `routines` (first part)**: every check is a line of the
routines walk, unchanged but for the hour: the launch catches up on the
missed hour with one reading; the same notification, dock number and Inbox
row; the CLI remembers the run and its result; Settings says when Lore reads
next, in plain words. Added: Done takes that row out and the dock clears,
so the next reading starts from nothing.

**reading → `routines` (second part)**: every check is a line of the
routines walk, its counts taken from where they stood: connecting Granola
says Lore is turning the meetings into memories and starts one reading; the
quiet shimmering row, still under reduced motion; one notification and a
red 2 while away; the notice goes; the click lands on the row, in plain
words; seeing clears the dock; nothing shimmers; Inventory's marks
("Written by Lore", Granola's own), flat group rows, `sourceMark` never
drawn from a path; Review and Done; a relaunch would not bring it back.

**automations → `routines` (third part)**: every check is a line of the
routines walk; Run now's reading and banner counts are taken from where
they stood, and "Every day at" names the seeded hour.

**update → unit tests**
- Not a step on the Inbox: renderer-store-update "a newer store from Lore
  is never a step on the Inbox".
- Settings says so beside the address with a quiet Update, never naming
  code, versions or deploys: renderer-store-update "Settings says a newer
  store is ready…".
- Update asks first, naming the newer store; Cancel puts nothing out:
  store.test.cjs "Update store puts out the newer store Lore ships…
  (APP-231)"; the button's call is renderer-store-update "Update asks main
  for the newer store; once the store is the one Lore ships, nothing more
  is offered".
- Confirm puts it out as it was last opened (network and payout), and an
  agents-only store goes out `--inbox-only`: store.test.cjs APP-231 test.
- Once current, nothing more offered; an agents-only store is offered too;
  a store this Mac has no record of is never offered: renderer-store-update
  (three tests named for them), and tests/test_deploy.py
  `test_a_deploy_that_went_out_records_the_store_this_lore_ships` for the
  CLI's current/unknown.

**provision → `seller`'s launch, and unit tests**
- Banner names the failure, Try again offered, retry recovers to sign-in,
  agent answers after retry: lines of the seller walk (the live launch, and
  the provision-failed and provision-recovered shots), and
  renderer-provision.test.cjs (two tests: the banner and Try again's
  `retrySetup` call; the banner and provisioning state clearing once setup
  finishes).
- IPC answers before setup finished, and after: ipc.test.cjs "every call
  that needs the agent is refused with one plain sentence before it exists,
  and goes through once it does", "setup:retry boots again only while there
  is still no agent".

**jobs → unit tests, and `checkin`**
- Today carries no Activity; Activity is Settings' last section; done,
  failed, push sizes, unfinished, running, dot and word, an Activity row
  opens its thread; no runs, no section: renderer-activity.test.cjs (the
  ROWS table, "Settings draws Activity last…", "an owner with no runs
  yet…"). History survives leaving and returning: new renderer-activity
  test "history survives leaving Settings and returning".
- Automations carries no run log: renderer-routines.test.cjs "Automations,
  in Settings, carries no run log, only automations".
- History carries no command or path: tests/test_cli.py's push test that
  pins `edge_write_failed` with no wrangler, npx or path.
- A reading Codex ran is Lore's, listed with Run now, no agent named, its
  next run: renderer-routines.test.cjs "a reading Codex ran is Lore's
  now…", and tests/test_automation.py TakeOverTest
  `test_a_codex_reading_keeps_its_rhythm_and_pause_and_its_task_comes_down`.
- The dark boot check, the account menu opening with focus on its first
  item, Escape closing it (Chromium's own) and Help & FAQ landing on the
  FAQ: lines of the checkin walk, launched dark. What the menu and the FAQ
  say stays renderer-account-menu.test.cjs and renderer-faq.test.cjs.

**cards → unit tests**
- Offers Get paid to your bank: renderer-cards "Settings offers to get paid
  to the bank by card, and pressing it opens Stripe's form through Lore…".
- The form opens through Lore's checkout: cards.test.cjs "Get paid to your
  bank opens Stripe's form, through Lore's checkout, in the browser" (and
  "a checkout run locally opens too; anything that isn't a web page never
  does"); the link itself is tests/test_cards.py
  `test_the_onboarding_link_goes_through_the_checkout_and_asks_it_nothing`.
- Needs you, Finish with Stripe, the same account again: renderer-cards
  "while Stripe needs more…", tests/test_cli.py
  `test_connect_opens_one_account_and_reuses_it_until_stripe_clears_it`.
- Checking, nothing to do, the notice clears: renderer-cards "while Stripe
  verifies…".
- Under the card minimum, warned once on the price row: renderer-cards
  "Stripe cleared with the price under the card minimum…", tests/test_cli.py
  `test_cards_need_a_price_of_at_least_fifty_cents`.
- Cards come on by themselves into the cleared account, with Turn off:
  renderer-cards "once Stripe has cleared and the price can be charged…";
  cards.test.cjs "card status and switching reach the CLI's card calls as
  they are", "switching cards refuses anything but a Stripe account id…".

**feedback → unit tests**
- The button only on a build that can send; in the account menu, which
  closes as the sheet opens: renderer-feedback "Report feedback appears only
  on a build that can send it…" (and renderer-account-menu's "the menu
  reads…").
- Send waits for both fields; editing mid-request leaves Send disabled; it
  lands as "Filed as"; one action, one report: renderer-feedback "Send waits
  for a title and a description; one Send is one report…".
- A report in flight never closes a sheet opened after it; the second
  filed once: renderer-feedback "a report still in flight never closes a
  sheet the owner opened after it".
- The CLI side: store.test.cjs "report feedback validates before any CLI
  call…", "report feedback omits --email entirely when none is given".

**sales → unit tests, and `store`**
- The Inbox carries no Earned, runs or stats; a thread stopped days ago is
  not Unfinished: renderer-sales "the Inbox carries no Earned…".
- Old sales never announced; a new one announced once; a burst is one
  banner; the click opens the store: ipc.test.cjs's five watchSales tests
  and app.test.cjs "announces only sales after the last one seen…"; the
  walk's own wording: renderer-sales "the walk's own banners…".
- Inventory sums the ledger, says by card, receipts as a word; counts a new
  sale; 42 views and "by an agent" on hover; the banner opens On sale; an
  unreachable store offers no price link: renderer-sales (four tests named
  for them).
- No sale amount is monospace, with even figures: a line of the store walk
  ("no sale amount is monospace, and every one has even figures").
- Activity: one row for a run repeated, no agent cost, a run stopped days
  ago is history: renderer-activity.test.cjs.

**sell → unit tests, and `store`**
- Preview opens the draft's page in its own window, with no paid text, in a
  window that runs no script: lines of the store walk (webPreferences only
  Electron can say); the page itself is app.test.cjs "previews a draft's
  page with the store's renderer, free fields only".
- Inventory's header has only Record a memory: renderer-talk.test.cjs.
- New lists Writing to sell; the sheet opens: lines of the store walk, and
  renderer-sell "New lists Memory, Collection, Writing to sell and
  Automation…", "Writing to sell opens Sell something you wrote…".
- Draft it for sale keeps the writing privately and starts the publish
  thread from it: renderer-sell "Draft it for sale keeps the writing
  privately, titled by its first line, then starts the publish thread from
  it" (and "a write that fails keeps the sheet open…").

**inventory → unit tests, and `store`**
- One list with only Taken down, folded, last; newest first; no live row
  says Taken down; a live copy and a memory on sale read once; a mark and
  a date on every row, no title tooltip; Taken down opens:
  renderer-inventory.test.cjs (five tests named for them).
- A group header reads as a label, rows the Inbox's size (computed style
  and a 36 px row): a line of the store walk.
- Inventory turns dark at once and back: lines of the store walk, with the
  inventory-rows-dark shot.
- Record a memory opens the thread listening under Chromium's fake
  microphone, Esc sends nothing: lines of the store walk, with the
  talk-listening shot; the rest of talking it through stays
  renderer-talk.test.cjs.

#### Layout scan, view by view (views.json, checked by views.test.cjs)

No view scanned before this change is unscanned after it.

- main at c66af783 (17 walks): "25 of 25 views in views.json scanned this
  run (133 shots, 83 again at 900 px); 5 more listed with no walk that scans
  them".
- PR #679's 42582425386 (7 walks): "25 of 25 views in views.json scanned
  this run (114 shots, 92 again at 900 px); 5 more listed with no walk that
  scans them".

The five views with no scan are the same five as before (first-run,
source-disconnect, change-time-sheet, feedback-sheet, preview-window).

- update: update-settings (Settings) → `store` (settings-store) and
  `settings`; update-confirm (changes sheet) → `store`
  (store-confirm-changes).
- schedule: schedule-today-ready and schedule-connectors → `routines`, the
  same labels, now at 1040 and 900 px.
- reading: reading-today-working, reading-today-ready and
  reading-inventory-from → `routines`, the same labels, now at both widths.
- automations: every label (the tab, its rows, the edit sheets, the
  suggested collection and its wizard) → `routines`, the same labels.
- jobs: settings-activity → `settings` (same label);
  settings-activity-empty no longer shot (its text is renderer-activity);
  automations-taken-over no longer shot (the Automations view is scanned by
  `routines`); account-menu and faq → `checkin`, dark, same labels.
- sales: sales-today-top and sales-today (Today) → no longer shot, the
  Inbox is scanned by six walks; sales-list and sales-for-sale (Inventory,
  On sale) → `store`'s store-sales; sales-activity → `settings`'
  settings-activity.
- cards: cards-offer, cards-waiting, cards-price-warning, cards-on
  (Settings) → no longer shot; the Settings view is scanned by `store` and
  `settings`.
- feedback: feedback-filed (Today) and feedback-other-sheet-survives (the
  sell sheet) → no longer shot; both views are scanned by kept walks
  (`store`'s sell-paste for the sheet).
- sell: inventory-sell-writing (Inventory, Private) → `agents`, `seller`,
  `routines`; sell-paste → `store`, same label, now at both widths;
  sell-drafting (a thread) → `store`, `connectors`, `seller`, `checkin`.
  The preview window was never scanned; `store` asserts its webPreferences.
- inventory: inventory-rows-dark and talk-listening → `store`, same labels,
  now at both widths; inventory-rows and inventory-taken-down → `store`'s
  store-removal-pending (Taken down open) and store-sales.
- provision: provision-failed and provision-recovered → `seller`, same
  labels.

Not run locally: the walks open real Electron windows on this Mac, so they
were left to CI.

#### What remains

- The walks step is 344 s, not under 200 s. `agents` alone is 192 s of it
  (solo since XC-084, kept so until the XC-083 reading says it can share),
  so the six shared walks would have to finish in under 8 s. The rest is
  APP-271 (making the kept walks cheaper, `agents` first) or a re-scope of
  this criterion. Status stays `in-progress` until then.

**Backlog audit (2026-11-12), moved to in-review:** The fold to seven walks
landed in PR #679, and every structural criterion holds on main. The 200 s
walks-step target is not met: main runs 191-375 s, and the solo `agents`
walk alone takes 110-170 s. APP-271's 150 s target covers the same ground.
Back to in-review so the time criterion can move to APP-271 (or XC-084) and
this item can close.

**Prioritization (2026-11-12):** Priority P3 (was P1). Stays in-review.
Before it can be ready: Move the time criterion to APP-271 or XC-084 and
close; its blocker APP-269 must close too. APP-271 waits on this.
Prioritization flag (not acted on): done: #679.

**Close-out (2026-11-13):** Completed. The fold landed in PR #679:
`app/desktop/support/walks.cjs` lists exactly the seven walks (`agents` solo,
`routines`, `store`, `connectors`, `seller`, `checkin` dark, `settings`), the
replacing unit tests are under `app/desktop/test/unit/`, and the layout-scan
transfers are recorded above. The one open criterion, the walks-step time, is
struck and moved to APP-271, which already carries a stricter 150 s target
over three main runs. For the record, main's last three green CI runs
(43400916244, 43400510839, 43400048013 on 2026-11-13) took 311, 287 and 351 s
in the walks step, with `agents` alone at 149, 135 and 138 s. The listed
blocker APP-269 is still in-review, but its five walks are already gone from
walks.cjs, so it no longer gates anything here.
