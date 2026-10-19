---
id: APP-229
title: Oct 19 walkthrough fixes, from Today's new memories to chat that can't push the store
priority: P1
effort: S
component: desktop-app
status: in-review
related: [APP-207, APP-212, APP-213, APP-217, APP-226, APP-227]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-19
updated: 2026-10-19
---

## Problem

The owner walked the app before 0.1.17 and found these problems:

- **Today's next step is a long scroll down.** Every new memory gets its own card.
- **Claude saved four things and Today showed nothing.** A reading is told to read "the newest N" saves. But `lore search` returns saves from the same day oldest first. So the reading re-read yesterday's saves, wrote nothing, and a reading that writes nothing never reached Today.
- **"From Granola analysis" wasn't from Granola.** It came from the owner's own routine, "Look at Granola and tell me learnings". Granola isn't connected, so the routine reworded memories the owner already had.
- **Connecting an agent gave no prompt to test a save.** The scheduled-task suggestion only appeared after the first save.
- **"Push my store" in a drafting chat redeployed the store.** The assistant called `open_store` instead of saying it can't. Its closing line also showed twice.
- **Focus rings and selected options in bright green looked artificial** everywhere in the app.

## Proposed approach

- Today groups new memories by agent, app or routine. Each group is one folded card that says who and how many, and opens onto its memories.
- An agent's saves always show on Today, even when they only added to memories the owner already had.
- `lore search` breaks ties by arrival, newest first.
- A routine that names an app Lore has nothing from writes nothing. It reports that the app isn't connected.
- Connecting an agent, in both the sheet and the first run, shows:
  - a sentence to copy that makes the agent save right away;
  - the scheduled-task or routine suggestion for Grok Bot, ChatGPT and Claude.
- `open_store` and `cloudflare_login` exist only in the store's own thread, which only the app's buttons start. Anywhere else, the assistant says it can't change the store.
- A repeated closing line is shown once, live and on replay.
- Focus and selection use a quiet ink-toned ring. Green stays for actions and Lore's mark.

## Acceptance criteria

- [ ] Today shows one folded card per contributor; a click opens it.
- [ ] Four new saves that change no memory still show on Today as "4 saves · already in your memories".
- [ ] `lore search --source X --limit N` returns the N newest.
- [ ] "Push my store" in a drafting thread can't call `open_store`. A test proves it.
- [ ] No green focus or selection rim remains, in light or dark.
