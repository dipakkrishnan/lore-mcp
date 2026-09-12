---
id: APP-106
title: Keep a fully-rendered card response and its follow-up turn across a quit
priority: P2
effort: M
component: desktop-app
status: in-progress
related: [APP-018]
blockers: []
dependencies: []
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/256
created: 2026-09-12
updated: 2026-09-12
---

## Problem

A fully-rendered card response and the agent turn that followed it are lost
after a normal quit and relaunch, but only when the owner's answer came from
a button/card (a `respond()`-driven turn) rather than typed text.

Reproduced on a "Not now" decline of the Cloudflare sign-in card during
"Open your store": before quitting, ten turns had rendered on screen,
ending in a fully-rendered follow-up card ("Pause here" / "Try sign-in
again"). The owner navigated back to Today (confirming Unfinished status)
before quitting — this was not an interrupted, mid-flight state. After
relaunching and resuming the same task from Today -> Unfinished, the
replayed thread stops one turn earlier: the owner's "Not now" answer and the
entire follow-up card are simply absent, as if they never happened. The
thread ends with an empty composer and no next action.

Resuming now re-presents a stale prompt ("please sign in...") with no memory
of the decline, so the owner doesn't know whether to retype the answer or
what state the task is actually in.

## Proposed approach

Unclear — needs investigation, but scoped by what's already known:
`ipcMain.handle("agent:respond", ...)` in `src/main.cjs` resolves the
pending promise for the request id and nothing else — the actual
persistence of the response value and the turn it produces happens
somewhere downstream in the agent/session-recording path (`src/agent.mjs`),
the same path `APP-018`/`APP-105` already touch for session durability. The
suspected shape of the bug: whatever writes a turn to the on-disk session
for a card/button answer either fires after the promise resolves without
being awaited before the process can exit, or a `respond()`-driven turn is
recorded through a different, less durable path than a typed message. Worth
checking specifically whether button-response turns share the same "durable
history" write `agent.mjs` already does for message-driven turns (see the
comment at `agent.mjs:406` "Durable history for the one task that produces
memories") or bypass it.

## Acceptance criteria

- [ ] A fully rendered card response (e.g. "Not now") and the agent turn it
      produces survive a normal app quit and reappear on relaunch
- [ ] Root-caused specifically for button/card responses (`respond()`), not
      just free-text messages, since that's the turn type that was lost
- [ ] A regression test covers a `respond()`-driven turn surviving a
      simulated quit/relaunch, alongside the existing message-driven case

## Notes

Cataloged from GitHub issue #256. Screenshots of the repro are on the issue,
available on request from the reporter.
