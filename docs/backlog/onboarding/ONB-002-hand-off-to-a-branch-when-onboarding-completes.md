---
id: ONB-002
title: Hand off to a named branch when onboarding completes
priority: P1
effort: S
component: onboarding
status: in-review
related: [ONB-003, DEP-001, MON-008]
blockers: []
dependencies: []
github_issue: null
created: 2026-07-30
updated: 2026-07-30
---

## Problem

`lore-onboard` ends at step 6 by running `lore status`, `lore blueprint show`, and
`lore review`, then telling the owner that "the schedule runs itself from here."
That is where the experience stops. The owner has a populated private library, a
recurring synthesis task, and no stated next move.

The capture phase itself is fine — it does the job it was built for. The gap is
the boundary at the end of it: there is no point at which Lore names what the
owner can now *do*, so deploying, charging for answers, or even just kicking the
tires are all undiscoverable unless the owner already knows they exist.

## Proposed approach

Add an explicit handoff menu as the final step of `lore-onboard`, offering four
branches, per `docs/full-service-onboarding.md`:

- **Nothing / Done** — exit cleanly; tell the owner how to return later.
- **Test / Eval** — hand off to `lore-test` (`ONB-003`).
- **Deploy** — hand off to `lore-deploy` (`DEP-001`).
- **Monetize** — hand off to `lore-enable-payments` (`MON-008`).

Presented as one structured choice, with each branch's concrete next action and
cost on one line — including that Deploy and Monetize both need external
accounts. Handoff passes the blueprint and profile as context so no branch
re-asks anything already captured.

Each branch taken is recorded as history in a dedicated handoff state file
(`$LORE_HOME/automation/handoff.json`) — deliberately *not* the onboarding
checkpoint, which `lore profile` validates and consumes; foreign keys in that
file risk failing validation or leaking into `profile.json`. A history rather
than a single choice also means taking Test today never hides Deploy next month.
The menu is reachable independently of onboarding so an owner who chose Nothing
can return months later without re-running setup.

Two framing constraints that are part of the work, not polish: "Nothing" is an
equal option rather than a decline, and Deploy/Monetize are independent of each
other — the menu must not present either as a prerequisite for the other.

## Acceptance criteria

- [ ] Completing `lore-onboard` presents the four branches as a single structured
      choice, each with its next action and cost stated in one line
- [ ] Picking Test / Eval, Deploy, or Monetize hands off in the same conversation,
      passing blueprint and profile forward; no branch re-asks a captured answer
- [ ] Picking Nothing / Done exits and states how to reopen the menu later
- [ ] Branches taken are recorded as history in a handoff state file separate from
      the onboarding checkpoint `lore profile` validates; a resumed session skips
      finished branches without hiding the rest
- [ ] The menu can be reached without re-running onboarding
- [ ] An owner who chooses Nothing is never re-prompted by a later Lore run

## Notes

Transposed from Shane's 2026-07-30 paper sketch; design in
`docs/full-service-onboarding.md`.

The branch skills do not all exist yet, and this item deliberately does not block
on them: the menu ships with unavailable branches labelled as such rather than
hidden, so the shape of the product is visible before every branch is built. The
alternative — waiting for `DEP-001` and `MON-008` — leaves the current dead end in
place for the whole interval.

One real ordering problem is unresolved and belongs to whoever prioritizes this:
an owner who picks Deploy with zero publications gets a node that answers
nothing, and the fix is `XC-002`'s publish flow, which is `in-review` and unbuilt.
Detecting the empty case and steering to it is cheap; steering to something that
does not exist is not useful. See the open follow-ups in the design doc.
