---
id: AUT-008
title: Check in at the end of the day, only when something is worth asking about
priority: P1
effort: M
component: automation-synthesis
status: completed
related: [AUT-005, AUT-006, APP-200, CAP-001]
blockers: [AUT-006]
dependencies: []
github_issue: null
created: 2026-10-14
updated: 2026-10-14
---

## Problem

Connectors bring in what is already written down: meeting notes, posts,
notes. The judgment behind it (why a call went one way, what surprised the
owner) is the lore an agent cannot find by searching, and nothing in Lore asks
for it. Zane, the first trial seller, said it would be amazing if Lore pinged
him after it had read his day so he could talk to it for five minutes.

A daily ping that fires whether or not there is anything to say gets ignored
after a week, and then turned off.

## Proposed approach

- An "Evening check-in" routine runs at the owner's chosen hour (default 6pm,
  weekdays) on the app's own scheduler (AUT-006). It reads every connected app
  first, then lets AUT-005's reading turn new items into memories.
- The agent then decides whether to reach out. It reaches out only when today's
  new material contains something the library doesn't already explain: a
  decision, a disagreement, a surprise, or a lesson stated without its reason.
  It writes at most three questions, each tied to a specific item. On a day
  with nothing like that, it stays silent: no notification and no badge.
- When it does reach out, it posts one Mac notification that names the actual
  thing ("You pushed back on the pricing call with Acme. Five minutes on
  why?"). It sets the red dock badge, and a "Check in" card leads Today.
  Opening the notification or the card starts a thread with the questions
  already asked.
- Answers go through capture's correction flow (CAP-001). The owner sees what
  will be saved and fixes it before anything is saved. Nothing is published.
- It never nags. There is at most one check-in a day, and none on weekends
  unless the owner opts in. An unanswered check-in expires at the next run
  instead of piling up. After three ignored check-ins in a row, it asks once
  whether to keep checking in.

## Acceptance criteria

- [x] A day with no new items, or only items the library already covers,
      produces no notification, no badge and no card.
- [x] A day with a worthwhile item produces exactly one notification naming
      it, a dock badge, and a Today card that opens a seeded thread.
- [x] Answers become private memories only after the owner approves them.
- [x] One check-in a day at most, and an unanswered one is replaced, not
      stacked.
- [x] The routine can be paused, retimed or turned off (APP-200), and turning
      it off is remembered.
- [x] The decision to stay silent is covered by tests with a stand-in model
      for both outcomes.

## Notes

The "worth asking" judgment is a prompt-plus-rules step, like
`automation.RULES`, with a structured answer (`reach_out: bool`, `questions`,
`why`) so the app, not the model, decides whether anything is posted.
Calendar context would sharpen the questions; see CAP-035.

Oct 14, done:
- The check-in is one of Lore's own routines, `automation.CheckIn` (weekdays
  at 6 PM). It is on when the profile's runner is Lore (`lore profile` sets it
  up); with Claude Code, Codex or no profile it is listed paused until the
  owner turns it on, so no one gets a 6 PM job they did not ask for.
  Superseded by AUT-009: it is on for everyone until paused.
- `lore automation run checkin` reads nothing. It hands back the private
  items an app or agent brought in (`origin='native'`, so never Lore's own
  writing nor the owner's captures) since the last run its model judged, and
  that run's newest id as `mark`. It tracks memory ids, not `created_at`,
  because imports are dated by their source. The app passes `mark` back with
  the result only once the model judged them, so items the model never saw
  are asked about next time.
- Due more than three hours after its hour (Lore was closed or asleep), it
  records "Skipped: Lore wasn't open at 6 PM" and asks nothing.
- With items, the quiet `checkin` task (skill `lore-check-in`, tools read/bash/
  `check_in`) runs after any readings and returns `{reach_out, why,
  questions}`. `checkin.cjs` posts only when `reach_out` is true, keeping at
  most three non-blank questions about items Lore actually brought in, and at
  most once a day. With no items no model runs ("Nothing new to ask about");
  a model that fails, or no agent yet, records "Couldn't look over today".
- A post means one notification ("Five minutes on today?" plus the first
  question), a dock badge of 1, and a Check in card that leads Today. It also
  starts a new `evening` thread whose first message is Lore's questions
  (`LoreAgent.ask`), with a note only the agent sees naming the items. The
  card and the notification open that thread, never an older day's.
- The owner's first reply runs lore-capture, so answers are saved only
  through propose_memories approval. The check-in counts as answered once
  that turn goes through; one that fails leaves it waiting.
- Not today expires it and closes its thread. The next day's run retires an
  unanswered one the same way; a run later the same day leaves it be.
- Pause and retime: `lore automation pause|resume|time checkin`, saved in
  routines.json. A change counts the next run from when it was made. The
  buttons are in APP-200.
- Not built: "after three ignored check-ins in a row, ask once whether to
  keep checking in". It was in the approach but not in the acceptance
  criteria; follow-up.
- Edge walks: `support/edge.sh checkin` (two days, two threads) and
  `support/edge.sh quiet` (silent, then missed by hours).
