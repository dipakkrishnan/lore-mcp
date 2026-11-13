---
id: APP-229
title: Oct 19 walkthrough fixes, from Today's new memories to chat that can't push the store
priority: P3
effort: S
component: desktop-app
status: in-review
related: [APP-207, APP-212, APP-213, APP-217, APP-226, APP-227]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-19
updated: 2026-11-13
---

## Problem

The owner walked the app before 0.1.17 and found these problems:

- **Today's next step is a long scroll down.** Every new memory gets its own card.
- **Claude saved four things and Today showed nothing.** A reading is told to read "the newest N" saves. But `lore search` returns saves from the same day oldest first. So the reading re-read yesterday's saves, wrote nothing, and a reading that writes nothing never reached Today.
- **"From Granola analysis" wasn't from Granola.** It came from the owner's own routine, "Look at Granola and tell me learnings". Granola isn't connected, so the routine reworded memories the owner already had.
- **Connecting an agent gave no prompt to test a save.** The scheduled-task suggestion only appeared after the first save.
- **"Push my store" in a drafting chat redeployed the store.** The assistant called `open_store` instead of saying it can't. Its closing line also showed twice.
- **Focus rings and selected options in bright green looked artificial** everywhere in the app.
- **In the first run, a folder macOS keeps Lore out of said "didn't connect. Try again."** Trying again can never help until the owner allows Lore. (On the walk, the Obsidian vault was in Documents.)

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
- When macOS blocks a folder, the first run says so and offers Open System Settings next to Try again.

## Acceptance criteria

- [x] Today (now the Inbox) shows one folded card per contributor; a click opens it.
- [x] Four new saves that change no memory still show on Today (now the Inbox) as "4 saves · already in your memories".
- [x] `lore search --source X --limit N` returns the N newest.
- [x] "Push my store" in a drafting thread can't call `open_store`. A test proves it.
- [ ] No green focus or selection rim remains, in light or dark.

## Notes

**Prioritization (2026-11-12):** Priority P3 (was P1). Stays in-review.
Before it can be ready: Confirm the criteria on main (they say Today, now
the Inbox) and close. Prioritization flag (not acted on): done: #505.

**Close-out (2026-11-13):** stays in-review, with one small CSS gap left.
Shipped in 61db3c0e (#505), and checked on main. Criteria 1-2:
`app/desktop/src/inbox.js` ~78-83 adds one `ready:` row per contributor group,
"N saves … · already in your memories" when no memory changed, and it opens on
click. Criterion 3: `lore/store.py` orders by `updated_at DESC, id DESC`, and
`tests/test_store.py::test_search_puts_the_newest_first_within_a_day` covers it.
Criterion 4: `agent.mjs` ~1013 gives `cloudflare_login` / `open_store` only to
the `deploy` task. `test/component/agent.test.cjs:160` ("asked in chat to push
the store, the agent can't…") proves it. Criterion 5 fails. The global ring is
neutral (`:focus-visible { outline: 2px solid var(--ring) }`, `styles.css:85`),
but two accent-green focus outlines survive from MON-044 (#425), which predates
#505: `.collection-name:focus-visible` (`styles.css:644`) and
`.paste-row textarea:focus-visible` (`styles.css:652`). The work left is to
switch both to `var(--ring)`, then tick criterion 5 and close.
