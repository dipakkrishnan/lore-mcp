---
id: APP-236
title: The evening check-in asks a few follow-ups before saving, and drafts for sale in its own thread
priority: P1
effort: S
component: desktop-app
status: in-review
related: [AUT-008, APP-131, APP-132]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-21
updated: 2026-10-21
---

## Problem

On Oct 21 the evening check-in asked the owner what GEPA's coding agent fixed that prompt rewrites never could. The owner answered in one sentence, and Lore saved it as a memory right away. That memory only restated the GEPA paper, so no stranger would pay for it. Then the owner said "Let's draft it for sale", and Lore told them to open the saved memory and choose Draft for sale. The check-in thread has no such button, and it showed no approval cards either.

## Proposed approach

- In the check-in thread, ask two to four short follow-ups, one at a time, before proposing a memory: the setup, the numbers, what changed, what failed or surprised them, and when it wouldn't apply. Stop as soon as a stranger could act on it, or when the owner says they're done. Ordinary captures stay as they are.
- When the owner asks to sell what they just saved, in a capture or a check-in thread, hand those memories to lore-publish there and stage the draft. Its approval cards show in that thread, and the saved card offers Draft for sale, as in a capture thread.

## Acceptance criteria

- [ ] The check-in thread's guidance asks for follow-ups, one at a time and never more than four, before propose_memories. Ordinary captures are unchanged.
- [ ] Asking to sell in a capture or check-in thread stages a draft there. The thread shows its approval cards, and every turn says whether drafts are waiting.

## Notes
