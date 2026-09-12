---
id: APP-107
title: Resuming a session cannot re-ask its last unanswered card
priority: P2
effort: L
component: desktop-app
status: in-review
related: [APP-106, APP-018]
blockers: []
dependencies: []
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/256
created: 2026-09-12
updated: 2026-09-12
---

## Problem

Split out of `APP-106` (issue #256). The reported repro's turn 11 is a card
("What would you like to do next?" — "Pause here" / "Try sign-in again")
that had fully rendered but was not yet clicked when the owner quit and
relaunched. After relaunch, the task shows as `needs_you`/"Ready to resume,"
but nothing re-presents that question: `LoreAgent.history()` can only
render a *resolved* `toolResult`, and there isn't one for a call the owner
never answered — the session's last entry is a dangling, unresolved
`toolCall`. The owner sees an empty composer and no next action.

`resumeTask()` (`src/renderer.js`) currently papers over this by sending a
synthetic `"Let's pick up where we left off."` user message. Whether that
actually works depends on how `session.prompt()` (from
`@earendil-works/pi-coding-agent`, in `node_modules`, not this repo) handles
a session whose last message is an assistant `toolCall` with no matching
`toolResult` — most model APIs reject a new user turn appended directly
after an unresolved tool_use block, so this may currently error, silently
re-ask nothing, or behave in some other undocumented way. Needs to be
observed against the real SDK/model, not guessed at from the app side alone.

## Proposed approach

Unclear — needs investigation against the actual `@earendil-works/pi-coding-agent` behavior, ideally by driving a real resume through a dangling
`ask_user`/`cloudflare_login`/etc. call (ask/check with whoever owns that
package, or trace `AgentSession`'s resume path in
`node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js`
starting from where it appends `toolCall` messages). Two shapes seem
possible: (a) the SDK already synthesizes a cancelled/aborted `toolResult`
for a dangling call before accepting a new user message, in which case the
fix is just making sure the resulting fresh card reaches the owner visibly;
or (b) it doesn't, in which case `resumeTask()`'s current
"pick up where we left off" message may be silently failing today and needs
its own explicit closing-out step (e.g. resolve the dangling call with a
"the owner was away" value before sending the resume prompt).

## Acceptance criteria

- [ ] A task resumed after quitting with an unanswered card presents that
      card again (or an equivalent fresh question), rather than an empty
      composer with no next action
- [ ] Reproduced and root-caused against the actual resume path (real
      session file with a dangling `toolCall`, real `session.prompt()`
      call), not asserted from reading app-side code alone
- [ ] A regression test covers resuming a session whose last message is an
      unresolved `toolCall`

## Notes

Split from `APP-106` during its implementation (2026-09-12): that item
fixed a confirmed, deterministic bug in how `history()` renders *resolved*
plain-text tool results, which is unrelated to this item's problem (there is
no resolved result to render here at all). This item likely needs someone
who can drive the packaged Electron app end-to-end with real credentials, or
who has visibility into `@earendil-works/pi-coding-agent`'s resume
semantics, since it may live partly outside this repo.
