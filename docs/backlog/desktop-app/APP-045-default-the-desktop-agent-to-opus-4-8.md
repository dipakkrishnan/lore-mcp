---
id: APP-045
title: Default the desktop agent to Opus 4.8
priority: P2
effort: XS
component: desktop-app
status: in-review
related: [APP-014, APP-003]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-01
updated: 2026-09-01
---

## Problem

The 2026-09-01 dogfood of the notarized build showed the desktop agent
misbehaving on capture and publication flows with the current Anthropic
default, `claude-sonnet-5`. Opus 4.8 was observed to be better behaved on
these attended owner flows, but the model list pins Sonnet first, so every
owner with an Anthropic credential gets the weaker experience.

## Proposed approach

Put `anthropic/claude-opus-4-8` first in the desktop model list so it becomes
the Anthropic default, keeping Sonnet as a fallback. Bump pi to 0.84.4, the
first catalog release that resolves `claude-opus-4-8`, and pin the choice with
a test against the real provider catalog.

## Acceptance criteria

- [x] With an Anthropic credential, a fresh desktop task runs on
      `claude-opus-4-8` without any owner configuration.
- [x] The pi provider catalog actually resolves `claude-opus-4-8`, proven by
      a test rather than assumed.
- [x] Sonnet 5 and the OpenAI models remain selectable fallbacks.
