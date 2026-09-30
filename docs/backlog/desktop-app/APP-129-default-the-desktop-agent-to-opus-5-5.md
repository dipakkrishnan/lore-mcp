---
id: APP-129
title: Default the desktop agent to Opus 5.5
priority: P2
effort: XS
component: desktop-app
status: completed
related: [APP-045]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-29
updated: 2026-09-29
---

## Problem

The desktop agent defaults to `claude-opus-4-8` (APP-045). Opus 5.5 is the
current most capable Claude model, and the owner wants it to be Lore's
default. The pinned pi catalog (0.84.4) doesn't list `claude-opus-5-5`, so
the app couldn't select it even if the model list named it.

## Proposed approach

Bump `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` together
to 0.87.1, the first catalog release that lists `claude-opus-5-5`. Put it
first in the desktop model list, keeping Sonnet 5 and the OpenAI models as
fallbacks, and pin the choice with the existing test against the real
catalog.

## Acceptance criteria

- [x] With an Anthropic credential, a fresh desktop task runs on
      `claude-opus-5-5` without any owner configuration. It is first in
      `MODELS` in `app/desktop/src/agent.mjs`.
- [x] The pi provider catalog resolves `claude-opus-5-5`, proven by a test
      rather than assumed.
- [x] Sonnet 5 and the OpenAI models remain selectable fallbacks.

## Notes

Supersedes APP-045's choice of Opus 4.8. The answer tier's model on a
seller's node (`lore/node/src/answer.ts`, `claude-sonnet-5`) is separate:
the seller pays for each answer, so it stays out of this item.
