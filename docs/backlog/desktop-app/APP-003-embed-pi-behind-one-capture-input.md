---
id: APP-003
title: Embed Pi behind one desktop capture input
priority: P1
effort: M
component: desktop-app
status: in-review
related: [APP-002, CAP-001]
blockers: [APP-002]
dependencies: []
github_issue: null
created: 2026-08-21
updated: 2026-08-21
---

## Problem

The read-only shell can show Lore but cannot provide the agent-guided capture
experience that makes Lore useful. Building a second bespoke assistant loop
would duplicate the Pi runtime already used by the paid-answer path and lose
its model, tool, and lifecycle support.

## Proposed approach

Run Pi Agent Core in Electron's main process and expose one persistent input in
the renderer. Start with the existing attended capture and read/search
capabilities; do not add publishing, payment, or deployment writes in this PR.
Forward Pi lifecycle events only to show real tool and job activity. Store the
provider credential with the operating system's secure storage.

## Acceptance criteria

- [ ] A user can type or use operating-system dictation in one input and
      complete an attended `lore-capture` flow through embedded Pi.
- [ ] Pi runs outside the renderer and exposes only named Lore tools through
      narrow IPC.
- [ ] Tool activity shown in the UI comes from actual Pi lifecycle events.
- [ ] Provider credentials are never stored in Lore SQLite, renderer storage,
      logs, or job payloads.
- [ ] A local test script runs a synthetic capture session and verifies the
      resulting private memory through Lore's real store.

## Notes

Dipak wants to implement a Pi `AskUserQuestion` extension. Keep one small
structured-question seam with a plain-text fallback; do not put Lore workflow
logic inside that extension. Native macOS dictation is sufficient for the
first version, so custom audio capture is out of scope.
