---
id: APP-104
title: Drop the "Or" from a free-text question with no options
priority: P3
effort: XS
component: desktop-app
status: in-review
related: []
blockers: []
dependencies: []
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/254
created: 2026-09-07
updated: 2026-09-07
---

## Problem

A question with zero preset options (a legitimate shape — `ask_user` supports
sending a question with no options for a genuinely open-ended answer, e.g.
"Which wallet app or hardware wallet do you use?") still shows the free-text
input's placeholder as "Or type your answer". "Or" implies a fallback to
something offered above it; with nothing offered above it, the wording reads
as a leftover fragment rather than an instruction. Found during a manual test
of Scenario 3 in `docs/manual-test-walkthrough.md`.

## Proposed approach

`app/desktop/src/renderer.js`'s question-card renderer (`renderRequest`) set
the placeholder unconditionally instead of branching on whether
`question.options` is empty.

## Acceptance criteria

- [x] A question with no options shows a placeholder that reads correctly
      without implying an alternative to something offered.
- [x] A question with options keeps the current "Or type your answer" wording.

## Notes

Cataloged from GitHub issue #254. Already implemented on branch
`issue-254-freetext-placeholder` (`app/desktop/src/renderer.js`): the
placeholder now reads `question.options.length ? "Or type your answer" :
"Type your answer"`. `npm run check` and `npm test` (33/33) both green in
`app/desktop`.
