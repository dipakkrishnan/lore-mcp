---
id: APP-106
title: Render plain-text attended-tool results in resumed thread history
priority: P2
effort: S
component: desktop-app
status: completed
related: [APP-018, APP-107]
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
again"). After relaunching and resuming the same task, the replayed thread
stops one turn earlier: the owner's "Not now" answer and the follow-up card
are simply absent, as if they never happened.

Root cause (confirmed by reading, not guessed): `LoreAgent.history()`
(`src/agent.mjs`) rebuilds a resumed thread from each session message. For a
`toolResult` message it calls `toolResultJson()`, which is `JSON.parse` on
the tool's text content, then only renders a line for three tool names:
`ask_user`, `propose_memories`, `propose_blueprint`. `cloudflare_login`,
`open_url`, and `store_secret` (`#cloudflareTool`/`#openTool`/`#secretTool`)
all answer in a plain English sentence, e.g. `"The owner chose not to sign
in to Cloudflare right now."` — never valid JSON, so `toolResultJson`
returns `null` and the result is dropped via `if (!result) continue;`.
`propose_price`'s result *is* valid JSON but had no matching `else if`
branch either, so it was dropped the same way. This reproduces on every
replay of one of these four tools' results, deterministically — not only
when a quit happens to race a write, which is what the original report
suspected.

## Proposed approach

Extend `history()`'s `toolResult` branch: recognize `cloudflare_login`,
`open_url`, and `store_secret` as plain-text results (render
`message.content[0].text` directly, skipping `toolResultJson`) and add the
missing `propose_price` branch alongside the existing three JSON-shaped
cases.

## Acceptance criteria

- [x] The owner's answer to a `cloudflare_login`/`open_url`/`store_secret`
      card (e.g. "Not now") survives a resume and reappears in the replayed
      thread, in addition to `propose_price`'s outcome
- [x] Root-caused specifically for these plain-text-result attended tools,
      confirmed by reading `toolResultJson`'s `JSON.parse` and each tool's
      actual return shape, not just asserted
- [x] A regression test (`app.test.cjs`) covers a declined `cloudflare_login`
      card, an error result, and both branches of `propose_price`,
      alongside the existing `ask_user`/`propose_memories` cases

## Notes

Cataloged from GitHub issue #256. Screenshots of the repro are on the issue,
available on request from the reporter.

This item is narrower than the issue as filed. The issue's turn 11 — a
*second*, still-unanswered card ("Pause here" / "Try sign-in again") that
was on screen but not yet clicked when the owner quit — is not fixed here.
That is a structurally different problem: there is no resolved `toolResult`
to render for a call the owner never answered, so this is about how (or
whether) the app resumes a session whose last message is a dangling,
unresolved `toolCall` at all — likely inside how `session.prompt()` from
`@earendil-works/pi-coding-agent` handles resuming across that boundary, not
a gap in `history()`. Split out as `APP-107` rather than guessed at here;
implementing a fix for it without being able to drive the real Electron app
end-to-end (no Cloudflare/model credentials in this environment) risked
either missing the actual mechanism or destabilizing a shipped resume path.
