---
id: APP-022
title: Build the blueprint visibly during the evidence scan
priority: P2
effort: M
component: desktop-app
status: completed
related: [APP-020, APP-021, APP-009]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-23
updated: 2026-09-22
---

## Problem

During onboarding the thread shows a history of the owner's answers as
"You" lines, but the thing being made — the blueprint, then the profile —
is invisible until the final card. Dipak (2026-08-23): "it'd be really
cool if you could see the agent almost cobbling together the profile and
blueprint AS we go... a 'smart' blueprint being built in an animated, fun
way."

## Proposed approach

Animate the *evidence scan*, not a replay of the owner's answers: with
propose-first onboarding there are only one or two cards, so the show
happens while Lore reads the agents' memories. A ghost blueprint panel
(name, told-as, topics, depth, voice) sits above the thread; as the scan
progresses, topics pop in one by one ("lore-mcp… deep-review… learner"),
depth markers appear, and the owner watches the guess form before being
asked anything. The panel derives only from typed events the kernel
already emits (task records, tool progress, the propose_blueprint
payload) — no prose parsing, no new model output format. The final
approval card is the same panel switched to confirm mode, so there is one
component and one source of truth. Motion stays restrained: fields settle
into place; nothing celebratory; reduced-motion respected.

## Acceptance criteria

- [x] During the evidence scan, the ghost panel fills field by field from
      typed events; the owner sees the proposal form before any question.
- [x] The approval card is the panel in confirm mode — one component.
- [x] No prose parsing; reduced-motion honored; nothing animates after the
      panel is settled.

## Notes

Filed from mid-dogfood feedback, rescoped 2026-08-23 after review: the
original "animate as answers land" framing had little to animate under
propose-first onboarding. This is also the strongest launch-demo moment —
an agent visibly assembling your professional shape from your own history.
Pairs with APP-021's brevity rule: the panel carries state so messages
stay short.

**2026-09-22, implemented.** `propose_blueprint` is the only tool call the
setup skill makes with the blueprint's exact fields, and pi-ai's Anthropic
adapter already keeps a best-effort parsed `arguments` object on the
tool-call content block through every `toolcall_delta` (see
`@earendil-works/pi-ai`'s `content_block_start`/`content_block_delta`
handling) — that parsed object is what `agent.mjs`'s `session.subscribe`
now reads to emit a new `blueprint-progress` AgentEvent, never the
streamed assistant prose. `renderer.js` adds a `blueprintPanel(fields,
mode)` function that is the one component behind both modes: in `"live"`
mode it builds the ghost row nodes exactly once (on the first
`blueprint-progress` event for a thread) and thereafter only patches each
field's `textContent` and flips its wrapper from a `pending` to a
`settled` class the first time it gets a value — so the CSS settle
transition (`blueprint-settle`, paired with a `prefers-reduced-motion`
override per this file's existing convention) plays exactly once per
field, however many more deltas stream in afterward for it or any other
field. `renderRequest`'s existing `"blueprint"` branch (the final,
owner-facing confirm card) now calls the same function in `"confirm"`
mode, reusing and reparenting the live ghost node into `#request` when one
exists rather than building a fresh element — same node, mode switched.
A new `#blueprint` slot sits above `#log` in `index.html` to host it
during the scan.

Verified: `npm run check` (tsc --noEmit against the JSDoc types, including
the new `blueprint-progress` AgentEvent variant) is clean, and the full
`npm test` suite (40 tests, all pre-existing) still passes — no
regressions in `agent.mjs`'s tool definitions or the `validBlueprint`/
`executionMode: "sequential"` invariants it already checks. Not verified:
a live dogfood run driving a real `propose_blueprint` call end to end.
Per this repo's own tooling gap (noted going into this item), `renderer.js`
has no automated DOM test coverage at all, and a real run needs an
interactive owner session with real provider credentials — outside what an
unattended pass can safely do. Traced the event flow by hand instead:
`agent.mjs`'s emission shape against `types.d.ts`'s new `AgentEvent`
variant, and the renderer's field-order (`BLUEPRINT_GHOST_ROWS`) against
the confirm form's existing `add()` call order, so the ghost and confirm
layouts land in the same grid position per field
(`.blueprint-fields label:nth-child(4)`/`(7)` full-row spans depend on
that order matching). Worth a real dogfood pass before shipping a release
that includes this.
