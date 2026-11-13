---
id: XC-090
title: Fill the activation funnel's missing steps (agent connected, drafted, any memory saved)
priority: P3
effort: XS
component: cross-cutting
status: in-review
related: [APP-250, XC-085, XC-092, APP-058, XC-067, CAP-036]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-28
updated: 2026-11-13
---

## Problem

Funnel steps with no event: welcome completed, an agent connected to Lore (Claude, Grok, ChatGPT,
Cursor writing to the inbox), and a piece drafted. `memory.saved` fires only on
`lore capture apply`, so memories saved by agents, the inbox, or synthesis are invisible. The CLI
reports version `0.1.0`, which reads like an app build in version breakdowns.

## Proposed approach

Add to the contract, each once per install:
- `welcome.completed`
- `agent.connected{agent: claude|grok|chatgpt|cursor|codex|other}`, fired on the first inbox write
  per client
- `piece.drafted`

Record `memory.saved` on every save path. Add a relay-checked `surface` envelope field
(`app` / `cli`) next to `version`. Update PRIVACY.md's examples if needed.

## Acceptance criteria

- [ ] A fresh-home walk through first run → connect agent → save → draft → approve logs each
      event exactly once.
- ~~`surface` is present on every event and validated by the relay.~~
      Struck: left out on purpose (see Notes); the app sends its own version,
      so the field matters only if a CLI-vs-app breakdown is wanted, as its own item.
- [x] No counts, names, or content in any property.

## Notes

Built (Nov 2): `memory.saved{via: capture|agent|connector|synthesis}` once a day per way in,
`agent.connected{agent}` on an agent's first inbox save, and `piece.drafted`. "Welcome
completed" is covered by APP-250's `app.installed` and the first-run chat's `firstrun.step`.
Left out: the `surface` envelope field. The app already sends its own version
(`LORE_APP_VERSION`), so only a bare-terminal CLI reports `0.1.0`; worth its own item if
that breakdown matters.

From the Oct 27 launch feedback; see `docs/launch-feedback-2026-10-27.md`.

**Prioritization (2026-11-12):** Priority P3 (was P1), effort XS (was S).
Stays in-review. Before it can be ready: Drop the `surface` criterion (file
it separately if wanted) and close; the rest shipped in #635/#636.
Prioritization flag (not acted on): done (except surface).

**Close-out (2026-11-13):** Stays in-review. The surface criterion is struck. Criterion 3 is met:
`lore/usage.py` `EVENTS` gives each event at most one property with a
fixed list of values, and `record` raises on anything else. The relay drops
off-list values and unknown properties (`feedback-relay/test/events.test.ts`,
`test/unit/report-rules.test.ts`). For criterion 1, every emitter is on main
(#635, #636): `app.installed` and `firstrun.step` from the app
(`renderer.js`, `ipc.cjs`), `memory.saved` from `lore capture apply`
(`lore/cli.py`) and from `Registry._import` (`lore/sources.py`, which also
sends `agent.connected`), and `piece.drafted` and `piece.approved` from
`lore/cli.py`. Each is `once`/`first`, or `daily` per way in, and has unit
tests in `tests/test_usage.py` and `tests/test_cli.py`. What remains: the
walk itself has never been recorded. No test or note shows one fresh-home
run (first run, connect agent, save, draft, approve) that logs each event
exactly once. One such run with a scratch `LORE_HOME`, reading
`usage.log`, closes this.
