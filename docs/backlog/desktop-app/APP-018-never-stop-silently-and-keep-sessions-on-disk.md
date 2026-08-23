---
id: APP-018
title: Never stop silently, and keep agent sessions on disk so a thread survives a restart
priority: P0
effort: S
component: desktop-app
status: completed
related: [APP-017, APP-004, APP-003, APP-007]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-23
updated: 2026-08-23
---

## Problem

Two things made "Let's set up my Lore" feel like it randomly died. First,
pi ends the turn the moment a blocked tool result carries `terminate: true`
(`pi-agent-core` `shouldTerminateToolBatch`), and the desktop policy set
that on every block, including the owner declining a card — so a turn whose
first move was a bash call produced no text at all and the owner saw their
own line followed by nothing. Second, `agent.mjs` created every pi session
with `SessionManager.inMemory`, against `docs/desktop-app.md` ("Pi Agent
Core (persistent session)"): the thread vanished on every relaunch, an
unfinished setup could not be resumed, and there was no transcript to
diagnose a dead turn from. pi persists sessions as JSONL by default and
offers `create` / `continueRecent` / `open` / `list`; Lore had opted out.

## Proposed approach

Reserve `terminate` for out-of-policy commands and emit a visible
`stopped` line when it fires; an owner's "Not now" becomes a plain refusal
the model can respond to. Persist sessions per task under
`$LORE_HOME/.pi/sessions/<task>/`; `setup` continues its most recent file,
`capture` and `publish` start fresh. When a continued session ends on an
assistant message with unanswered tool calls (the app was quit mid-card),
append an error tool result so the next prompt is well-formed. Expose
`history(task)` over IPC, rebuilt from the session file (owner lines from
user messages and `ask_user` answers, Lore lines from assistant text), and
restore the setup thread on launch while setup is incomplete; a resumed
session is prompted without the skill prefix.

## Acceptance criteria

- [x] An out-of-policy command blocks, terminates the turn, and shows an
      attention-colored "Lore stopped…" line with the composer focused.
- [x] Declining an approval card blocks without ending the turn; the model
      gets a reason that tells it to ask how to continue.
- [x] Sessions are written under `$LORE_HOME/.pi/sessions/<task>/`; setup
      resumes its most recent file; capture/publish start fresh.
- [x] A session cut off on a tool call gets an error tool result appended
      before it is continued.
- [x] `history("setup")` returns owner and Lore lines from the file, and the
      renderer restores them on launch while `profile_configured` is false.
- [x] Desktop typecheck and tests pass.

## Notes

Verified by unit test against real `SessionManager` files; the live path
(`createAgentSession` over a persisted manager) is pi's documented SDK usage
and was not exercised in dev because the dev-mode credential store on this
Mac is empty. First packaged run after merge should confirm
`~/.lore/.pi/sessions/setup/*.jsonl` appears after one reply, and that quit
→ relaunch shows the thread. A diagnostic win: dead turns now leave a file.
Follow-ups: list old sessions somewhere in the shell (the Claude Code
desktop lesson — persisted but unlisted reads as fragile); Task rows on
Today are the APP-020 design work.
