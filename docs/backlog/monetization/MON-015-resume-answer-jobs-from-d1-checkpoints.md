---
id: MON-015
title: Resume answer jobs from D1 checkpoints
priority: P2
effort: M
component: monetization
status: completed
related: [MCP-003, MON-014]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-18
updated: 2026-08-20
---

## Problem

The paid-answer agent keeps its transcript only in the Worker isolate. If an
isolate or scheduled task ends after payment but before the terminal
`answer_jobs` update, the ticket cannot resume from completed model turns and
eventually fails despite work already performed.

## Proposed approach

Spike the smallest recovery path first: after each completed Pi turn, serialize
the agent messages and turn count into the existing D1 database under the
ticket id. On retry, create a fresh Pi `Agent` with those messages in
`initialState` and continue the loop; remove the checkpoint after the guarded
terminal job update. Reads are safe to repeat, but recovery must not duplicate
the terminal write or charge.

Pi Agent Core includes session abstractions, but its published SQLite adapter
uses Node's `node:sqlite`, which is unavailable in a Cloudflare Worker isolate.
Do not port the full session repository unless the spike proves that restoring
`Agent.state.messages` cannot recover this bounded, one-question job. D1 is
already provisioned and SQLite-backed, so it is the default store; a Durable
Object or Pi `SessionStorage` adapter needs evidence that D1 is insufficient.

## Acceptance criteria

- [x] A Workers test stops an answer job after at least one completed tool turn,
      starts it in a fresh isolate, and the same ticket reaches a terminal
      result from its saved transcript.
- [x] Recovery does not create a second ticket, repeat payment, or overwrite a
      terminal job; token, tool-call, and `cost_usd` telemetry covers all
      attempts without double-counting the restored transcript.
- [x] Checkpoints contain no owner-private memories or credentials and have a
      bounded retention policy for abandoned jobs.
- [x] The implementation uses the existing D1 binding and Pi state restoration,
      unless the spike records a concrete missing recovery guarantee that
      requires a Cloudflare-specific Pi session adapter.
- [x] The dependency/runbook notes state that Pi's packaged SQLite adapter is
      Node-specific and is not directly usable in the Worker runtime.

## Notes

Pi's `sessionId` option is only forwarded to model providers for caching; it is
not durable session storage. The reusable pieces here are `initialState`,
`agent.state.messages`, lifecycle events, and—only if needed—the harness
session interfaces.

Implemented with one `answer_checkpoints` table in the existing D1 binding.
Each completed turn replaces the ticket's transcript, turn count, and viewed
publication ids; terminal and stale jobs delete it. Checkpoints expire after 15
minutes and schema initialization purges expired rows. The Workers test
stores a post-tool checkpoint, aborts every live Durable Object, and resumes the
same ticket through a newly instantiated `LorePaidMCP` and Pi `Agent`.
