---
id: APP-271
title: Make the seven kept walks cheaper without scanning less
priority: P2
effort: M
component: desktop-app
status: in-review
related: [APP-266, APP-270, XC-072, XC-084, XC-108, STO-006]
blockers: [APP-270]
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-11-12
---

## Problem

The walks' time is mostly fixed cost, not assertions. Across the 21 walks the
2026-10-29 survey counted 186 `sleep()` call sites worth about 81 s plus
31.5 s of start-up sleeps (edge.cjs:949 `sleep(2500)`, :1043 `sleep(3500)`,
:1970 `sleep(3000)`, :2591 and :2600 `sleep(2500)` twice), a 1.5 s sleep
before anything in every walk (edge.cjs:666), and stand-in delays of 6-7 s
in the reading and check-in fixtures (edge.cjs:221-240). Every `shot()` runs
SETTLE and a full-DOM LAYOUT pass; `agents` takes 39 screenshots, so 78
layout passes, and the seven walks in the 900 px set do it all twice. The
renderer's `load()` fans out nine IPC calls at once (renderer.js:4353), about
five of them `uv run lore` spawns, and every `changed` event triggers another
load: `agents` makes 258 app CLI calls in one walk (walks.cjs:25).

## Proposed approach

Replace fixed `sleep()`s with `waitFor` on the state each one waits for;
keep a sleep only where the thing waited on is wall-clock by design and say
so in a comment. Scan layout once per view per walk at 1280 px, and once per
view at 900 px for the narrow set, instead of once per screenshot; keep the
screenshot calls that document a state but let them skip the scan. Cut
`agents`' CLI calls by batching the `load()` fan-out into one `snapshot`
IPC, or caching snapshot reads within a tick, whichever the renderer bears
without a redesign. Shorten the stand-in fixtures' delays where the test
only needs ordering, not duration.

## Acceptance criteria

- [x] `grep -c 'sleep(' app/desktop/support/edge.cjs` falls by at least half
      and each remaining sleep has a comment naming what it waits for.
      (139 before, 14 after.)
- [ ] `agents` finishes in 100 s or less on the macOS runner over three
      consecutive green main runs. (Not verifiable before merge. On PR #683:
      80, 81 and 128 s on its last three runs whose first attempt passed,
      the 128 s on a runner at load 76, from 168 s on main at 808a33d8.)
- [ ] The walks step is 150 s or less over three consecutive green main
      runs, with seven walks and no retries counted as passes. (Not met on
      the PR: 177, 160 and 271 s on those runs, from 298 s on main at
      808a33d8.)
- [x] Layout scan: every view in APP-266's seven-walk table is scanned at
      least once per walk at 1280 px, and every view in the narrow set once
      at 900 px; Notes list, per walk, which `shot()` calls became
      scan-only, which were removed, and why no view lost its scan.
      Screenshots may be dropped; scans may not. (The window is 1040 px, not
      1280: every view still scanned by every walk that scanned it, at both
      widths where it was; 25 of 25 views, the same five unscanned.)

## Notes

- Workstream B5 of the test-pyramid plan, and the item most able to lose
  layout coverage quietly, because "once per view" is a reduction of the
  scan itself. The rule above is the whole point of APP-266's table.
- XC-072's condition waits are the same idea applied to flakes; where a
  `waitFor` replaces a sleep that XC-072 also names, do it once.

### What was done (2026-11-09, PR #683)

#### Times

| Run | `agents` | Walks step | Desktop macOS checks job |
|---|---|---|---|
| main at 808a33d8, 42584807851 | 168 s | 298 s | 409 s |
| APP-270's PR runs (#679) | 192-197 s | 344-369 s | 504 s |
| PR #683 at ee4333f3, 42595713224 | 80 s | 177 s (`connectors` passed on retry) | 271 s |
| PR #683 at fb72ebd6, 42597962144 | 63 s, failed; 124 s on retry | 323 s | 472 s |
| PR #683 at 6f69c8da, 42599163441 | 81 s | 160 s, 0 retried | 251 s |
| PR #683 at 11ebe440, 42599899973 (load 14-76) | 128 s | 271 s, 0 retried | 432 s |

The runner's load average swung from 10 to 80 between runs, and the step
with it (one run of this same code took 191 s, another 337 s before the
stand-in node fix). Each walk now ends with TIME lines (edge.sh prints
them): its time under Electron, its scans' time, its fixed sleeps, its
eight longest stretches between checks, any wait that ran out (by line),
and how long edge.sh spent seeding. Those lines found most of the time
below.

Where `agents`' 168 s went, and what came of it:

- **35 s before the walk began, every run**: the stand-in node
  (tests/fixtures/inbox.py) binds through HTTPServer.server_bind, which
  asks `socket.getfqdn("127.0.0.1")`; on the macOS runner that reverse
  lookup took about 35 s. `Node.server_bind` now binds as TCPServer does,
  without the lookup: the node listens in under a second.
- **About 45 s of fixed sleeps and waits for nothing**: the 11 s for the
  sheet's own ten-second look, 3 s after coming back to the app, 1.5 s
  before anything, two waits of 2 s each for a sign-in Claude, Other and
  Instinct never ask for, 0.25 s around every narrow scan, and a ten-second
  wait for "Pick a price and where payments go", which the row no longer
  says, that ran out every run. Each is now a wait on its condition.
- **Pictures**: CI never uploads them, so on CI no shot() captures one (see
  below).
- **`uv run` on every CLI call**: the app's stand-in CLI, the walk's own CLI
  calls and edge.sh's seeding run the project's built environment straight
  when uv has built it, as `uv run` would have put it first on PATH.

The other walks lost the same kinds of waits: store's ten-second waits for
"Approve what to sell" (the Inbox lists drafts as rows since APP-283) and
for "Taken down" (shown only once the folded group opens), both of which
ran out every run; connectors' 5 s after a cancelled connect; routines' and
checkin's stand-in readings and check-ins of 6 and 7 s (now held by the
walk where it looks at them working, and otherwise landing after 2-2.5 s);
two 2.5 s waits after a routine change.

#### Sleeps

`grep -c 'sleep(' app/desktop/support/edge.cjs`: 139 before, 14 after. The
14, each with its comment:

- `key()`: 30 ms for a key event to land; sendInputEvent says nothing when.
- `firstrun` (run by hand, not by CI): 800, 1500 and 500 ms in which the
  chat must not start early (a held read keeps a call out, so the app never
  goes quiet), and twice 300 ms in which a second ask must not go out.
- `seller`: 100 ms in which a refused recovery phrase must not close the
  card; 200 and 100 ms so each step has a time the row then shows; 450 ms
  between the two shimmer pictures (only where pictures are kept); 300 ms
  for the shimmer to move, which is what its check measures; twice 300 ms
  so streamed words finish their 150 ms ink-in (INK_MS) before the next
  delta; 200 ms for the mouse leaving a row to land before the row is
  focused.

Everything else waits on its condition: `waitFor` on the page (now asked
every 50 ms, keeping its old budget), `until` on what the walk records
(notifications, readings, copies, calls), `idle` for no call from the page
being out for a quarter second, `answeredSince` for a call answered (Run
now, the cancelled connect), and `lookedSince` for a check of Lore's clock
(Schedule) or its agents' watch (Watch) that a step set off having finished.

#### Layout scan, walk by walk

On CI every `shot()` is scan-only: it runs SETTLE and LAYOUT at the window's
width and, for the narrow walks, at 900 px, and captures no picture
(`IMAGES` in edge.cjs; LORE_EDGE_IMAGES=1 keeps them, and a walk run by hand
keeps them by default). Scans cost 2-7 s a walk; pictures were what went.
Three shots were removed, each one scanning a state the shot before it had
just scanned, unchanged:

- `agents` (narrow): 33 shots, all scan-only. Removed `agents-grok-setup`
  (the same sheet as `agents-setup`, shot straight after it) and
  `agents-grok-new-key` (the same as `agents-new-key`). The agent-setup view
  is still scanned by eleven shots at both widths.
- `store` (narrow): 11 shots, all scan-only. Removed `store-unpushed`:
  Inventory as `store-sales` scanned it, back in light after the dark shot,
  nothing else changed. inventory-sale is still scanned by six shots at both
  widths.
- `routines` (narrow): 13 shots, all scan-only, none removed.
- `connectors` (narrow): 15 shots, all scan-only, none removed.
- `settings` (narrow): 17 shot() calls, all scan-only, none removed.
- `seller`: 17 shots, all scan-only, none removed.
- `checkin` (dark): 5 shots, all scan-only, none removed.

Views-scanned line, before (main at 808a33d8): "25 of 25 views in views.json
scanned this run (114 shots, 92 again at 900 px); 5 more listed with no walk
that scans them". After (every PR run): "25 of 25 views in views.json
scanned this run (111 shots, 89 again at 900 px); 5 more listed with no walk
that scans them". The three fewer shots are the three removed, each in a
narrow walk. LAYOUT's sticky-bar test is asked once per bar a scan, not once
per text node; its answers are the same.

#### Premise drift

- The window is 1040 px wide (src/main.cjs), not 1280; views.json says so.
- The item's "scan once per view per walk" was not taken: every scan stays,
  and the time came from elsewhere. Scans were never the cost (66 scans in
  `agents` take about 6 s).
- The renderer's load() fan-out was left alone: `agents` makes about 435
  calls from the page a run, but its time was the stand-in node, the sleeps
  and `uv run`, not those calls.
- The walk now presses Connect on the slow blog only once the sheet takes a
  new address. Before, it pressed while the refused connect still held the
  sheet, nothing went out, and "a connect closed mid-read never closes the
  sheet opened after it" passed with no connect to close; it now closes a
  real one, and passes.
- Two waits press on the owner coming back to Lore (Grok Bot's unchanged
  save, Instinct's save) rather than on the sheet's ten-second look, as an
  owner returning from that app does.
- `agents` failed a first attempt on two of the PR's runs, both on "…just
  the two things it saved, seen already": Grok Bot's saves were never taken
  as seen on the first visit. The walk now waits for the app to take them
  as seen (`unseen.seen`) before it leaves Inventory, and the check says
  what was seen if it fails again. One later run passed first time; the
  three main runs will say whether that holds.
- XC-108 (#684) landed first: walks.cjs carried a walks-budget note allowing
  480 s. The refreshed `seconds` sum to 246 (from run 42595713224, first
  attempts), so the note is gone.

#### What remains

The two time criteria need three green main runs after merge. On the PR,
`agents` is at about 80 s and the walks step at 160-177 s on a quiet runner,
and both at 128 and 271 s on a loaded one; over 150 s either way, because `agents` still runs alone (XC-084) before the other six,
which take about 80 s two at a time. Status stays `in-progress`.

**Backlog audit (2026-11-12), moved to in-review:** The sleep and wait work
landed in PR #683 (sleeps cut from 139 to 14). The PR's quiet-runner numbers
did not hold on main: the latest three green runs show `agents` at 111-166 s
and the walks step at 248-375 s. The remaining targets depend on runner load
and on XC-084's solo `agents` walk, not on more of this item's approach.
Back to in-review to re-scope the time targets, for example to a median over
N runs, or to tie them to XC-084.

**Prioritization (2026-11-12):** Priority P2 (was P1). Stays in-review.
Before it can be ready: Re-scope the time targets (a median over N main
runs, or tie them to XC-084); blocker APP-270 must close first.
Prioritization flag (not acted on): done except the time targets: #683.
