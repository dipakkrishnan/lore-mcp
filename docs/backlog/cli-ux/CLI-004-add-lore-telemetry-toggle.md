---
id: CLI-004
title: Add lore telemetry on/off/status and the telemetry_enabled setting
priority: P1
effort: XS
component: cli-ux
status: completed
related: [XC-030, XC-029, APP-058]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-07
updated: 2026-09-12
---

## Problem

`APP-058`'s desktop milestone funnel needs an off switch, disclosed in
Settings, but the desktop app has no preferences store of its own — every
setting lives in the `settings` table in `~/.lore/lore.db` and the app never
writes SQLite directly (`docs/desktop-app.md`'s first rule: "All writes go
through `lore` CLI subcommands so the Python validation paths stay
authoritative"). There is currently no CLI command or settings key for
telemetry at all.

## Proposed approach

Mirror the existing `answer_enabled`/`lore answer on|off` pattern
(`lore/cli.py:answer_enable()`) exactly: a new `telemetry_enabled` settings
key, default `true` (the opt-out stance `XC-030` settles on), and a new
`lore telemetry on|off|status` subcommand. Surface `telemetry_enabled` in
`lore/snapshot.py:build()`'s output so `lore desktop-state` carries it and
Settings can render both the toggle and the plain-language disclosure
`PRIVACY.md` now states.

## Acceptance criteria

- [x] `lore telemetry off` sets `telemetry_enabled` to `false`; `lore
      telemetry on` sets it back to `true`; `lore telemetry status` prints
      the current value.
- [x] `telemetry_enabled` defaults to `true` for a fresh install and appears
      in `lore desktop-state`'s output.
- [x] Desktop Settings can read and flip this value through the existing
      snapshot/CLI-subcommand pattern, with no new IPC path that bypasses
      the CLI.
- [ ] Setting it off actually stops the desktop app from sending milestone
      events (verified once `APP-058` implements the emitter).

## Notes

**2026-09-07:** Filed alongside `XC-030`, `MON-020`, `MON-021`, and `XC-029`.
Blocks `APP-058`, which needs this switch to exist before it can send
anything by default.

**2026-09-12:** Implemented the setting, the `lore telemetry on|off|status`
subcommand, and the `lore/snapshot.py:build()` surface, mirroring
`answer_enabled`/`lore answer on|off` exactly per the proposed approach.
Marked `completed` even though the fourth acceptance criterion stays
unchecked: it names its own precondition ("verified once `APP-058`
implements the emitter") and `APP-058` has not landed yet, so there is no
emitter to verify against. This item unblocks `APP-058`, not the reverse —
`APP-058` still owns actually calling `lore telemetry status` and stopping
milestone events when it's off. No desktop UI (Electron) changes made; the
Settings-tab wiring is `APP-058`'s to do against this CLI/snapshot surface,
per the third criterion's own wording ("can read and flip," not "does").
Local `ruff`/`mypy`/`unittest` could not be run in this session (tool
sandboxing blocked all `python3`/`uv run` invocations); CI runs all three on
push, unchanged from every other PR in this repo.
