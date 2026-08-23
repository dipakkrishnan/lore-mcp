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
updated: 2026-08-23
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
