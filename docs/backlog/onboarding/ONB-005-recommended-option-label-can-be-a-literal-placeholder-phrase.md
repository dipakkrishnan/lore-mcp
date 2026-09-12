---
id: ONB-005
title: Recommended option label can be a literal placeholder phrase like "Looks right"
priority: P2
effort: S
component: onboarding
status: completed
related: [APP-068]
blockers: []
dependencies: []
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/240
created: 2026-09-08
updated: 2026-09-08
---

## Problem

During a manual test of Scenario 1 (net-new user, `docs/manual-test-walkthrough.md`),
every recommended option on the "Shape your Lore" persona questionnaire
displayed the literal text **"Looks right"** as its visible label (with the
`Recommended` badge), while the actual proposed value only appeared as the
description line underneath — e.g. the label read "Looks right" and the
description read "Software engineer building multi-repository systems and
automation (recommended)". A reader can't tell what they're agreeing to from
the label alone.

Root cause: `plugins/lore/skills/lore-onboard/SKILL.md` ("Confirm in one
pass") instructs the agent building the question to present its draft
"labeled as a proposal (\"Looks right\", plus 2-3 genuinely different
readings)". That phrasing is ambiguous between (a) *characterize* the top
option's tone as a proposal while still giving it a real label, and (b)
literally set the option's `label` field to the string `"Looks right"`. The
agent that produced this run's questions (Codex) took it as (b), and nothing
downstream corrects it: `app/desktop/src/renderer.js` (~L1038-1041) renders
whatever `label` string it's given next to the `Recommended` chip without
validating that it resembles a real answer.

This is distinct from APP-068 (already merged as #219/#221), which added the
`recommended` boolean, preselection, and the chip itself — it says nothing
about what the option's *label text* should be, and shipped before this bug
was found.

## Proposed approach

- Reword the "Confirm in one pass" instruction in `SKILL.md` so the example
  can't be read as a literal label — e.g. require the label to be the real
  value itself, and give a confirmation-phrase counter-example explicitly
  ("Software engineer building multi-repository systems (recommended)" —
  never a bare phrase like "Looks right" standing in for the actual answer).
- Optionally harden `app/desktop/src/renderer.js`'s option rendering: if a
  `recommended` option's `label` matches a short confirmation-phrase pattern
  (e.g. "looks right", "sounds good") rather than resembling an answer, fall
  back to rendering the description text as the label instead.

## Acceptance criteria

- [x] The recommended option's label reads as the actual value in every
      question of the persona-shaping interview, on both the Claude and
      Codex paths.
- [x] `SKILL.md`'s wording no longer permits a literal "Looks right" (or
      equivalent placeholder) as an option label.

## Notes

Cataloged from https://github.com/dipakkrishnan/lore-mcp/issues/240.

Fixed via the prompt-wording change alone (`SKILL.md` §3 "Confirm in one
pass"): the label instruction now requires the actual drafted value with an
explicit counter-example ("never a bare confirmation phrase like 'Looks
right'"), which applies identically on both the Claude and Codex paths since
they share this same instruction text. Did not implement the optional
desktop-side rendering fallback — the bug is a prompt-instruction defect, not
a rendering defect (`renderer.js` correctly displays whatever label it's
given), and the corrected instruction alone satisfies both acceptance
criteria without adding a heuristic string-matching fallback that could hide
a future, different mislabeling instead of surfacing it.
