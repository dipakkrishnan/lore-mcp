---
id: APP-016
title: Keep the conversation legible — echo the owner, card every question, one status
priority: P1
effort: S
component: desktop-app
status: completed
related: [APP-003, APP-009, APP-015]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-23
updated: 2026-08-23
---

## Problem

During onboarding the model asked "What name should I use for your Lore?"
in prose and ended its turn — no card, so nothing invited a reply. The
owner typed "dipak" into the composer, which did continue the session, but
the log never showed their reply, so the thread read as Lore talking to
itself and the owner concluded "nothing happened". Meanwhile the "Lore is
thinking…" pill sat under the title on every view, including Settings,
where it carried no information. Separately, the store address linked to
the node's `/mcp` endpoint, which answers a browser with a JSON-RPC error.

## Proposed approach

Echo every owner message into the log as a "You" line. Tell the model to
ask everything through `ask_user` — open questions included, with likely
answers as options and free text always available — and never to end a
turn with a question in prose. Retire the pill: the live line from APP-015
already shows progress where the conversation is, so it becomes the only
status, seeded with a task phrase before the first stream arrives. Change
the composer placeholder to "Reply to Lore…" while a setup or publish
session is active. Make the store address copyable text; the Cloudflare
link stays the one link.

## Acceptance criteria

- [x] Owner messages appear in the log, visually distinct from Lore's.
- [x] The system prompt requires `ask_user` for every question and forbids
      ending a turn on a prose question.
- [x] No "Lore is thinking…" pill on any view; Today's live line shows a
      task phrase until the first streamed text replaces it.
- [x] The composer reads "Reply to Lore…" while a setup/publish session is
      active and "What did you learn today?" otherwise.
- [x] The store address is selectable text, not a link to `/mcp`.
- [x] Desktop typecheck and tests pass.

## Notes

The model's interpretation of "dipak" as a greeting rather than the name is
a prompt-compliance problem the `ask_user` rule addresses at the source; a
card with a text field leaves no ambiguity about what the answer is for.
Owner lines are kept with Lore's in the same eight-line log.
