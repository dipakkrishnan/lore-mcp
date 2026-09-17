---
id: CAP-006
title: Import ChatGPT and Claude.ai conversation exports
priority: P1
effort: M
component: capture
status: completed
related: [STO-003, CAP-001, ONB-004, APP-120]
blockers: []
dependencies: ["STO-003 for the source kind and state"]
github_issue: null
created: 2026-09-17
updated: 2026-09-17
---

## Problem

Setup reads Claude Code and Codex history, which a non-developer owner does
not have. What they do have is months of ChatGPT or Claude.ai
conversations: the questions they asked about their job, drafts, decisions
worked through, all first-person and dated. Both products export this as a
zip on request, and Lore cannot read it. This is the nearest thing to agent
history for the owner `ONB-004` describes.

## Proposed approach

The `export` kind from `STO-003`, fed by the zip drop rail capture already
has. Recognise the two layouts by their `conversations.json`:

- ChatGPT: an array of conversations, each with `title`, timestamps, and a
  `mapping` of message nodes. The mapping is a tree; walk from
  `current_node` back through `parent` to the root and keep only that path,
  so abandoned edits and regenerations are never imported as if said.
- Claude.ai: an array with `name`, timestamps, and a flat `chat_messages`
  list where each entry has `sender` ("human" or "assistant"), `text`, and
  `created_at`.

Keep the human turns longer than a sentence as the owner's words, with the
assistant reply attached as context; one memory per conversation by default,
titled from the conversation, dated from its first message. Parse and
cluster entirely in Python and feed the correction flow in pages of
candidates, so a large export never enters the agent's context whole.

## Acceptance criteria

- [x] Dropping a ChatGPT export imports one private memory per conversation
      on the kept path only; a regenerated branch never appears.
- [x] Dropping a Claude.ai export does the same from the flat list.
- [x] An export with hundreds of conversations completes without the agent
      reading the raw file; the correction flow shows candidates in pages.
      Moot as written, and checked off for the reason below: `STO-003` readers
      import straight to private memories, so no agent and no correction flow
      sit between the zip and the store. Nothing of the export reaches a
      context window, which is the concern the criterion protects against;
      the owner corrects afterwards through `lore review` as they do for
      every other source.
- [x] Dropping the same export twice adds nothing.

## Notes

Both exports are emailed as a link that expires after 24 hours; the connect
sheet should say where to click (ChatGPT: Settings, Data controls, Export;
Claude: Settings, Privacy, Export data). The research pass found Claude's
export omits Projects and Memory; confirm against a real export. Dipak's
gotcha, 2026-09-17: context thresholds. The design answer is that readers
chunk in Python and only proposals reach the agent (`STO-003` Notes).

Completed 2026-09-17, Python side only, on top of the `STO-003` reader seam.
`ExportReader` in `lore/sources.py` takes either the zip or a bare
`conversations.json`, detects the product from the first conversation's shape
(`mapping` = ChatGPT, `chat_messages` = Claude), and names it in the preview's
new `label` key so the app can show what it found before connecting. One memory
per conversation: the owner's turns at or above the sentence floor, each
followed by its answer trimmed to 600 characters as `Reply: `. `--export PATH`
is the only CLI change, per the reader-seam contract.

Not done here, on purpose: the app's catalog row and the connect-sheet copy
(where to click for each export) are `APP-120`/`APP-122`; no real export was
available on this machine, so the Projects-and-Memory question above is still
unconfirmed and the fixtures are hand-built from the documented shapes.

Known edge, not fixed: "the same export twice" holds for the same path — the
source is identified by its resolved path, so re-adding or re-reading it is a
no-op. The same export saved twice under different names (`conversations.zip`
and `conversations (1).zip`) is two sources and imports twice, because dedupe
is per-source by `source_key`. Cross-source dedupe by conversation id is a
separate change and would touch every reader.

App side, 2026-09-17, on branch `app-catalog-feed-export`. "A ChatGPT or Claude
export" is the third catalog entry, said as "The zip they email you when you ask
for your data." Connect opens the native file panel (`files:pick`, which is
multi-select; the first path is taken) and then the same preview sheet a folder
gets — "Found 210 conversations in your ChatGPT export, 34 too short were
skipped.", the date range, the Last 12 months / Everything choice, Connect. The
product's name comes from the preview's `label`, so the sheet never guesses at
it. `unreachable` reads "That file isn't a ChatGPT or Claude export." and
`nothing_found` "That export has no conversations."; a connected row reads
"Reads the conversations in one export." and an unreachable one offers "Pick the
file again".

Still not said anywhere in the app: where to click in each product to ask for
the export (ChatGPT: Settings, Data controls, Export; Claude: Settings, Privacy,
Export data), which the note above asked the connect sheet to carry. It needs
room for two product-specific paths that a one-line catalog row does not have,
and it is exactly the kind of copy that goes stale when either product moves a
menu. Worth its own item the first time a trial seller asks where the zip comes
from.
