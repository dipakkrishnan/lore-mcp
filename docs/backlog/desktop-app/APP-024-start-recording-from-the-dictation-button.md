---
id: APP-024
title: Start recording from the dictation button
priority: P1
effort: M
component: desktop-app
status: in-review
related: [APP-003, APP-005, APP-009, APP-010, APP-020]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-23
updated: 2026-11-12
---

## Problem

The microphone button looks actionable but only focuses the composer and
explains the macOS Dictation shortcut. Clicking it should start recording;
the current behavior feels broken and makes voice capture harder to discover.

## Proposed approach

Use macOS speech recognition behind the existing button. One click starts
recording, a visible state makes that unambiguous, and a second click stops.
Put the transcript into the existing editable composer without submitting it.
Keep the operating-system Dictation shortcut as the fallback when recognition
is unavailable or permission is denied.

Prefer on-device recognition when the Mac supports it. Do not retain raw audio
or add voice conversation, text-to-speech, a cross-platform abstraction, or a
hosted transcription service in this item.

## Acceptance criteria

- [ ] Clicking the microphone requests permission if needed and starts
      recording; clicking it again stops.
- [ ] Recording has a visible state and an accessible label.
- [ ] The transcript lands in the existing composer and remains editable; it
      is never submitted automatically.
- [ ] Permission denial or unavailable recognition produces a useful fallback
      to macOS Dictation.
- [ ] Raw audio is not persisted, and the UI states whether recognition is
      on-device or needs the network.
- [ ] The packaged app declares the required macOS permissions and tests the
      permission, transcript, stop, and failure boundaries.

**Prioritization pass 2026-08-26:** No blockers, scope explicitly excludes TTS/cross-platform/hosted transcription. Promoted `in-review` → `ready`.

## Notes

**Delivery loop plan review (2026-11-12):** Moved back from `ready` to
`in-review`. Three implementation plans were written and each was
rejected by a plan reviewer that checked it against the code; the open
issues did not shrink between rounds, which suggests the item is
under-scoped as written. The reviewer's last open issues are below.
Labels such as "Test 2" or "R3" refer to that rejected plan, which
was not kept; the facts about the code stand on their own.

- The dark screenshots won't be dark. The plan runs
  `LORE_EDGE_APPEARANCE=dark node support/walks.cjs store` and attaches the
  dark dictate-listening shot and a dark idle composer. But the store walk
  switches itself back to light at app/desktop/support/edge.cjs:795-799
  (`setAppearance("dark")`, shot inventory-rows-dark, then
  `setAppearance("light")` with the check "…and back to light"). That
  happens before the Record a memory / dictation section at about :866. The
  window boots dark, but everything after :798 is drawn light, including
  talk-listening, the new dictate-listening shot and root-capture-joined.
  The PR would attach light images labelled dark. Fix: take the dark shots
  another way. For example, flip to dark around the new step the way
  :795-799 does for inventory-rows-dark, and register the shot under
  views.json `dark.shots`. Or take the dark screenshots by hand as described
  in the next issue.
- The UI process doesn't follow design-review step 3 or design-principles
  'How to check' step 1. Both require a dark-mode screenshot of every
  changed screen at 1440x900, from a dev launch whose LORE_HOME is a copy of
  ~/.lore. The plan uses walk captures on seeded data at 1040 and 900
  instead, which are also light (see the first issue). The walk shot is a
  good layout check, but it doesn't replace the screenshots the skill asks
  for. The plan should either take the 1440x900 dark dev-launch screenshot
  of the button-path listening bar with the idle composer, or name the
  deviation as a known gap in the PR as design-review step 5 allows. As
  written, the plan says to run design-review but leaves out the evidence
  step it requires.
- The new walk step can race with the earlier Esc. The existing check "Esc
  stops listening and sends nothing" passes as soon as
  `!composer.dataset.mode`. cancelDictation (renderer.js:~6810) clears the
  mode synchronously through talk.end(), then awaits `active.stop()` (track
  stop plus `context.close()`), and only after that calls
  `dictationMode(null)` and `input.focus()`. If the walk clicks #dictate
  right after that check, the old cancel can finish after the new
  startDictation has set `dictationMode("listening")`. Its
  `dictationMode(null)` then wipes the listening bar while a recorder is
  still running, and the step's data-mode, text and aria-label checks become
  timing-dependent. Fix: before clicking #dictate, wait for the first cancel
  to finish (for example `document.activeElement ===
  document.querySelector('#capture-input')`, which cancelDictation sets
  last, or the existing `idle()`).
