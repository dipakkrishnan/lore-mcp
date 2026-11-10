---
id: XC-129
title: Move Lore to the Pi 1.x line without changing how a paid answer runs
priority: P2
effort: M
component: cross-cutting
status: ideation
related: [MON-017, APP-003]
blockers: []
dependencies: ["@earendil-works/pi-agent-core 1.x", "@earendil-works/pi-ai 1.x", "@earendil-works/pi-schema", "a @cloudflare/vitest-pool-workers release that supports vitest 5 (only for the coverage bump)"]
github_issue: null
created: 2026-11-09
updated: 2026-11-09
---

## Problem

Dependabot offers the Pi packages' first 1.x release (1.5.0), and Lore can't take it by merging the bump. Dependabot #687 (lore/node, `pi-agent-core` and `pi-ai` 0.84.2 to 1.5.0, plus `@vitest/coverage-istanbul` 4.1.12 to 5.1.0) fails four CI jobs (Node lint, Node compiler checks, Node component tests, Worker smoke test), and bundle #693 left it out. Two separate things are wrong, and they need different fixes.

**1. The coverage bump can't install (verified).** `@vitest/coverage-istanbul` 5.1.0 has the peer dependency `vitest: 5.1.0`. The newest `@cloudflare/vitest-pool-workers`, 0.23.0, which `lore/node` uses, has `vitest: ^4.1.0`. #687's Node lint, compiler, component and Worker smoke jobs all stop at `npm ci` with `ERESOLVE` on exactly that pair, before any code compiles. No code change fixes it: the coverage bump has to wait for a pool-workers release that accepts vitest 5, or be dropped from the group.

**2. The Pi bump breaks the paid-answer agent's source (verified in the published packages; CI never reached it).** `lore/node/src/answer.ts` and `answer-tools.ts` use three things that 1.5.0 no longer has:

- `Type` is imported from `@earendil-works/pi-ai` in `answer-tools.ts`, for the `view`, `search`, `submit` and `refuse` tool parameters. 1.5.0's pi-ai no longer re-exports TypeBox. Tool schemas now come from the new `@earendil-works/pi-schema` (`obj`, `str` and so on), and tool arguments are validated there, so TypeBox-only features (`Type.Refine()`, codecs) stop applying. Our schemas use `minLength` and `minItems`, which are plain JSON Schema, but they need a check.
- `toolChoice: "any"` or `"required"` is set in `answer.ts` (the `streamFn`). In 1.5.0's pi-ai, `SimpleStreamOptions.toolChoice` is typed `"auto" | "none"`. Lore forces a tool call on every turn so that a paid answer always ends in `submit_answer` or `refuse`. With only `"auto"` the model may answer in plain text and the job would end with no outcome.
- `shouldStopAfterTurn` is passed to `new Agent(...)` in `answer.ts` to cap the run at `MAX_MODEL_TURNS` (6) and to stop once an outcome exists. It is declared in `pi-agent-core` 0.84.2 and absent from 1.5.0's type declarations. 1.5.0 has a `terminate` hint on tool results, but it only ends the loop when every result in a tool batch sets it, so it is not a drop-in replacement for a turn cap.

The second problem is a behaviour change on a path buyers pay for, not a type fix: the forced tool call and the turn cap are what keep a paid answer from running long or ending empty (MON-017 refuses answers the node can't run, but it doesn't cover these).

## Proposed approach

Split it, so the safe part isn't held up by the hard part:

1. **Drop the coverage bump from the Pi group.** Tell dependabot to ignore `@vitest/coverage-istanbul` 5.x (or group it separately) until `@cloudflare/vitest-pool-workers` supports vitest 5. Then #687's Pi bumps can be tried on their own.
2. **Port the tool schemas.** Replace `Type.*` in `answer-tools.ts` with pi-schema builders; keep the same JSON Schema (`minLength: 1`, `minItems: 1`). Add a test that feeds each tool the bad arguments it must reject (empty `query`, empty `cited_publication_ids`) and confirms the model-visible error still tells it what to fix.
3. **Keep the forced tool call.** Find what 1.5.0 offers for requiring a tool call: check the provider adapters' own options (Anthropic `any`, OpenAI `required`) and whether `streamSimple` passes provider-specific options through. If nothing supported can force it, the fallback is to detect a turn with no tool call and re-prompt once, then fail the job as a refusal. Do not ship with `"auto"` alone.
4. **Keep the turn cap.** Reproduce "stop after an outcome or after 6 turns" with what 1.5.0 has (a tool result that sets `terminate` when the outcome is submitted, plus the checkpointed `turns` count checked before `agent.continue()`), or by aborting from the `turn_end` subscriber that already counts turns.
5. **Check it against a live model**, on a throwaway Cloudflare account and a model key, for the Anthropic and OpenAI paths `resolveModel` supports: a question that is answered, one that is refused, and one with nothing relevant. Confirm the run ends in an outcome within the cap each time, and that a resumed checkpoint (`agent.continue()`) still works.
6. **Roll out by itself**: one PR touching `lore/node/src/answer*.ts` and the package pins, nothing else. `lore/node/package.json` pins both packages exactly (`0.84.2`), so rolling back is reverting that one commit and the lockfile.

## Acceptance criteria

- [ ] The coverage bump no longer rides in the Pi group: either ignored in dependabot config or held until pool-workers supports vitest 5.
- [ ] `lore/node` builds, lints and passes its unit and component tests on `pi-agent-core` and `pi-ai` 1.x with exact pins.
- [ ] The four answer tools' parameters come from pi-schema, and their rejection of empty or missing arguments is covered by tests.
- [ ] A paid answer still requires a tool call every turn, with a test that fails if the model replies in plain text and the job ends without an outcome.
- [ ] A paid answer still stops after an outcome or after six turns, with a test for each, including a run resumed from a checkpoint.
- [ ] A run against a live model on each supported provider ends in `submit_answer` or `refuse` within the cap.
- [ ] The app/desktop Pi bump (#663, `pi-coding-agent` 0.87.1 to 1.5.0) is checked against the same breaking changes, or tracked here if it needs its own change.

## Notes

**Verified** (against #687's release notes and the 0.84.2 and 1.5.0 packages as published on npm, unpacked and read):

- The ERESOLVE failure and both peer ranges above. #687's Node jobs fail at install, so CI says nothing yet about the code.
- `shouldStopAfterTurn` is declared in `pi-agent-core` 0.84.2 (`dist/types.d.ts`) and not in 1.5.0.
- pi-ai 1.5.0 types `toolChoice` as `"auto" | "none"`.
- pi-ai no longer re-exports TypeBox (`Type`, `Static`, `TSchema`), `typebox` is no longer a dependency, and tool parameters are any JSON Schema typed through `@earendil-works/pi-schema` (#687's release notes).
- `lore/node/package.json` pins both packages exactly at `0.84.2`. The existing tests that import these packages (`answer.test.ts`, `answer-tools.test.ts`) only import types such as `AgentMessage` and `AgentTool`, and a grep of both finds no mention of `toolChoice`, `shouldStopAfterTurn` or `MAX_MODEL_TURNS`. Read them before relying on that: if neither covers the forced tool call or the turn cap, a green run on 1.x would not prove those behaviours survived.

**Not verified:**

- Whether provider adapters in 1.5.0 still accept `"any"`/`"required"` when passed through `streamSimple` despite the narrower type, or ignore them silently. The type says `"auto" | "none"`; the runtime behaviour was not tested.
- What else changed between 0.84.2 and 1.5.0 beyond the notes in #687's body, which GitHub truncated. Read the full changelog before starting.
- Whether `terminate` can be used to end the loop once an outcome is stored.

**The desktop app is on the same line but a different version.** `app/desktop` depends on `pi-ai` and `pi-coding-agent` at `^0.87.1` (installed 0.87.1), and #663 bumps `pi-coding-agent` to 1.5.0. It imports `Type` from `pi-ai` in `src/agent.mjs` and defines tools with `defineTool`, so it is likely affected by the same TypeBox move, though it does not set `toolChoice` or `shouldStopAfterTurn`. #663 is in the combined dependabot PR #690; whoever merges that should check whether its desktop checks really exercise `agent.mjs`'s tools before relying on a green run.

Nothing here is urgent: 0.84.2 works, and the answer path is pinned exactly so it won't move on its own.
