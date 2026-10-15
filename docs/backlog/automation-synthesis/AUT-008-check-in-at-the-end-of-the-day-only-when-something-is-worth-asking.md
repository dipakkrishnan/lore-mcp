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
- The check-in is one of Lore's own routines in `automation.Routines`
  (default weekdays at 6 PM, on with no profile needed).
- `lore automation run checkin` reads every connected app and hands back the
  items imported since the last check-in. It tracks the newest memory id it
  has seen, not `created_at`, because imports are dated by their source. With
  no items, no model runs and nothing is posted.
- Otherwise the quiet `checkin` task (skill `lore-check-in`, tools read/bash/
  `check_in`) runs after any readings and returns `{reach_out, why,
  questions}`. `checkin.cjs` posts only when `reach_out` is true, keeping at
  most three non-blank questions about items Lore actually brought in today,
  and at most once a day.
- A post means one notification ("Five minutes on today?" plus the first
  question), a dock badge of 1, and a Check in card that leads Today. The card
  and the notification open the `evening` thread with the questions shown.
- The owner's first reply carries the questions to the agent (lore-capture),
  so answers are saved only through propose_memories approval.
- Not today, or the next run, expires an unanswered check-in.
- Pause and retime: `lore automation pause|resume|time checkin`, saved in
  routines.json. The buttons are in APP-200.
- Not built: "after three ignored check-ins in a row, ask once whether to
  keep checking in". It was in the approach but not in the acceptance
  criteria; follow-up.
- Edge walks: `support/edge.sh checkin` and `support/edge.sh quiet`.
