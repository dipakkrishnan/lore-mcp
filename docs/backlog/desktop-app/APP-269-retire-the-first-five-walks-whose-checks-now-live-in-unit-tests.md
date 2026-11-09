---
id: APP-269
title: Retire the first five walks whose checks now live in unit tests
priority: P1
effort: M
component: desktop-app
status: in-review
related: [APP-266, APP-267, APP-268, APP-270, XC-083]
blockers: [APP-266, APP-267, APP-268]
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-11-09
---

## Problem

Five of the 21 walks assert things that are now, or will be after APP-267 and
APP-268, covered by unit tests, and each still costs an Electron boot, a seed
and a fresh CLI runtime on the macOS runner (latest green main run
40995303688, walks step 394 s of the job's 498 s):

- `today` (34 s): six seeded stages of `nextStep`, a function of state.
- `fresh` (40 s, with 15.7 s of fixed sleeps): the notice state machine and
  remember-write failure handling, drivable through a fake `window.lore`.
- `quiet` (18 s): the same seed and code block as `checkin` with
  `reach_out:false`; one extra assertion in `checkin` covers it.
- `obsidian` (18 s): vault offer, listing, connect and disconnect, all
  already exercised inside `connectors` (edge.cjs:1113-1130).
- `faq` (8 s, dark): sidebar, account menu, Escape, ⌘, and FAQ wording; its
  only dark-specific check is the boot theme.

## Proposed approach

For each walk: list what it asserts (from edge.cjs), point at the unit test
that now asserts it (APP-267's `ipc.test.cjs`, APP-268's renderer tests, or a
line added to a kept walk), remove it from `support/walks.cjs` and its
scenario from edge.cjs/edge.sh, and move its layout scans per APP-266's
table. The `quiet` seed is `checkin`'s; add the `reach_out:false` assertions
there. The `faq` dark-boot check moves to `settings`, which already switches
appearance. Update `walks.test.cjs`'s fixtures and the README's walk count.

## Acceptance criteria

- [x] `support/walks.cjs` lists 16 walks; `today`, `fresh`, `quiet`,
      `obsidian` and `faq` are gone from it and from edge.cjs/edge.sh.
      (Premise drift: it lists 17. Main had 22 when this was worked, not 21:
      the `inventory` walk (APP-282) came after this item was written. The
      five named here are gone from walks.cjs, edge.cjs and edge.sh.)
- [x] The item's Notes list, per retired walk, every assertion it made and
      the unit test or kept-walk line that makes it now; all of those tests
      exist and pass before the walk is removed.
- [ ] The walks step on the PR's macOS run is under 300 s. (Not met; see
      Notes: `agents` alone, run solo since XC-084, takes about 190 s of it.)
- [x] Layout scan: per retired walk, the views it scanned (from APP-266's
      table) and the kept walk that scans them now are named in Notes:
      today's Today-card stages in `store` and `connectors`, fresh's empty
      states and notices in `checkin`'s launch, quiet's views in `checkin`,
      obsidian's vault sheet in `connectors`, faq's sidebar, account menu,
      FAQ view and dark boot in `settings`. No view scanned before this
      change is unscanned after it; a retirement whose views have no kept
      home does not merge.

## Notes

- Workstream B3 of the test-pyramid plan. Expected saving: 118 s of serial
  walk time and five Electron boots. The second round is APP-270.
- Since XC-080, a walk that fails once is retried; a retired walk also
  retires its share of the flake budget XC-083 is measuring.

### What was done (2026-11-09)

Walk count: 22 before (main at cb336dc9), 17 after. Walks step time: main's
last green run, 42572100253 (dc7cb795), 497 s (22/22 walks, 2 at a time;
`agents` alone 189 s). This PR's run: WALKS_PR_PENDING.

Premise drift, checked against main as it stood:

- Main had 22 walks, not 21: `inventory` (APP-282) was added after this item.
  So 22 - 5 = 17, not 16.
- `today` now also covered APP-290's talking it through (eight checks, two
  shots), which nothing else covered. It is still retired: its checks are
  `test/unit/renderer-talk.test.cjs`, and its listening-composer shot moved
  to the `inventory` walk (below).
- `faq` was the only walk launched dark. The dark boot check did not move to
  `settings`, as proposed: launched dark, `settings` would leave the price
  sheet and the sidebar's update button with no light scan, since it alone
  shoots them. It moved to `jobs`, the cheapest walk that never reads DARK and
  whose views light walks also scan. `jobs` now also shoots faq's account
  menu and FAQ, dark, as faq did.
- The `quiet` reach_out:false assertions were not added to `checkin`: its
  stand-in model would need a second verdict mid-walk. They are unit and
  component tests already (below).
- The 300 s target is not reachable by retiring these five. Since XC-084,
  `agents` runs alone first (189 s on main's last green run), then the rest
  two at a time. The five retired walks took 144 s of serial walk time on
  that run (today 47, fresh 57, quiet 23, obsidian 11, faq 6), about 72 s of
  wall time at two at a time. APP-270's folds are what can reach the target.

New tests (all under `app/desktop/test/unit/`, run by `npm run test:unit`, all
passing): `renderer-step-actions.test.cjs` (10), `renderer-talk.test.cjs` (7),
`renderer-empty-states.test.cjs` (9), `renderer-vault.test.cjs` (3),
`renderer-bids-empty.test.cjs` (1). Unit tier 332/332.

#### today → replacing tests

- e to f, the one next step at each stage, and never more than one:
  `renderer-next-step.test.cjs` (APP-268), the STAGES table and "the Inbox
  draws the step as one row".
- How it works offered while nothing is kept, opens the FAQ, stays closed
  once closed; not offered once something is kept: `renderer-step-actions`,
  "How it works is offered…" and "an owner with memories…".
- e: Connect opens Connectors with the Connect an agent sheet, no grid, no
  coding agents named: `renderer-step-actions` "e: …".
- d: Start sends one publish prompt and opens its thread; while it drafts the
  thread is a row and no step asks again; the step returns once it ends:
  `renderer-step-actions` "d: …", and `renderer-next-step` "d: once the
  publish thread finishes…".
- c: each draft is one row with Review, no card points at them, Review opens
  the drafts: `renderer-step-actions` "c: …".
- b2: Open your store sends "Help me open my store." in the store's thread,
  ahead of the waiting draft; nothing is offered while it opens:
  `renderer-step-actions` "b2: …".
- b: Update store pushes first and prompts nothing; with only the price left
  it redeploys in the store's thread: `renderer-step-actions` "b: …".
- a: Fix it sends one prompt; the repair is its own working row that reopens
  the thread sending nothing; a second Fix it sends nothing; the account line
  says offline: `renderer-step-actions` "a: Fix it…". A failed repair brings
  Fix it back: "a repair that fails…" and `renderer-next-step` "a: once the
  repair ends…".
- f: nothing to ask once an app is connected: `renderer-step-actions` "f: …".
- APP-290, all of it: Inventory and the Inbox offer Record a memory and no
  other page does; the thread opens listening with its opener line; Enter
  sends what was said as the owner's words; Lore's answer leaves the
  microphone off; the button listens again; Esc stops and sends nothing;
  leaving stops it and Enter elsewhere sends and transcribes nothing; typing
  ends it; an empty transcript sends nothing; a memory card ends it:
  `renderer-talk.test.cjs`, with getUserMedia and AudioContext faked in jsdom.
  The `inventory` walk keeps one live check: Record a memory opens the thread
  listening under Chromium's fake microphone, and Esc sends nothing.

#### fresh → replacing tests

- The welcome screen's usage line and See what's sent:
  `renderer-empty-states` "the welcome screen says…".
- Its first write fails and nothing else is sent; signing out while Lore
  loads remembers only that notice and counts the install:
  `renderer-empty-states` "a failed write…", `renderer-harness.test.cjs`
  "boot() with nobody signed in…". The install counted once in the local
  log: `tests/test_usage.py`.
- No notice off the Inbox, nothing remembered before it is seen, the first
  Inbox visit says it, a failed write is retried by the next load, then
  app.opened (never a second install), shown once, other pages clean:
  `renderer-notices.test.cjs` "a notice waits for the Inbox…".
- Nothing about connected apps while none is; once one is, said once with
  Settings: `renderer-notices` "nothing is said about reading connected
  apps…".
- Dismissed while its write is out and the write fails; the next load
  remembers it; later loads leave it: `renderer-notices` "dismissed while…".
- Sign-out while a slow write is out sends nothing queued behind it:
  `renderer-notices` "signing out drops every notice…". Signing in again is a
  fresh sign-in that counts app.opened: `renderer-empty-states` "signing in
  again…". Opened again, nothing more is said: "opened again…".
- Lore's own automations listed on in Settings: `renderer-empty-states`
  "Settings lists every one…"; on by default: `tests/test_automation.py`
  OnByDefaultTest.
- Empty Inventory with Add your first memory, which lands on the Inbox with
  the composer focused: `renderer-empty-states` "an empty Inventory…".
- No store: Settings offers Open your store, Inventory has no store card:
  "with no store…". Nothing on sale, See what's private opens Private, no
  Sales group, every action a real button: "nothing on sale…".

#### quiet → replacing tests

- No notification, no dock badge, "Nothing new to ask about":
  `test/unit/ipc.test.cjs` "checkedIn records that the model could not look,
  and that it chose to stay quiet…"; `test/component/agent.test.cjs` "a
  check-in stays silent when nothing today is worth asking about…".
- Nothing in the Inbox: `renderer-empty-states` "a quiet day puts nothing in
  the Inbox…"; agent.test's `checkIns.waiting()` is null.
- A check-in missed by hours is recorded as missed and never asks late:
  `tests/test_automation.py`
  test_a_check_in_missed_by_hours_is_recorded_and_never_asks_late, and
  `ipc.test.cjs` "AFTER_RUN.checkin leaves a missed run… alone".

#### obsidian → replacing tests

- Offered by name with "Your vaults and notes", its mark, one Connect, no
  jargon: `renderer-vault.test.cjs` test 1; the connectors walk's catalog
  check covers every app's name and mark live.
- Connect lists the vault by name, nothing to type, waits for a choice;
  connected, the sheet closes and the row says "2 notes kept":
  `renderer-vault` test 2; live in the connectors walk ("Obsidian offers every
  vault it knows", "a vault connects and says what it kept"); vault discovery
  in `tests/test_sources.py`.
- Read again picks up a new note and says "1 new note."; Disconnect asks
  "Disconnect Edge Vault?", keeps the memories, offers Obsidian again:
  `renderer-vault` test 3.

#### faq → replacing tests

- The dark boot check: the `jobs` walk, now launched dark (edge.cjs's boot
  check runs in every walk).
- The sidebar's four places, feedback only in the account menu:
  `renderer-account-menu.test.cjs`. Bids with no board, its All tab and its
  tabs: `renderer-bids-empty.test.cjs`. How it works not offered with
  memories: `renderer-step-actions`.
- The menu's lines, icons, focus, ⌘, and Sign out: `renderer-account-menu`.
  Escape closing the popover is Chromium's own, so it stays a walk line:
  `jobs` "Escape closes it". Help & FAQ landing on the FAQ:
  `renderer-faq.test.cjs` and `jobs`.
- The FAQ's wording: `renderer-faq.test.cjs`.

#### Layout scan, view by view (views.json, checked by views.test.cjs)

No view scanned before this change is unscanned after it.

- today: Today-view shots (the stages, talk-inventory) → `today` view still
  scanned by connectors (today-bring-in with How it works, today-publish, at
  1040 and 900), settings, agents, reading, schedule, automations, checkin,
  sales, feedback, seller. talk-inventory showed Inventory's header with
  Record a memory: the sell walk's inventory-sell-writing is that state.
  talk-listening → the `inventory` walk (thread view), at 1040 only; it was
  also shot at 900 as part of `today`.
- fresh: welcome-usage → `welcome`, still scanned by provision (the
  recovered sign-in carries the same usage line). today-usage-notice and the
  automations notice → `today` (settings' Inbox shots carry the usage
  notice). memories-empty → `inventory-private` (sell, agents, reading,
  seller). store-empty → `inventory-sale` (inventory, store, settings,
  agents, sales, seller). automations shots → `automations` (jobs,
  automations). The empty shelves' own sentences ("Nothing kept yet",
  "Nothing on sale yet") are no longer shot; their text and buttons are
  `renderer-empty-states`.
- quiet: checkin-quiet-today → `today` (checkin's checkin-today).
- obsidian: its Connectors rows → `connectors` (connectors' settings-catalog
  and settings-connected); its vault picker and Manage sheet →
  `connector-sheet` (connectors' obsidian-change-refused, export-manage). The
  Disconnect confirm was never shot and still is not.
- faq: faq → `jobs` (dark, 1040, as before); account-menu → `jobs` (dark)
  and settings (both widths, light and dark); sidebar → settings'
  update-ready, and every scan with no modal open includes the sidebar.

Not run locally: the walks open real Electron windows on this Mac, so they
were left to CI.
