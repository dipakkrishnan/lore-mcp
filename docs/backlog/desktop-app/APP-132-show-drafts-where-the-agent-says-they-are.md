---
id: APP-132
title: Show drafts where the agent says they are, and OpenAI's answer once
priority: P1
effort: S
component: desktop-app
status: in-review
related: [APP-131, APP-128]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-01
updated: 2026-10-01
---

## Problem

In a capture thread the agent drafted a publication and said it was "waiting for
your approval below", but approval cards rendered only on Today and in a publish
thread. On GPT-5.6 Luna every reply also showed twice: OpenAI sends a preview
("commentary") and then the final answer, and Lore showed both.

## Proposed approach

Show the approval and push cards in every thread that can draft (publish,
capture). When a reply carries a final answer, show only that; previews before a
tool call still show. Keep an open question card in view when the thread
re-renders below it.

## Acceptance criteria

- [x] Drafts appear in a capture thread, and stay out of setup and deploy threads
- [x] Replaying every recorded reply: Anthropic unchanged, OpenAI loses only the duplicate previews
- [x] All ten desktop edge scenarios pass
